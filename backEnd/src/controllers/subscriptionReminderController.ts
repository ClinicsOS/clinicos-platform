import { Request, Response } from "express";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { SubscriptionReminderLog } from "../models/SubscriptionReminderLog";
import { asyncHandler } from "../middleware/errorHandler";
import { daysUntil } from "../config/plans";

/**
 * NEW CONTROLLER — additive only. Reads Clinic/User but never writes to
 * them; only writes to the new SubscriptionReminderLog collection. Mirrors
 * the pattern already used for WhatsApp appointment reminders
 * (reminderController.ts / ReminderLog.ts), so it doesn't modify any
 * existing controller or model.
 */

const MILESTONES = [7, 3, 1] as const;

// Same copy as the "Renewal reminder" template on /admin/email, just
// parameterised with however many days are actually left.
function renewalEmailBody(daysLeft: number): string {
  const dayWord = daysLeft === 1 ? "day" : "days";
  return `We noticed your ClinicOS subscription will expire in ${daysLeft} ${dayWord}.

To continue enjoying uninterrupted service, please renew your subscription from your dashboard, or reply to this email if you'd like assistance.

Thank you for choosing ClinicOS.`;
}

/**
 * POST /api/reminders/send-subscription-reminders
 * Triggered by an external scheduler once a day (same cron-job.org account
 * and REMINDER_CRON_SECRET already used for /send-daily). For every active
 * clinic sitting at exactly 7, 3, or 1 day(s) from planExpiresAt, emails the
 * clinic owner the renewal reminder — at most once per milestone per expiry
 * cycle, enforced by SubscriptionReminderLog's unique index.
 */
export const sendSubscriptionReminders = asyncHandler(
  async (_req: Request, res: Response) => {
    const clinics = await Clinic.find({ status: "active" })
      .select("_id name planExpiresAt")
      .lean();

    const tally = { checked: clinics.length, sent: 0, failed: 0, skipped: 0 };

    for (const clinic of clinics) {
      const days = daysUntil(clinic.planExpiresAt);
      const milestone = MILESTONES.find((m) => m === days);
      if (milestone === undefined) {
        tally.skipped++;
        continue;
      }

      const already = await SubscriptionReminderLog.findOne({
        clinicId: clinic._id,
        milestoneDays: milestone,
        planExpiresAt: clinic.planExpiresAt,
        status: "sent",
      });
      if (already) {
        tally.skipped++;
        continue;
      }

      const owner = await User.findOne({ clinicId: clinic._id, role: "owner" });
      if (!owner) {
        tally.skipped++;
        continue;
      }

      try {
        // Lazy import — same reasoning as adminController's sendEmailToClinic:
        // no need to pay for this module unless a reminder actually fires.
        const { sendAdminCustomEmail } = await import("../services/adminMailer");
        await sendAdminCustomEmail(
          owner.email,
          owner.name,
          "Your ClinicOS subscription is expiring soon",
          renewalEmailBody(milestone),
        );
        await SubscriptionReminderLog.create({
          clinicId: clinic._id,
          milestoneDays: milestone,
          planExpiresAt: clinic.planExpiresAt,
          status: "sent",
        });
        tally.sent++;
      } catch (err) {
        await SubscriptionReminderLog.create({
          clinicId: clinic._id,
          milestoneDays: milestone,
          planExpiresAt: clinic.planExpiresAt,
          status: "failed",
          errorMessage: (err as Error).message,
        });
        tally.failed++;
      }
    }

    return res.json(tally);
  },
);
