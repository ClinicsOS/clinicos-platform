import { Request, Response, NextFunction } from "express";

/**
 * NEW MIDDLEWARE — does not touch auth.ts or adminAuth.ts. This protects
 * endpoints meant to be triggered by an external scheduler (e.g.
 * cron-job.org) rather than a logged-in clinic user or admin, so it
 * intentionally does NOT use requireAdmin/requireAuth.
 *
 * The secret can be passed as a query param (?key=...) because most free
 * cron-pinger services only let you configure a URL, not a custom header —
 * but the header is supported too for anyone who can set one.
 */
export const requireCronSecret = (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.REMINDER_CRON_SECRET;
  if (!secret) {
    console.error("[cronAuth] REMINDER_CRON_SECRET is not set — refusing all cron requests");
    return res.status(500).json({ message: "Cron auth not configured" });
  }

  const provided = (req.headers["x-cron-secret"] as string) || (req.query.key as string);
  if (provided !== secret) {
    return res.status(401).json({ message: "Invalid or missing cron secret" });
  }
  return next();
};
