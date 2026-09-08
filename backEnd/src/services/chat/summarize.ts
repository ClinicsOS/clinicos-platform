import { ClaudeProvider } from "../ai/ClaudeProvider";
import type { IChatMessage } from "../../models/Conversation";

const provider = new ClaudeProvider();

const SUMMARIZE_SYSTEM_PROMPT =
  "لخّص المحادثة التالية بالعربي بأقصى 4-5 أسطر قصيرة جداً. ركّز فقط على: مين المستخدم (زائر/مريض/موظف عيادة)، شو طلب أو سأل عنه، وأي عمليات فعلية تمت (حجز موعد، تسجيل مريض، فاتورة...) مع الأسماء والأرقام المهمة إذا وجدت. تجاهل الشكليات والمجاملات تماماً. إذا في ملخص سابق، ادمجه مع الجديد بنفس الطول المختصر — لا تطوّل.";

function flattenForSummary(messages: IChatMessage[]): string {
  return messages
    .filter((m) => m.role !== "tool") // raw tool JSON isn't useful in a human summary
    .map((m) => {
      if (m.role === "user") return `المستخدم: ${m.content}`;
      if (m.toolName) return `نبض استخدم أداة ${m.toolName}`;
      return `نبض: ${m.content}`;
    })
    .join("\n");
}

/**
 * Folds `droppedMessages` into (and merges with) `existingSummary`.
 * This is a SEPARATE, cheap Claude call (short output, no tools) — it
 * only runs in batches (see chatController's SUMMARIZE_TRIGGER_SLACK),
 * not on every turn, so its own token cost stays small relative to what
 * it saves by shrinking every future turn's history.
 */
export async function updateSummary(
  existingSummary: string | undefined,
  droppedMessages: IChatMessage[]
): Promise<string> {
  const transcript = flattenForSummary(droppedMessages);
  if (!transcript.trim()) return existingSummary || "";

  const prompt = existingSummary
    ? `الملخص السابق:\n${existingSummary}\n\nرسائل جديدة يجب دمجها بالملخص:\n${transcript}`
    : `رسائل يجب تلخيصها:\n${transcript}`;

  try {
    const response = await provider.sendMessage({
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 250,
    });
    return response.text?.trim() || existingSummary || "";
  } catch {
    // Summarization failing should never break the actual chat turn —
    // just keep the old summary and try again next batch.
    return existingSummary || "";
  }
}
