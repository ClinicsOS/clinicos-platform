import mongoose, { Schema, Document, Types } from "mongoose";

export type LeadStatus = "new" | "contacted" | "converted" | "closed";

export interface ILead extends Document {
  name: string;
  phone: string;
  clinicName?: string;
  notes?: string; // short context the AI captured about what they need
  source: "chatbot";
  status: LeadStatus;
  conversationId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema = new Schema<ILead>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    clinicName: { type: String, trim: true },
    notes: { type: String },
    source: { type: String, enum: ["chatbot"], default: "chatbot" },
    status: { type: String, enum: ["new", "contacted", "converted", "closed"], default: "new", index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
  },
  { timestamps: true }
);

export const Lead = mongoose.model<ILead>("Lead", leadSchema);
