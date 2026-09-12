import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Protects endpoints meant to be triggered by an external scheduler (e.g.
 * cron-job.org) rather than a logged-in clinic user or admin, so it
 * intentionally does NOT use requireAdmin/requireAuth.
 *
 * PREFERRED: pass the secret in the `x-cron-secret` header. cron-job.org (and
 * most non-trivial schedulers) support custom headers — use one. This keeps the
 * secret out of URLs, request logs, and reverse-proxy access logs.
 *
 * FALLBACK: the `?key=...` query param is still accepted for schedulers that
 * can only configure a URL, but it is discouraged — query strings can leak via
 * logs. If you rely on it, rotate REMINDER_CRON_SECRET periodically and make
 * sure your logging redacts query strings.
 */

/**
 * Constant-time string comparison that never throws on length mismatch.
 * Avoids leaking, via response timing, how many leading characters of the
 * secret were guessed correctly.
 */
const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

export const requireCronSecret = (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.REMINDER_CRON_SECRET;
  if (!secret) {
    console.error("[cronAuth] REMINDER_CRON_SECRET is not set — refusing all cron requests");
    return res.status(500).json({ message: "Cron auth not configured" });
  }

  const provided =
    (req.headers["x-cron-secret"] as string) || (req.query.key as string) || "";
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ message: "Invalid or missing cron secret" });
  }
  return next();
};
