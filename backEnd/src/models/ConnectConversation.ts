import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * CLINICOS CONNECT (C1) — a conversation between clinic staff.
 *
 *   direct       exactly two participants (`participantIds`). PRIVATE to them: nobody else — not even the clinic owner — may list,
 *                read, send to or mark it. `directKey` is the deterministic identity of the pair.
 *   clinic_team  the ONE shared conversation of the clinic. `participantIds` is empty on purpose: membership is "every ACTIVE staff
 *                member of the clinic", derived from the user table at request time, so a new hire joins and a deactivated user
 *                leaves without any membership list to keep in sync.
 *
 * Named Connect* because `Conversation` already belongs to the AI chatbot ("معك").
 *
 * Counters (see services/connect/readState.ts for how they are used — there is NO per-message receipt array anywhere):
 *   lastSeq          allocator: every new message takes `$inc lastSeq` first, so each message has a unique, gap-tolerant,
 *                    strictly increasing number inside its conversation (the pagination cursor and the unread arithmetic).
 *   lastMessageSeq   the highest seq whose message is actually STORED; moved forward only (`$lt` guard) after the message insert.
 *
 * Indexes (the unique ones are the database-level guarantee against duplicates, whatever the application does under concurrency):
 *   { clinicId, directKey }          unique, partial (direct only)       — one direct conversation per pair, per clinic
 *   { clinicId, type }               unique, partial (clinic_team only)  — one Clinic Team per clinic
 *   { clinicId, participantIds, lastMessageAt:-1 }                        — "my conversations", newest activity first
 */
export const CONNECT_CONVERSATION_TYPES = ["direct", "clinic_team"] as const;
export type ConnectConversationType = (typeof CONNECT_CONVERSATION_TYPES)[number];

export interface IConnectConversation extends Document {
  clinicId: Types.ObjectId;
  type: ConnectConversationType;
  directKey?: string;
  participantIds: Types.ObjectId[];
  createdBy?: Types.ObjectId;
  lastSeq: number;
  lastMessageSeq: number;
  lastMessageId?: Types.ObjectId;
  lastMessageAt?: Date;
  lastMessageSenderId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IConnectConversation>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    type: { type: String, enum: CONNECT_CONVERSATION_TYPES, required: true },
    directKey: { type: String, maxlength: 49 }, // "<24-hex>:<24-hex>", smaller id first
    participantIds: { type: [Schema.Types.ObjectId], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastSeq: { type: Number, default: 0, min: 0 },
    lastMessageSeq: { type: Number, default: 0, min: 0 },
    lastMessageId: { type: Schema.Types.ObjectId },
    lastMessageAt: { type: Date },
    lastMessageSenderId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true, versionKey: false },
);

// Shape rules for anything written through save()/create(); the service's upserts build exactly these shapes.
schema.pre("validate", function (next) {
  if (this.type === "direct") {
    const ids = (this.participantIds ?? []).map(String);
    if (ids.length !== 2 || ids[0] === ids[1]) return next(new Error("direct conversation needs two different participants"));
    if (this.directKey !== [...ids].sort().join(":")) return next(new Error("directKey must be the sorted participant pair"));
  } else if (this.type === "clinic_team") {
    if ((this.participantIds ?? []).length || this.directKey) return next(new Error("clinic_team has no participant list or directKey"));
  }
  next();
});

schema.index({ clinicId: 1, directKey: 1 }, { unique: true, partialFilterExpression: { directKey: { $type: "string" } } });
schema.index({ clinicId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: "clinic_team" } });
schema.index({ clinicId: 1, participantIds: 1, lastMessageAt: -1 });

export const ConnectConversation = mongoose.model<IConnectConversation>("ConnectConversation", schema);
