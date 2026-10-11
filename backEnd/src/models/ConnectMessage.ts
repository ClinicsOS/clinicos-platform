import mongoose, { Schema, Document, Types } from "mongoose";
import { CONNECT } from "../config/connect";

/**
 * CLINICOS CONNECT (C1) — one text message. Immutable: C1 has no edit and no delete (see docs/connect-c1.md), so there is no
 * `updatedAt`, `editedAt` or `deletedAt`. History is kept when the sender leaves the clinic (the User row is only deactivated).
 *
 * The sender's name / role are NOT copied here — they are joined from the user table when messages are read, so a renamed
 * colleague is renamed everywhere and nothing personal is duplicated into every message.
 *
 * `text` is PLAIN TEXT, stored verbatim (after the safe normalisation in services/connect/text.ts). It is never HTML:
 * the UI must render it as text (React escapes it by default).
 *
 * Indexes:
 *   { conversationId, seq:-1 } unique — newest-first paging by cursor, and a hard guarantee that a seq is used once.
 */
export const CONTENT_TYPES = ["text", "appointment_reference", "patient_reference"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface IConnectMessage extends Document {
  clinicId: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  seq: number;
  /** C4: absent on every message written before C4 — read it as "text". */
  contentType?: ContentType;
  /** C4: the id of the referenced Appointment / Patient. ONLY the id: no name, phone, date or any other snapshot is ever stored here. */
  referenceId?: Types.ObjectId;
  /** Plain text. For a reference message it is the OPTIONAL note the sender typed with the card ("" when there is none). */
  text: string;
  createdAt: Date;
}

const schema = new Schema<IConnectMessage>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "ConnectConversation", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    seq: { type: Number, required: true, min: 1 },
    // C4 — a discriminated message: "text" (the only kind before C4, also what a missing field means) or a reference to a clinic record.
    contentType: { type: String, enum: CONTENT_TYPES },
    referenceId: {
      type: Schema.Types.ObjectId,
      // exactly the reference kinds carry an id, and they must (a text message never does)
      required: function (this: IConnectMessage) {
        return this.contentType === "appointment_reference" || this.contentType === "patient_reference";
      },
    },
    // UTF-16 upper bound of MESSAGE_MAX_CHARS code points: a last-line defence behind the validator, not the real limit.
    // Required for a text message; a reference message may have no note (stored as "").
    text: {
      type: String,
      default: "",
      maxlength: CONNECT.MESSAGE_MAX_CHARS * 2,
      required: function (this: IConnectMessage) {
        return !this.contentType || this.contentType === "text";
      },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ conversationId: 1, seq: -1 }, { unique: true });

export const ConnectMessage = mongoose.model<IConnectMessage>("ConnectMessage", schema);
