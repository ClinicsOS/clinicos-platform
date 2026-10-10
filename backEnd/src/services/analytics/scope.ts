import type { Request } from "express";
import mongoose from "mongoose";
import { PolicyError, resolveDataScope, doctorMatchOid, accessOf, type DataScope } from "../../auth/policy";

/**
 * PHASE 6 — WHO is asking and WHAT they may aggregate. Built ONLY from the authenticated request (req.clinicId / req.userId / req.role
 * all come from `protect`, i.e. the database user) — never from a body, a header or a client-supplied clinicId.
 *
 *   owner        → whole clinic; may narrow to ONE doctor with ?doctorId=<id>.
 *   doctor       → ALWAYS their own id. A different doctorId is a 403 (resolveDataScope); the value can never widen the scope.
 *   receptionist → rejected by the route gate (reports access = none) and again here.
 */
export interface AnalyticsScope {
  clinicId: string;
  clinicOid: mongoose.Types.ObjectId;
  userId: string;
  role: "owner" | "doctor" | "receptionist";
  /** "clinic" = the owner; "self" = a doctor. */
  level: "clinic" | "self";
  /** self: the doctor; clinic: the doctor the owner narrowed to (optional). */
  doctorId?: string;
  /** true = the report covers the whole clinic (owner, no doctor filter). */
  clinicWide: boolean;
  /** the Phase 4 data scope for reports (used for doctor match fragments) */
  data: DataScope;
  /** may the caller see clinic-wide-only material (shared expenses, doctor comparison, loyalty, total patients)? */
  canSeeClinicWide: boolean;
}

export function analyticsScope(req: Request): AnalyticsScope {
  const data = resolveDataScope(req, "reports", req.query.doctorId);
  if (data.unassigned) throw new PolicyError(400, "INVALID_DOCTOR", "Pick a doctor, or leave the filter empty for the whole clinic");
  return {
    clinicId: data.clinicId,
    clinicOid: new mongoose.Types.ObjectId(data.clinicId),
    userId: data.userId,
    role: data.role,
    level: data.level,
    doctorId: data.doctorId,
    clinicWide: data.level === "clinic" && !data.doctorId,
    data,
    canSeeClinicWide: accessOf(req.role, "reportsClinic") !== "none" && data.level === "clinic" && !data.doctorId,
  };
}

/** `{ doctorId: ObjectId }` for a doctor scope, `{}` for the whole clinic — for Appointment.doctorId and Invoice.doctorId (aggregate $match). */
export const doctorFilter = (s: AnalyticsScope): Record<string, unknown> => doctorMatchOid(s.data);

/** The Phase 5 expense scope that corresponds to this request (owner: clinic / narrowed to a doctor; doctor: own attributed only). */
export function expenseScopeOf(req: Request): DataScope {
  return resolveDataScope(req, "expenses", req.query.doctorId);
}
