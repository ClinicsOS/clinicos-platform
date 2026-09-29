/**
 * Treatment history is DERIVED from the two source-of-truth records (item.statusHistory + sessions) at read time.
 * One source of truth => no dual writes, no drift between "the plan" and "its history", and a retried request
 * can never produce a duplicate history event.
 */
export type TimelineKind =
  | "plan_created"
  | "treatment_started"
  | "session"
  | "session_finished"
  | "treatment_completed"
  | "treatment_cancelled"
  | "invoiced" // added to an invoice (reference only — payments live in the invoice system)
  | "invoice_released"; // the invoice line no longer exists

export interface TimelineEntry {
  id: string;
  at: Date;
  kind: TimelineKind;
  itemId: string;
  procedureCode: string;
  targetType: string;
  toothNumbers: string[];
  surfaces: string[];
  by: { _id: string; name: string } | null;
  appointmentId?: string;
  sessionNumber?: number;
  reason?: string;
  invoiceNumber?: number;
  amount?: number;
}

export function buildTimeline(items: any[], sessions: any[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const who = (u: any) => (u && u._id ? { _id: String(u._id), name: u.name } : null);
  for (const it of items) {
    const base = { itemId: String(it._id), procedureCode: it.procedureCode, targetType: it.targetType, toothNumbers: it.toothNumbers ?? [], surfaces: it.surfaces ?? [] };
    out.push({ ...base, id: `${it._id}:created`, at: it.createdAt, kind: "plan_created", by: who(it.createdBy) });
    for (const h of it.statusHistory ?? []) {
      if (h.status === "planned") continue; // covered by plan_created
      const kind: TimelineKind = h.status === "in_progress" ? "treatment_started" : h.status === "completed" ? "treatment_completed" : "treatment_cancelled";
      out.push({
        ...base, id: `${it._id}:${h.status}`, at: h.at, kind, by: who(h.by),
        appointmentId: h.appointmentId ? String(h.appointmentId) : undefined,
        reason: h.status === "cancelled" ? it.cancelReason ?? h.note : undefined,
      });
    }
  }
  for (const it of items) {
    (it.billingHistory ?? []).forEach((b: any, i: number) => {
      out.push({
        id: `${it._id}:bill:${i}`, at: b.at, kind: b.event === "invoiced" ? "invoiced" : "invoice_released",
        itemId: String(it._id), procedureCode: it.procedureCode, targetType: it.targetType, toothNumbers: it.toothNumbers ?? [], surfaces: it.surfaces ?? [],
        by: who(b.by), invoiceNumber: b.invoiceNumber, amount: b.event === "invoiced" ? b.amount : undefined, reason: b.event === "released" ? b.reason : undefined,
      });
    });
  }
  for (const s of sessions) {
    const base = { itemId: String(s.itemId), procedureCode: s.procedureCode, targetType: s.targetType, toothNumbers: s.toothNumbers ?? [], surfaces: s.surfaces ?? [] };
    out.push({ ...base, id: `${s._id}:session`, at: s.startedAt, kind: "session", by: who(s.performedBy), appointmentId: String(s.appointmentId), sessionNumber: s.sessionNumber });
    if (s.status === "completed" && s.completedAt && !s.autoClosed) {
      out.push({ ...base, id: `${s._id}:finished`, at: s.completedAt, kind: "session_finished", by: who(s.performedBy), appointmentId: String(s.appointmentId), sessionNumber: s.sessionNumber });
    }
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
