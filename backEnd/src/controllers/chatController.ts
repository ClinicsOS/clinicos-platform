import { Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { Conversation, IChatMessage } from "../models/Conversation";
import { Clinic } from "../models/Clinic";
import { PLANS, type Plan } from "../config/plans";
import { ClaudeProvider } from "../services/ai/ClaudeProvider";
import type { AIMessage } from "../services/ai/AIProvider";
import { getAllowedTools, ToolContext } from "../services/ai/tools";
import { getStaticAnswer, QuickReplyKey } from "../services/chat/quickReplies";
import { updateSummary } from "../services/chat/summarize";
import { asyncHandler } from "../middleware/errorHandler";

const provider = new ClaudeProvider();

// How long a proposed sensitive action stays "pending confirmation" before the
// user has to ask for it again.
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

/**
 * Deterministic signature for a tool call, so a re-emitted call after the user
 * confirms can be matched against the previously-proposed one. Keys are sorted
 * so argument order never changes the signature.
 */
function actionSignature(toolName: string, input: Record<string, unknown>): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce((acc, k) => {
          acc[k] = stable((value as Record<string, unknown>)[k]);
          return acc;
        }, {} as Record<string, unknown>);
    }
    return value;
  };
  return `${toolName}|${JSON.stringify(stable(input))}`;
}

const sendMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  quickReplyKey: z.enum(["about", "pricing", "booking", "track"]).optional(),
  lang: z.enum(["ar", "en"]).default("ar"),
});

const SYSTEM_PROMPT_INTRO = `أنتَ "نبض" — المساعد الذكي على منصة ClinicOS، منصة إدارة العيادات الخاصة في الأردن.

قواعد أساسية:
- رد دائماً بنفس لغة آخر رسالة من المستخدم (عربي أو إنجليزي أو خليط — اختر اللغة الغالبة).
- كن ودوداً ومباشراً ومختصراً. لا تكتب فقرات طويلة إلا لو المستخدم طلب تفاصيل.
- لا تخترع أرقاماً أو بيانات من عندك أبداً — استخدم الأدوات المتاحة لك دائماً.`;

const SYSTEM_PROMPT_PUBLIC = `${SYSTEM_PROMPT_INTRO}

إنت هلق بتحكي مع زائر أو مريض (غير مسجل دخول):
- استخدم أداة getPricing لأي سؤال عن الأسعار أو الباقات.
- إذا لاحظت اهتماماً حقيقياً من زائر (بده يجرب المنصة، يفتح حساب لعيادته، أو يطلب حدا يتواصل معه)، اطلب منه بلطف اسمه ورقم تلفونه (واسم عيادته لو حابب)، ثم استخدم أداة createLead. لا تطلب هذه البيانات من كل زائر — بس لما تكون نيته واضحة.
- بعد استخدام createLead بنجاح، أكّد للزائر إنه فريق ClinicOS رح يتواصل معه قريباً.
- إذا سؤال المستخدم خارج نطاق ClinicOS كلياً، اعتذر بلطف ووجّهه إنك بس بتساعد بأسئلة متعلقة بـ ClinicOS.`;

const SYSTEM_PROMPT_DASHBOARD = `${SYSTEM_PROMPT_INTRO}

إنت هلق بتحكي مع موظف عيادة مسجل دخول (طبيب/سكرتيرة/مالك عيادة) — عندك أدوات توصلك مباشرة على بيانات عيادته الحقيقية:
- listDoctors — لمعرفة أطباء العيادة ومعرّفاتهم
- getClinicStats — إحصائيات (period="today" لليوم، period="month" للشهر الحالي — إذا المستخدم قال "الشهر" استخدم period="month" دائماً)
- listTodayAppointments — مواعيد اليوم بالتفصيل
- searchPatients — البحث عن مريض موجود بالاسم أو رقم التلفون
- createPatient — تسجيل مريض جديد (يحتاج اسم كامل ورقم تلفون كحد أدنى)
- createAppointment — حجز موعد جديد (يحتاج patientId من searchPatients أو createPatient، وdoctorId من listDoctors)
- cancelAppointment — إلغاء موعد موجود
- createInvoice — إنشاء فاتورة لمريض

قواعد صارمة للأدوات الحساسة (createPatient و createAppointment و cancelAppointment و createInvoice):
- لا تستخدمها أبداً من أول ذكر للمستخدم — اسأله دائماً للتأكيد الصريح واستنى رد فيه موافقة واضحة (نعم/تأكيد/أوك) قبل ما تنفذ العملية فعلياً.
- إذا محتاج patientId أو doctorId ما تعرفه، استخدم searchPatients أو listDoctors الأول قبل أي عملية حجز أو فوترة.
- لا تخترع اسم مريض أو موعد أو رقم فاتورة أبداً — كل شي لازم يجي من الأدوات.`;

const MAX_TOOL_ROUNDS = 4;
const FALLBACK_REPLY = "نبض مش قادر يرد هلأ، جرب كمان شوي 🙏";
const LOCKED_REPLY_AR = "مساعد \"نبض\" الذكي جوا لوحة التحكم ميزة حصرية لخطة Pro. رقّي خطة عيادتك لتفعيله.";
const LOCKED_REPLY_EN = 'The "Nabd" dashboard assistant is a Pro-plan feature. Upgrade your clinic\'s plan to unlock it.';

const RECENT_WINDOW = 12;
const SUMMARIZE_TRIGGER_SLACK = 6;

function toAIMessages(messages: IChatMessage[]): AIMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolName && m.toolCallId) {
      return {
        role: "assistant" as const,
        content: m.content,
        toolCalls: [{ id: m.toolCallId, name: m.toolName, input: m.toolInput || {} }],
      };
    }
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        content: JSON.stringify(m.toolResult ?? {}),
        toolCallId: m.toolCallId,
        toolName: m.toolName,
      };
    }
    return { role: m.role, content: m.content };
  });
}

// POST /api/chat/message
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const data = sendMessageSchema.parse(req.body);
  const conversationId = data.conversationId || randomUUID();

  let conversation = await Conversation.findOne({ conversationId });

  // --- Conversation ownership enforcement --------------------------------
  // A conversationId alone must NOT grant access. If a conversation already
  // exists, the requester must be the same principal that owns it:
  //   - authenticated conversation  -> only its owning user may continue it
  //   - anonymous conversation      -> only an anonymous requester may continue
  // Mismatches are rejected rather than silently served, which is what closes
  // the cross-user / cross-clinic history-disclosure hole.
  if (conversation) {
    const ownerId = conversation.userId ? String(conversation.userId) : null;
    const requesterId = req.userId ? String(req.userId) : null;
    if (ownerId !== requesterId) {
      return res.status(403).json({
        message: "This conversation belongs to a different session.",
        code: "CONVERSATION_FORBIDDEN",
      });
    }
  } else {
    conversation = new Conversation({ conversationId, messages: [], summarizedUpTo: 0 });
  }

  // Bind ownership on first authenticated message of a brand-new conversation.
  if (req.userId && !conversation.userId) {
    conversation.userId = req.userId as unknown as typeof conversation.userId;
    conversation.clinicId = req.clinicId as unknown as typeof conversation.clinicId;
  }

  conversation.messages.push({ role: "user", content: data.message, createdAt: new Date() });

  if (data.quickReplyKey) {
    const staticReply = getStaticAnswer(data.quickReplyKey as QuickReplyKey, data.lang);
    conversation.messages.push({ role: "assistant", content: staticReply, createdAt: new Date() });
    conversation.lastMessageAt = new Date();
    await conversation.save();
    return res.json({ conversationId, reply: staticReply });
  }

  // --- Pro-plan gate for the dashboard assistant --------------------------
  // The REAL boundary — the frontend also hides the bubble for non-Pro
  // clinics, but that's UX only. This check is what actually stops a
  // non-Pro clinic from using (and costing us tokens on) the dashboard
  // assistant even if they call the API directly. Public/anonymous chat
  // (getPricing, createLead) is never gated — it's marketing, not a
  // clinic-plan feature.
  if (req.clinicId) {
    const clinic = await Clinic.findById(req.clinicId).select("plan");
    const allowed = clinic ? PLANS[clinic.plan as Plan].aiAssistant : false;
    if (!allowed) {
      const lockedReply = data.lang === "en" ? LOCKED_REPLY_EN : LOCKED_REPLY_AR;
      conversation.messages.push({ role: "assistant", content: lockedReply, createdAt: new Date() });
      conversation.lastMessageAt = new Date();
      await conversation.save();
      return res.status(402).json({ conversationId, reply: lockedReply, code: "PLAN_LIMIT", feature: "aiAssistant" });
    }
  }
  // -------------------------------------------------------------------

  const total = conversation.messages.length;
  const droppableCount = total - conversation.summarizedUpTo - RECENT_WINDOW;
  if (droppableCount >= SUMMARIZE_TRIGGER_SLACK) {
    const newlyDropped = conversation.messages.slice(
      conversation.summarizedUpTo,
      conversation.summarizedUpTo + droppableCount
    );
    conversation.summary = await updateSummary(conversation.summary, newlyDropped);
    conversation.summarizedUpTo += droppableCount;
    console.log(
      `📎 [CHATBOT] summarized ${droppableCount} messages, summarizedUpTo=${conversation.summarizedUpTo} conversationId=${conversationId}`
    );
  }

  let recentStart = conversation.summarizedUpTo;
  if (conversation.messages[recentStart]?.role === "tool") {
    recentStart = Math.max(0, recentStart - 1);
  }
  const recentMessages = conversation.messages.slice(recentStart);

  const toolContext: ToolContext = {
    conversationId,
    conversationObjectId: String(conversation._id),
    clinicId: req.clinicId,
    userId: req.userId,
    role: req.role,
  };
  const tools = getAllowedTools(toolContext);
  const toolDefinitions = Object.values(tools).map((t) => t.definition);

  let systemPrompt = req.clinicId ? SYSTEM_PROMPT_DASHBOARD : SYSTEM_PROMPT_PUBLIC;
  if (conversation.summary) {
    systemPrompt += `\n\nملخص المحادثة السابقة مع هذا المستخدم (خلفية فقط، لا تكرره له إلا لو سأل):\n${conversation.summary}`;
  }

  let finalText: string | null = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Snapshot any confirmation that was pending BEFORE this turn started. A
  // sensitive action only executes if it matches a confirmation the user set
  // up on an earlier turn — never one proposed within this same turn. This is
  // what prevents the model from "self-confirming" in one shot.
  const priorPending =
    conversation.pendingAction &&
    conversation.pendingAction.expiresAt > new Date()
      ? {
          signature: conversation.pendingAction.signature,
          toolName: conversation.pendingAction.toolName,
        }
      : null;
  // Clear it now; if the model proposes something this turn we'll set a fresh
  // one below, and a matched confirmation is single-use.
  conversation.pendingAction = undefined;

  try {
    let round = 0;
    let workingMessages = recentMessages;
    while (round < MAX_TOOL_ROUNDS) {
      const response = await provider.sendMessage({
        systemPrompt,
        messages: toAIMessages(workingMessages),
        tools: toolDefinitions,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (response.toolCalls.length === 0) {
        finalText = response.text ?? "";
        const assistantMsg: IChatMessage = { role: "assistant", content: finalText, createdAt: new Date() };
        conversation.messages.push(assistantMsg);
        workingMessages = [...workingMessages, assistantMsg];
        break;
      }

      const call = response.toolCalls[0];
      const assistantMsg: IChatMessage = {
        role: "assistant",
        content: response.text ?? "",
        toolName: call.name,
        toolCallId: call.id,
        toolInput: call.input,
        createdAt: new Date(),
      };
      conversation.messages.push(assistantMsg);
      workingMessages = [...workingMessages, assistantMsg];

      const tool = tools[call.name];
      let result: Record<string, unknown>;
      if (!tool) {
        result = { error: `Unknown tool: ${call.name}` };
      } else if (tool.requiresConfirmation) {
        // Server-enforced confirmation gate. The LLM's prompt-level "ask first"
        // rule is NOT trusted here — this code decides whether the write runs.
        const signature = actionSignature(call.name, call.input);
        const isConfirmed =
          priorPending !== null &&
          priorPending.signature === signature &&
          priorPending.toolName === call.name;

        if (isConfirmed) {
          // The user confirmed this exact action on a previous turn — run it.
          try {
            result = await tool.execute(call.input, toolContext);
          } catch (err) {
            result = { error: (err as Error).message };
          }
          conversation.pendingAction = undefined; // single-use
        } else {
          // First time we're seeing this action (or the args changed): do NOT
          // execute. Record it as pending and tell the model to get an explicit
          // confirmation from the user, who must then re-issue the request.
          conversation.pendingAction = {
            signature,
            toolName: call.name,
            input: call.input,
            expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
          };
          result = {
            needsConfirmation: true,
            action: call.name,
            details: call.input,
            message:
              "This action was NOT performed. It changes clinic data and requires the user's explicit confirmation. Summarize exactly what you're about to do (patient, doctor, time, amounts as relevant) and ask the user to confirm. Only when they clearly confirm on their next message, call this same tool again with the same arguments.",
          };
        }
      } else {
        try {
          result = await tool.execute(call.input, toolContext);
        } catch (err) {
          result = { error: (err as Error).message };
        }
      }

      const toolMsg: IChatMessage = {
        role: "tool",
        content: "",
        toolName: call.name,
        toolCallId: call.id,
        toolResult: result,
        createdAt: new Date(),
      };
      conversation.messages.push(toolMsg);
      workingMessages = [...workingMessages, toolMsg];

      round++;
    }

    const cost = (totalInputTokens / 1_000_000) * 1 + (totalOutputTokens / 1_000_000) * 5;
    console.log(
      `💬 [CHATBOT] tokens in=${totalInputTokens} out=${totalOutputTokens} ` +
        `≈$${cost.toFixed(5)} conversationId=${conversationId} authenticated=${Boolean(req.clinicId)} ` +
        `windowSize=${recentMessages.length}/${total}`
    );
  } catch (err) {
    console.error("🔴 [CHATBOT] AI provider error:", (err as Error).message, {
      conversationId,
      clinicId: req.clinicId,
    });
  }

  if (finalText === null) finalText = FALLBACK_REPLY;

  conversation.lastMessageAt = new Date();
  await conversation.save();

  res.json({ conversationId, reply: finalText });
});
