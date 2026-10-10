/**
 * PHASE 6 — CSV export. The rows are built FROM THE SAME section payloads the screens use (so an export can never disagree with the page
 * and can never contain data the caller's scope did not already allow). Cells that could be read as a spreadsheet formula are neutralised.
 */
type Json = Record<string, any>;

const esc = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV / formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells: unknown[]) => cells.map(esc).join(",");
const cur = (k: Json | null | undefined) => (k ? k.current : "");

export function toCsv(section: string, d: Json): { filename: string; body: string } {
  const out: string[] = [];
  const head = (title: string) => { out.push(""); out.push(line([title])); };
  out.push(line(["ClinicOS analytics", section]));
  out.push(line(["From", d.range.from, "To", d.range.to, "Time zone", d.timeZone]));
  if (d.scope?.doctorId) out.push(line(["Scope", "single doctor"]));

  const kpis = (k: Json | undefined, title = "Key figures") => {
    if (!k) return;
    head(title);
    out.push(line(["Metric", "Current", "Previous", "Change %"]));
    for (const [name, v] of Object.entries(k)) if (v) out.push(line([name, cur(v as Json), (v as Json).previous ?? "", (v as Json).pct ?? ""]));
  };
  const trend = (t: Json | undefined, cols: string[]) => {
    if (!t) return;
    head(`Trend (${t.granularity})`);
    out.push(line(["Period", ...cols]));
    for (const p of t.points) out.push(line([p.key, ...cols.map((c) => p[c])]));
  };
  const table = (title: string, rows: Json[] | undefined, cols: string[]) => {
    if (!rows?.length) return;
    head(title);
    out.push(line(cols));
    for (const r of rows) out.push(line(cols.map((c) => r[c])));
  };

  switch (section) {
    case "overview":
      kpis(d.kpis);
      trend(d.trend, ["collected", "invoiced", "expenses", "net"]);
      break;
    case "financial":
      kpis(d.kpis);
      trend(d.trend, ["collected", "invoiced", "expenses", "net"]);
      table("Collected by payment method", d.collectedByMethod, ["method", "amount", "payments"]);
      table("Collected by doctor", d.revenueByDoctor?.map((r: Json) => ({ ...r, name: r.unassigned ? "Unassigned / legacy" : r.name })), ["name", "collected"]);
      table("Expenses by category", d.expenses?.byCategory, ["category", "total", "clinic", "doctor"]);
      table("Billed value by treatment (before invoice discount)", d.billedByService?.byTreatment, ["code", "treatments", "amount"]);
      break;
    case "appointments":
      kpis(d.kpis);
      trend(d.trend, ["total", "completed", "walkIn"]);
      table("By doctor", d.byDoctor, ["name", "total", "completed", "cancelled", "noShow", "walkIn"]);
      table("By weekday (non-cancelled)", d.byWeekday, ["weekday", "appointments"]);
      table("By hour (non-cancelled)", d.byHour, ["hour", "appointments"]);
      break;
    case "patients":
      kpis(d.kpis);
      trend(d.trend, ["seen", "registered"]);
      break;
    case "treatments":
      kpis(d.kpis);
      table("By procedure", d.byProcedure, ["code", "count", "estimatedValue"]);
      table("By doctor", d.byDoctor?.map((r: Json) => ({ ...r, name: r.unassigned ? "Unassigned" : r.name })), ["name", "count", "estimatedValue"]);
      break;
    case "doctors":
      table("Doctors", d.rows, ["name", "appointments", "completedVisits", "walkIns", "cancelled", "noShow", "patientsSeen", "treatmentsCompleted", "collected", "attributedExpenses", "netContribution", "avgCollectedPerVisit"]);
      if (d.unassignedRevenue !== null && d.unassignedRevenue !== undefined) out.push(line(["Unassigned / legacy collected revenue", d.unassignedRevenue]));
      break;
    case "expenses":
      kpis(d.kpis);
      trend(d.trend, ["total", "clinic", "doctor"]);
      table("By category", d.byCategory, ["category", "total", "clinic", "doctor"]);
      table("By doctor", d.byDoctor, ["name", "total"]);
      break;
    case "loyalty":
      head("Loyalty");
      for (const [k, v] of Object.entries({ enrolled: d.enrolled, activeMembers: d.activeMembers, newMembers: d.newMembers, ...d.points })) out.push(line([k, v]));
      table("Top rewards", d.topRewards, ["name", "requested", "confirmed", "pointsRedeemed"]);
      table("Tier distribution", d.tiers, ["tier", "members"]);
      break;
  }
  return { filename: `clinicos-${section}-${d.range.from}_${d.range.to}.csv`, body: "﻿" + out.join("\r\n") + "\r\n" };
}
