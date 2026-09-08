import { PLANS, PLAN_PRICES } from "../../../config/plans";
import type { AIToolDefinition } from "../AIProvider";

/**
 * Reads pricing straight from config/plans.ts — the same file that
 * drives every feature gate in the app — so the chatbot can never quote
 * a stale or made-up price. If plans.ts changes, this tool's answer
 * changes automatically with zero extra work.
 */
export const getPricingDefinition: AIToolDefinition = {
  name: "getPricing",
  description:
    "Returns ClinicOS's current subscription plans and prices in Jordanian Dinar (JOD) per month, along with what each plan includes. Use this whenever the visitor asks about pricing, cost, plans, or what's included in a subscription — never guess or recall a price from memory.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export async function getPricingExecute(): Promise<Record<string, unknown>> {
  return {
    currency: "JOD",
    billingPeriod: "monthly",
    plans: [
      {
        name: "trial",
        price: PLAN_PRICES.trial,
        trialDays: PLANS.trial.trialDays,
        maxDoctors: PLANS.trial.maxDoctors,
        maxReceptionists: PLANS.trial.maxReceptionists,
        maxAppointments: PLANS.trial.maxAppointments,
        invoicing: PLANS.trial.invoicing,
        reports: PLANS.trial.reports,
      },
      {
        name: "basic",
        price: PLAN_PRICES.basic,
        maxDoctors: PLANS.basic.maxDoctors,
        maxReceptionists: PLANS.basic.maxReceptionists,
        maxAppointments: "unlimited",
        maxInvoicesPerMonth: PLANS.basic.maxInvoicesPerMonth,
        invoicing: PLANS.basic.invoicing,
        reports: PLANS.basic.reports,
        supportSlaHours: PLANS.basic.supportSlaHours,
      },
      {
        name: "pro",
        price: PLAN_PRICES.pro,
        maxDoctors: "unlimited",
        maxReceptionists: "unlimited",
        maxAppointments: "unlimited",
        maxInvoicesPerMonth: "unlimited",
        invoicing: PLANS.pro.invoicing,
        reports: PLANS.pro.reports,
        exports: PLANS.pro.exports,
        whiteLabel: PLANS.pro.whiteLabel,
        customBookingColor: PLANS.pro.customBookingColor,
        supportSlaHours: PLANS.pro.supportSlaHours,
      },
    ],
  };
}
