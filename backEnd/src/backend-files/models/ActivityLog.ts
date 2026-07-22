import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Every consequential admin action gets a row here so we have an audit trail:
 * who did it, when, what changed, and why.  Read-only from the admin UI.
 */
export interface IActivityLog extends Document {
  action: string;                 // e.g. "clinic.plan_changed"
  targetType?: "clinic" | "user" | "subscription_request" | "system";
  targetId?: Types.ObjectId;
  targetLabel?: string;           // human-friendly label (e.g. clinic name) for later display
  details?: Record<string, unknown>;
  actorEmail: string;             // which admin performed the action
  createdAt: Date;
}

const schema = new Schema<IActivityLog>(
  {
    action: { type: String, required: true, index: true },
    targetType: {
      type: String,
      enum: ["clinic", "user", "subscription_request", "system"],
    },
    targetId: { type: Schema.Types.ObjectId },
    targetLabel: { type: String },
    details: { type: Schema.Types.Mixed },
    actorEmail: { type: String, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Fast reverse-chronological listing
schema.index({ createdAt: -1 });

export const ActivityLog = mongoose.model<IActivityLog>("ActivityLog", schema);
