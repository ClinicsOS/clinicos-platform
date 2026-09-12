import { PLANS, type Plan } from "../config/plans";
import type { IClinic } from "../models/Clinic";

/**
 * Single source of truth for appointment business rules, so the human
 * dashboard flow (controllers/appointmentController.ts) and the AI tool
 * (services/ai/tools/dashboard/createAppointment.ts) can never drift apart.
 *
 * Each check returns `null` when the slot is fine, or `{ code, message }`
 * describing the first violation. The messages/codes match what the dashboard
 * controller already returned, so existing frontend handling is unaffected.
 */

export interface RuleViolation {
  code: string;
  message: string;
}

/**
 * Validates the *timing* of a proposed appointment against the clinic's
 * schedule: not in the past, not on a closed day, not inside a break window.
 *
 * The break-window check uses the clinic's local timezone (Asia/Amman) exactly
 * like the public booking + dashboard controllers do.
 */
export function checkAppointmentTiming(
  clinic: IClinic,
  startAt: Date
): RuleViolation | null {
  // Past time
  if (isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    return { code: "PAST_TIME", message: "Cannot book a time in the past" };
  }

  // Closed day
  const dow = startAt.getUTCDay();
  const wh = clinic.workingHours.find((w) => w.day === dow);
  if (!wh || !wh.isOpen) {
    return { code: "DAY_CLOSED", message: "The clinic is closed on this day" };
  }

  // Break window
  if (wh.breakFrom && wh.breakTo) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Amman",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(startAt);
    const wallTime = `${parts.find((p) => p.type === "hour")!.value}:${
      parts.find((p) => p.type === "minute")!.value
    }`;
    if (wallTime >= wh.breakFrom && wallTime < wh.breakTo) {
      return {
        code: "BREAK_TIME",
        message:
          "This time falls within the clinic's break — please pick another slot",
      };
    }
  }

  return null;
}

/**
 * Enforces the plan's appointment cap (e.g. the trial's limited number of
 * appointments). `currentCount` is the clinic's current total appointment
 * count, passed in by the caller so this stays a pure function.
 */
export function checkAppointmentPlanCap(
  clinic: IClinic,
  currentCount: number
): RuleViolation | null {
  const limits = PLANS[clinic.plan as Plan];
  if (limits.maxAppointments !== -1 && currentCount >= limits.maxAppointments) {
    return {
      code: "PLAN_LIMIT",
      message: `Trial limit reached (${limits.maxAppointments} appointments) — upgrade to continue`,
    };
  }
  return null;
}
