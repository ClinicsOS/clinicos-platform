import mongoose from "mongoose";
import { User } from "../models/User";
import { Appointment } from "../models/Appointment";
import type { Request } from "express";
import { PolicyError, isOid, accessOf, type DataScope } from "../auth/policy";

/**
 * PHASE 4 — TREATING-DOCTOR ATTRIBUTION (who an invoice's revenue belongs to).
 *
 * Rules (the safe, deterministic ones — nothing here ever guesses):
 *   1. The invoice CREATOR is never the treating doctor. A receptionist who creates / collects an invoice earns it nothing.
 *   2. A treatment billed through "Add to Invoice" is attributed to the clinician who actually COMPLETED it:
 *        a) the user recorded as completing the item (server-written `statusHistory[completed].by`) when that user is a doctor;
 *        b) otherwise (an owner completed it) the doctor of the VISIT it was completed in (Appointment.doctorId);
 *        c) otherwise unattributed (null) — reported as "unassigned", never assigned to somebody at random.
 *   3. A manually created invoice takes the doctor of the linked appointment, or the doctor the staff member explicitly picked
 *      (a doctor-role user can only pick themselves). With neither it stays unassigned.
 *   4. Every doctor id is verified to be a doctor of THIS clinic before it is stored.
 *   5. Invoices that predate Phase 4 have no doctor: they stay unassigned until an owner assigns one explicitly.
 */

export type DoctorRef = string | null;

/** An existing doctor-role user of this clinic (active or not — history may point at a doctor who has since left). */
export async function findClinicDoctor(clinicId: unknown, doctorId: unknown, opts: { activeOnly?: boolean } = {}) {
  if (!isOid(String(doctorId))) return null;
  return User.findOne({ _id: doctorId, clinicId, role: "doctor", ...(opts.activeOnly ? { isActive: true } : {}) }).select("name role isActive");
}

/**
 * Who treated this COMPLETED treatment item? (see rule 2). `item.statusHistory` is the server-written history.
 * Two small lookups at most (one user, one appointment), only on the billing path.
 */
export async function resolveTreatingDoctor(clinicId: unknown, item: { statusHistory?: any[] }): Promise<{ doctorId: DoctorRef; via: "completed_by" | "visit_doctor" | "none" }> {
  const done = [...(item.statusHistory ?? [])].reverse().find((h) => h?.status === "completed");
  if (!done) return { doctorId: null, via: "none" };
  if (done.by && isOid(String(done.by))) {
    const who = await User.findOne({ _id: done.by, clinicId }).select("role");
    if (who?.role === "doctor") return { doctorId: String(who._id), via: "completed_by" };
  }
  if (done.appointmentId && isOid(String(done.appointmentId))) {
    const visit = await Appointment.findOne({ _id: done.appointmentId, clinicId }).select("doctorId");
    if (visit?.doctorId) return { doctorId: String(visit.doctorId), via: "visit_doctor" };
  }
  return { doctorId: null, via: "none" };
}

/**
 * Batched version of resolveTreatingDoctor for a dashboard list (no per-item queries): one user query + one appointment query
 * for the whole list. Same rule, same result per item.
 */
export async function resolveTreatingDoctors(clinicId: unknown, items: { _id: unknown; statusHistory?: any[] }[]): Promise<Map<string, DoctorRef>> {
  const out = new Map<string, DoctorRef>();
  const done = new Map<string, any>();
  const userIds = new Set<string>();
  for (const it of items) {
    const h = [...(it.statusHistory ?? [])].reverse().find((x) => x?.status === "completed");
    if (!h) { out.set(String(it._id), null); continue; }
    done.set(String(it._id), h);
    if (h.by && isOid(String(h.by))) userIds.add(String(h.by));
  }
  const users = userIds.size ? await User.find({ _id: { $in: Array.from(userIds) }, clinicId }).select("role").lean() : [];
  const roleOf = new Map((users as any[]).map((u) => [String(u._id), u.role as string]));
  const apptIds = new Set<string>();
  done.forEach((h) => { if (!(h.by && roleOf.get(String(h.by)) === "doctor") && h.appointmentId && isOid(String(h.appointmentId))) apptIds.add(String(h.appointmentId)); });
  const appts = apptIds.size ? await Appointment.find({ _id: { $in: Array.from(apptIds) }, clinicId }).select("doctorId").lean() : [];
  const doctorOfVisit = new Map((appts as any[]).map((a) => [String(a._id), a.doctorId ? String(a.doctorId) : null]));
  done.forEach((h, id) => {
    if (h.by && roleOf.get(String(h.by)) === "doctor") out.set(id, String(h.by));
    else out.set(id, h.appointmentId ? doctorOfVisit.get(String(h.appointmentId)) ?? null : null);
  });
  return out;
}

/**
 * Attribution for a manually created invoice (POST /api/invoices). `scope` is the caller's "invoices" data scope.
 *   - doctor-role caller: always themself; naming another doctor is a 403.
 *   - owner / receptionist: the explicitly chosen doctor (must belong to the clinic), else the linked appointment's doctor, else none.
 */
export async function resolveManualInvoiceDoctor(
  scope: DataScope,
  input: { doctorId?: string; appointmentId?: string; patientId: string }
): Promise<DoctorRef> {
  let appointmentDoctor: DoctorRef = null;
  if (input.appointmentId) {
    const appt = await Appointment.findOne({ _id: input.appointmentId, clinicId: scope.clinicId, patientId: input.patientId }).select("doctorId type");
    if (!appt) throw new PolicyError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found for this patient");
    if (appt.doctorId) appointmentDoctor = String(appt.doctorId);
  }

  if (scope.level === "self") {
    if (input.doctorId !== undefined && input.doctorId !== scope.userId) throw new PolicyError(403, "FORBIDDEN_SCOPE", "You can only create invoices for your own patients' treatments");
    // a doctor linking another doctor's appointment would hand that doctor's visit revenue to themselves
    if (appointmentDoctor && appointmentDoctor !== scope.userId) throw new PolicyError(403, "FORBIDDEN_SCOPE", "This appointment belongs to another doctor");
    return scope.userId;
  }

  if (input.doctorId !== undefined) {
    const d = await findClinicDoctor(scope.clinicId, input.doctorId, { activeOnly: true });
    if (!d) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
    return String(d._id);
  }
  return appointmentDoctor;
}

export const toOid = (v: string) => new mongoose.Types.ObjectId(v);

/** The billing-service context for a request: the AUTHENTICATED clinic / user, and the doctor restriction for a doctor-role caller. */
export const billingCtxOf = (req: Request, patientId?: unknown) => ({
  clinicId: req.clinicId,
  userId: req.userId,
  ...(patientId !== undefined ? { patientId } : {}),
  ...(accessOf(req.role, "invoices") === "self" ? { restrictToDoctorId: req.userId } : {}),
});
