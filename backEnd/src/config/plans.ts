/**
 * ClinicOS subscription plans — central source of truth.
 * Every feature gate in the app reads from here.
 */

export type Plan = "trial" | "basic" | "pro";

export interface PlanLimits {
  maxDoctors: number;             // -1 = unlimited
  maxReceptionists: number;
  maxAppointments: number;        // total appointments (-1 = unlimited)
  maxInvoicesPerMonth: number;    // -1 = unlimited
  invoicing: boolean;
  reports: boolean;               // monthly reports page
  exports: boolean;               // Excel / PDF exports
  whiteLabel: boolean;            // hide "Powered by ClinicOS"
  customBookingColor: boolean;    // brand colour on booking page
  supportSlaHours: number;
  trialDays: number;
}

export const PLANS: Record<Plan, PlanLimits> = {
  trial: {
    maxDoctors: 1,
    maxReceptionists: 1,
    maxAppointments: 20,
    maxInvoicesPerMonth: 2,
    invoicing: true,
    reports: false,
    exports: false,
    whiteLabel: false,
    customBookingColor: false,
    supportSlaHours: 0,
    trialDays: 7,
  },
  basic: {
    maxDoctors: 5,
    maxReceptionists: 2,
    maxAppointments: -1,
    maxInvoicesPerMonth: 30,
    invoicing: true,
    reports: false,
    exports: false,
    whiteLabel: false,
    customBookingColor: false,
    supportSlaHours: 48,
    trialDays: 0,
  },
  pro: {
    maxDoctors: -1,
    maxReceptionists: -1,
    maxAppointments: -1,
    maxInvoicesPerMonth: -1,
    invoicing: true,
    reports: true,
    exports: true,
    whiteLabel: true,
    customBookingColor: true,
    supportSlaHours: 24,
    trialDays: 0,
  },
};

export const PLAN_PRICES: Record<Plan, number> = {
  trial: 0,
  basic: 19,
  pro: 29,
};

/** Compute days remaining until expiry. */
export const daysUntil = (date: Date | null | undefined): number | null => {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};
