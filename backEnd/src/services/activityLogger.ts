import { Types } from "mongoose";
import { ActivityLog } from "../models/ActivityLog";

/**
 * Fire-and-forget logger for admin actions.  Errors are swallowed so a logging
 * hiccup can never break the actual operation the admin was performing.
 */
interface LogArgs {
  action: string;
  actorEmail: string;
  targetType?: "clinic" | "user" | "subscription_request" | "system";
  targetId?: string | Types.ObjectId;
  targetLabel?: string;
  details?: Record<string, unknown>;
}

export async function logActivity(args: LogArgs): Promise<void> {
  try {
    await ActivityLog.create({
      action: args.action,
      actorEmail: args.actorEmail,
      targetType: args.targetType,
      targetId: args.targetId
        ? new Types.ObjectId(args.targetId.toString())
        : undefined,
      targetLabel: args.targetLabel,
      details: args.details,
    });
  } catch (err) {
    console.error("[activityLogger] Failed to record activity:", err);
    // deliberately don't rethrow — logging must not break requests
  }
}
