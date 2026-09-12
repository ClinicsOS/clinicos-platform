import mongoose, { Schema, Document, Types } from "mongoose";

export type ChatRole = "user" | "assistant" | "tool";

export interface IChatMessage {
  role: ChatRole;
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  createdAt: Date;
}

export interface IConversation extends Document {
  conversationId: string;
  userId?: Types.ObjectId;
  clinicId?: Types.ObjectId;
  language?: "ar" | "en";
  messages: IChatMessage[];
  summary?: string;
  // How many messages (from index 0) are already folded into `summary`.
  // Only messages[summarizedUpTo:] get sent to the AI in full — this is
  // what keeps token cost from growing with the conversation's whole
  // history instead of just its recent tail.
  summarizedUpTo: number;
  // Server-side confirmation gate for sensitive AI tools. When the model
  // proposes a requiresConfirmation action, we store it here (instead of
  // executing) and only run it once the user confirms on a *later* turn and
  // the model re-emits the exact same tool call. This is what makes the
  // "ask before acting" rule real — it no longer depends on the LLM obeying
  // its prompt. See controllers/chatController.ts.
  pendingAction?: {
    signature: string;
    toolName: string;
    input: Record<string, unknown>;
    expiresAt: Date;
  };
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    role: { type: String, enum: ["user", "assistant", "tool"], required: true },
    content: { type: String, default: "" },
    toolName: { type: String },
    toolCallId: { type: String },
    toolInput: { type: Schema.Types.Mixed },
    toolResult: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new Schema<IConversation>(
  {
    conversationId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", index: true },
    language: { type: String, enum: ["ar", "en"] },
    messages: { type: [chatMessageSchema], default: [] },
    summary: { type: String },
    summarizedUpTo: { type: Number, default: 0 },
    pendingAction: {
      type: new Schema(
        {
          signature: { type: String, required: true },
          toolName: { type: String, required: true },
          input: { type: Schema.Types.Mixed, default: {} },
          expiresAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      required: false,
      default: undefined,
    },
    lastMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const Conversation = mongoose.model<IConversation>("Conversation", conversationSchema);
