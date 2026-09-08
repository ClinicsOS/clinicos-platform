/**
 * Provider-agnostic types for the chatbot's AI layer.
 *
 * The chat controller (built in a later step) only ever talks to these
 * types — never to the Anthropic SDK directly. That's what lets us swap
 * in a different provider later (e.g. OpenAI) by writing one new class
 * that implements AIProvider, without touching the controller, the tool
 * registry, or the conversation storage.
 */

/** A tool the AI is allowed to call, described in JSON-schema form. */
export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema for the tool's arguments
}

/** One tool call the AI asked to make. */
export interface AIToolCall {
  id: string; // provider-issued id — must be echoed back in the matching tool result
  name: string;
  input: Record<string, unknown>;
}

/**
 * One turn in the conversation, in the shape the AIProvider expects.
 *
 * - "user": something the human typed.
 * - "assistant": something the AI said. If it also called tools on this
 *   turn, they're listed in toolCalls (content can be "" if it was a
 *   pure tool call with no visible text).
 * - "tool": the result of executing one tool call, sent back to the AI.
 *   toolCallId must match the id from the AIToolCall it's answering.
 */
export interface AIMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: AIToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIResponse {
  text: string | null;
  toolCalls: AIToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: AIUsage;
}

export interface AISendParams {
  systemPrompt: string;
  messages: AIMessage[];
  tools?: AIToolDefinition[];
  maxTokens?: number;
}

export interface AIProvider {
  sendMessage(params: AISendParams): Promise<AIResponse>;
}
