import type { DataScope } from "../../auth/policy";
import type { AnalyticsScope } from "./scope";
import type { DateRange } from "./range";
import { collectedTotal, invoicedTotal } from "./financial";
import { expenseSummaryFor } from "./expenses";
import { round3 } from "./agg";
import type { ExpenseSummary } from "../expenseLedger";

/**
 * PHASE 6 — THE ONE place where "Collected / Invoiced / Expenses / Net cash" for a (scope, range) are assembled. Overview, Financial,
 * Doctors and Expenses all call this, which is what guarantees the same number in every section for the same filters.
 *
 *   Net Cash = Collected revenue − Business expenses              (cash basis; NOT "profit" — there is no accrual accounting)
 *   • whole clinic          → Net Cash (collected − shared clinic expenses − every doctor-attributed expense)
 *   • one doctor / a doctor → Doctor Net CONTRIBUTION = that doctor's collected − expenses explicitly attributed to that doctor.
 *                             Shared clinic expenses are NOT allocated to doctors, so contributions do not add up to clinic Net Cash by
 *                             exactly the shared clinic expenses (+ legacy/unassigned revenue).
 */
export interface CoreFinancials {
  collected: number;
  payments: number;
  invoiced: number;
  invoices: number;
  expenses: ExpenseSummary;
  businessExpenses: number;
  netCash: number;
  netKind: "net_cash" | "doctor_contribution";
}

export async function coreFinancials(s: AnalyticsScope, es: DataScope, r: DateRange): Promise<CoreFinancials> {
  const [col, inv, exp] = await Promise.all([collectedTotal(s, r), invoicedTotal(s, r), expenseSummaryFor(es, r)]);
  return {
    collected: col.amount,
    payments: col.payments,
    invoiced: inv.amount,
    invoices: inv.invoices,
    expenses: exp,
    businessExpenses: exp.totals.business,
    netCash: round3(col.amount - exp.totals.business),
    netKind: s.clinicWide ? "net_cash" : "doctor_contribution",
  };
}
