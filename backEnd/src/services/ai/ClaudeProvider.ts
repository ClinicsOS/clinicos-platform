import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  AISendParams,
  AIResponse,
  AIMessage,
  AIToolCall,
} from "./AIProvider";

const apiKey = process.env.ANTHROPIC_API_KEY || "";
// Haiku is the default on purpose — this is a cost-sensitive, high-volume
// chatbot (FAQ + lead capture + simple lookups), not a task that needs the
// bigger models. Override with ANTHROPIC_CHAT_MODEL if a step ever needs
// stronger reasoning (e.g. a "smart mode" for complex dashboard questions).
const MODEL = process.env.ANTHROPIC_CHAT_MODEL || "claude-haiku-4-5-20251001";

const client = apiKey ? new Anthropic({ apiKey }) : null;

/**
 * Claude implementation of AIProvider, following the same
 * dev-mode-fallback spirit as services/mailer.ts and
 * services/whatsappService.ts — but for a chat request there's no sane
 * fallback response to fake, so we fail loudly and clearly instead.
 *
 * NEW FILE — does not touch any existing service.
 */
export class ClaudeProvider implements AIProvider {
  async sendMessage(params: AISendParams): Promise<AIResponse> {
    if (!client) {
      throw new Error(
        "ANTHROPIC_API_KEY is not configured — add it to .env before using the chatbot."
      );
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: params.maxTokens ?? 800,
      system: params.systemPrompt,
      messages: toClaudeMessages(params.messages),
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    });

    return fromClaudeResponse(response);
  }
}

/**
 * Converts our provider-agnostic AIMessage[] into Claude's message format.
 *
 * - "user" -> a plain user message.
 * - "assistant" -> a plain assistant message, or (if toolCalls is set) an
 *   assistant message containing a text block (if any) plus one tool_use
 *   block per call — this is what lets Claude "remember" which tool_use
 *   ids it issued, so the tool_result below can reference them correctly.
 * - "tool" -> Claude expects tool results back as a "user" message
 *   containing a tool_result block.
 */
function toClaudeMessages(messages: AIMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", content: m.content });
      continue;
    }

    if (m.role === "assistant") {
      if (!m.toolCalls || m.toolCalls.length === 0) {
        result.push({ role: "assistant", content: m.content });
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of m.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }
      result.push({ role: "assistant", content: blocks });
      continue;
    }

    // role === "tool"
    result.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.toolCallId as string,
          content: m.content,
        },
      ],
    });
  }

  return result;
}

function fromClaudeResponse(response: Anthropic.Message): AIResponse {
  let text: string | null = null;
  const toolCalls: AIToolCall[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      text = (text ?? "") + block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  const stopReason: AIResponse["stopReason"] =
    response.stop_reason === "tool_use"
      ? "tool_use"
      : response.stop_reason === "max_tokens"
      ? "max_tokens"
      : "end_turn";

  return {
    text,
    toolCalls,
    stopReason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
