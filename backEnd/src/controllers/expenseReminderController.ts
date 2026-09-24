import { Request, Response } from "express";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { ExpenseReminderLog } from "../models/ExpenseReminderLog";
import { asyncHandler } from "../middleware/errorHandler";
import { getDueItems, todayStr } from "../services/expenseSchedule";
import { sendExpenseReminderEmail } from "../services/expenseMailer";

/**
 * NEW CONTROLLER — POST /api/reminders/send-expense-reminders
 *
 * Triggered once a day by cron-job.org (same REMINDER_CRON_SECRET header as
 * the other two reminder jobs). For every active clinic it collects the
 * bills that hit a reminder day TODAY and emails the owner ONE digest:
 *   - X days before the due date (X = the bill's "remind me" setting)
 *   - on the due date itself
 *   - 3 days after the due date if it's still not marked paid
 * ExpenseReminderLog guarantees at most one email per clinic per day.
 */
const OVERDUE_NUDGE_DAYS = -3;

export const sendExpenseReminders = asyncHandler(async (_req: Request, res: Response) => {
  const dateStr = todayStr();
  const clinics = await Clinic.find({ status: "active" }).select("_id name").lean();
  const tally = { checked: clinics.length, sent: 0, failed: 0, skipped: 0 };

  for (const clinic of clinics) {
    const already = await ExpenseReminderLog.findOne({
      clinicId: clinic._id,
      dateStr,
      status: "sent",
    }).lean();
    if (already) {
      tally.skipped++;
      continue;
    }

    const items = (await getDueItems(clinic._id)).filter(
      (i) =>
        i.daysUntil === i.remindDaysBefore ||
        i.daysUntil === 0 ||
        i.daysUntil === OVERDUE_NUDGE_DAYS
    );
    if (!items.length) {
      tally.skipped++;
      continue;
    }

    const owner = await User.findOne({ clinicId: clinic._id, role: "owner", isActive: true })
      .select("email name")
      .lean();
    if (!owner?.email) {
      tally.skipped++;
      continue;
    }

    try {
      await sendExpenseReminderEmail(owner.email, owner.name, clinic.name, items);
      await ExpenseReminderLog.create({
        clinicId: clinic._id,
        dateStr,
        itemCount: items.length,
        status: "sent",
      });
      tally.sent++;
    } catch (err) {
      await ExpenseReminderLog.create({
        clinicId: clinic._id,
        dateStr,
        itemCount: items.length,
        status: "failed",
        errorMessage: (err as Error).message,
      });
      tally.failed++;
    }
  }

  return res.json(tally);
});
