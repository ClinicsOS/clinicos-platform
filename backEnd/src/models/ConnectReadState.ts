import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * CLINICOS CONNECT (C1) — how far ONE user has read ONE conversation. One small row per (user, conversation), created the first
 * time that user sends or marks-read; a user who never touched a conversation has no row (= read nothing).
 *
 *   unread = max(0, conversation.lastMessageSeq − lastReadSeq)
 *
 * so a new message costs two writes in total (the conversation counter + the sender's own row) no matter how many people are
 * in the conversation, and the unread count is an O(1) subtraction — no per-message receipts, no per-member counters to fan out.
 * `lastReadSeq` only ever moves forward ($max).
 *
 * Indexes:  { userId, conversationId } unique — the upsert key, and "all my read positions" for the list / badge.
 */
export interface IConnectReadState extends Document {
  clinicId: Types.ObjectId;
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  lastReadSeq: number;
  lastReadAt: Date;
}

const schema = new Schema<IConnectReadState>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "ConnectConversation", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastReadSeq: { type: Number, default: 0, min: 0 },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false },
);

schema.index({ userId: 1, conversationId: 1 }, { unique: true });

export const ConnectReadState = mongoose.model<IConnectReadState>("ConnectReadState", schema);
