import { Router } from "express";
import { requireCronSecret } from "../middleware/cronAuth";
import { sendDailyReminders } from "../controllers/reminderController";

/**
 * NEW ROUTES FILE — mounted once in index.ts alongside the other routers,
 * doesn't touch any existing route file.
 */
const router = Router();

// Triggered by an external scheduler once a day (see REMINDER_CRON_SECRET
// in .env). Not tied to clinic/admin login since the caller isn't a
// logged-in user — it's a server-to-server ping.
router.post("/send-daily", requireCronSecret, sendDailyReminders);

export default router;
