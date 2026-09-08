import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, AISendParams, AIResponse, AIMessage, AIToolCall } from "./AIProvider";

const apiKey = process.env.ANTHROPIC_API_KEY || "";
// Haiku is the default on purpose — this is a cost-sensitive, high-volume
// chatbot (FAQ + lead capture + simple lookups), not a task that needs the
// bigger models. Override with ANTHROPIC_CHAT_MODEL if a step ever needs
// stronger reasoning (e.g. a "smart mode" for complex dashboard questions).
const MODEL = process.env.ANTHROPIC_CHAT_MODEL || "claude-haiku-4-5-20251001";

const client = apiKey ? new Anthropic({ apiKey }) : null;

/**
 * Claude implementation of AIProvider.
 *
 * NOTE on the liberal use of `any` below: the exact request-side type
 * names in @anthropic-ai/sdk (e.g. the shape of a tool's input_schema,
 * or a content block inside a request message) have changed across SDK
 * versions and don't perfectly match our provider-agnostic AIToolDefinition
 * shape. Rather than pin this file to one SDK version's exact internal
 * types (which breaks on the next `npm install` elsewhere, as happened
 * here — this compiled fine locally under ts-node-dev's --transpile-only,
 * which skips type-checking entirely, and only failed on Render's real
 * `tsc` build), we loosen typing at the SDK request boundary only. Our
 * own exported types (AIMessage, AIResponse, etc.) stay fully typed —
 * this loosening is isolated to this one file's internals.
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
        input_schema: t.inputSchema as any,
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
 *   block per call.
 * - "tool" -> Claude expects tool results back as a "user" message
 *   containing a tool_result block.
 */
function toClaudeMessages(messages: AIMessage[]): any[] {
  const result: any[] = [];

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
      const blocks: any[] = [];
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
