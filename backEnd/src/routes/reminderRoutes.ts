import { Router } from "express";
import { requireCronSecret } from "../middleware/cronAuth";
import { sendDailyReminders } from "../controllers/reminderController";
import { sendSubscriptionReminders } from "../controllers/subscriptionReminderController";

/**
 * NEW ROUTES FILE — mounted once in index.ts alongside the other routers,
 * doesn't touch any existing route file.
 */
const router = Router();

// Triggered by an external scheduler once a day (see REMINDER_CRON_SECRET
// in .env). Not tied to clinic/admin login since the caller isn't a
// logged-in user — it's a server-to-server ping.
router.post("/send-daily", requireCronSecret, sendDailyReminders);

// Same scheduler, same secret, different job: subscription renewal
// reminders (7/3/1 days before a clinic's plan expires). Add a second
// cron-job.org job hitting this URL with the same x-cron-secret header.
router.post("/send-subscription-reminders", requireCronSecret, sendSubscriptionReminders);

export default router;
