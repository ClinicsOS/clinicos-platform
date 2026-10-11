import { Types } from "mongoose";
import { Appointment } from "../../models/Appointment";
import { Patient } from "../../models/Patient";
import { User } from "../../models/User";
import { ConnectMessage, type ContentType } from "../../models/ConnectMessage";
import { PolicyError, accessOf, canSeeDoctorOwned, isOid, scopeOf, type Role } from "../../auth/policy";
import { clinicYmdOf } from "../../utils/timezone";
import { loadAccessibleConversation, notFound, type ChatCtx } from "./conversations";

/**
 * CLINICOS CONNECT (C4) — Appointment / Patient REFERENCES inside a conversation.
 *
 * ┌─ THE RULE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ A card is a REFERENCE, never an authorisation.                                                                              │
 * │  • The message stores only `contentType` + `referenceId` (+ the sender's optional note). No name, phone, date, diagnosis or  │
 * │    any other snapshot of the record is ever copied into Connect.                                                             │
 * │  • Who may SHARE a record, and who may SEE its card, is decided by the SAME policy the rest of ClinicOS uses                │
 * │    (auth/policy.ts: ACCESS matrix, scopeOf, canSeeDoctorOwned) — Connect has no permission system of its own:               │
 * │        patient      → accessOf(role, "patients") — every clinic role today (patients are shared per clinic)                  │
 * │        appointment  → scopeOf(…, "appointments") + canSeeDoctorOwned — owner / receptionist: the clinic, a doctor: their own │
 * │  • The card is resolved when it is READ, with the viewer's CURRENT role and the record's CURRENT state, one batch per page.   │
 * │    So removing someone's access, renaming a patient or cancelling an appointment is reflected on the next load, and nothing   │
 * │    sensitive is cached in a message, a socket event or the conversation list.                                                │
 * │  • Anything that is missing, belongs to another clinic or is not visible to the sender is the SAME answer (404), so Connect   │
 * │    is not an existence oracle. For a recipient the answers are only: ok | restricted (no data at all) | unavailable.         │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 * Nothing in this module logs a name, a message or an appointment detail.
 */
export type RefType = "appointment" | "patient";
export type RefContentType = Exclude<ContentType, "text">;
export const CONTENT_OF: Record<RefType, RefContentType> = { appointment: "appointment_reference", patient: "patient_reference" };
export const REF_OF: Record<RefContentType, RefType> = { appointment_reference: "appointment", patient_reference: "patient" };

/** The identity every permission check runs for: all three values come from the verified database record of the signed-in user. */
export interface Viewer {
  clinicId: string;
  userId: string;
  role: Role;
}

export function viewerOf(ctx: ChatCtx): Viewer {
  if (!ctx.role) throw new PolicyError(403, "FORBIDDEN_ROLE", "Forbidden");
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role };
}

export const referenceUnavailable = () => new PolicyError(404, "REFERENCE_NOT_FOUND", "This item is not available");

/* ------------------------------------------------------------------ permission (the real ClinicOS policy, applied to ONE record) */

/** Patients are shared per clinic: any role that has the "patients" resource may see a patient of ITS clinic. */
export const canViewPatient = (v: Viewer): boolean => accessOf(v.role, "patients") !== "none";

/** Appointments: the board's rule — the clinic for owner / receptionist, only their own for a doctor. */
export function canViewAppointment(v: Viewer, doctorId: unknown): boolean {
  try {
    return canSeeDoctorOwned(scopeOf({ clinicId: v.clinicId, userId: v.userId, role: v.role }, "appointments"), doctorId);
  } catch {
    return false; // role without any access to appointments
  }
}

/* ------------------------------------------------------------------ sharing (send side) */

/**
 * The sender must be able to see the record under the normal ClinicOS rules, and it must be in the SENDER'S clinic. Returns the record id.
 * Malformed ids are a 400; missing / other clinic / not allowed / a blocked slot are all the same 404.
 */
export async function assertCanShare(v: Viewer, type: RefType, rawId: unknown): Promise<Types.ObjectId> {
  if (!isOid(rawId)) throw new PolicyError(400, "INVALID_REFERENCE", "Invalid reference");
  const id = new Types.ObjectId(rawId);
  if (type === "patient") {
    if (!canViewPatient(v)) throw referenceUnavailable();
    const found = await Patient.exists({ _id: id, clinicId: v.clinicId });
    if (!found) throw referenceUnavailable();
    return id;
  }
  // a real appointment only: a doctor's blocked slot is not a visit (and carries no patient)
  const appt = await Appointment.findOne({ _id: id, clinicId: v.clinicId, type: { $ne: "blocked" } }).select("doctorId").lean();
  if (!appt || !canViewAppointment(v, appt.doctorId)) throw referenceUnavailable();
  return id;
}

/* ------------------------------------------------------------------ resolving cards (read side) */

export interface PatientCard {
  id: string;
  fullName: string;
  fileNumber: number;
}
export interface AppointmentCard {
  id: string;
  startAt: Date;
  /** The clinic-calendar day (YYYY-MM-DD) — used by the deep link into the schedule, so the browser's own time zone never decides it. */
  day: string;
  duration: number;
  status: string;
  /** null when the viewer's role has no access to patients (never the case today). */
  patientName: string | null;
  doctorName: string | null;
}
export type Card =
  | { messageId: string; contentType: "patient_reference"; state: "ok"; patient: PatientCard }
  | { messageId: string; contentType: "appointment_reference"; state: "ok"; appointment: AppointmentCard }
  | { messageId: string; contentType: RefContentType; state: "restricted" | "unavailable" };

interface PatientRow {
  _id: Types.ObjectId;
  fullName: string;
  fileNumber: number;
}
interface ApptRow {
  _id: Types.ObjectId;
  patientId?: Types.ObjectId;
  doctorId?: Types.ObjectId;
  startAt: Date;
  duration: number;
  status: string;
}

/** Appointment card fields for a viewer who is ALREADY allowed to see the appointment. */
export function appointmentCardOf(a: ApptRow, v: Viewer, patients: Map<string, PatientRow>, doctors: Map<string, string>): AppointmentCard {
  const pat = a.patientId && canViewPatient(v) ? patients.get(String(a.patientId)) : undefined;
  return {
    id: String(a._id),
    startAt: a.startAt,
    day: clinicYmdOf(a.startAt),
    duration: a.duration,
    status: a.status,
    patientName: pat ? pat.fullName : null,
    doctorName: a.doctorId ? doctors.get(String(a.doctorId)) ?? null : null,
  };
}

/**
 * POST /conversations/:id/cards { messageIds } — the cards of the reference messages the caller names, for THIS caller, right now.
 * Three queries for the whole page (patients, appointments + their patients/doctors, doctors) however many cards there are:
 * no per-message lookups. Ids that are not reference messages of this (accessible) conversation are simply left out.
 */
export async function resolveCards(ctx: ChatCtx, conversationId: string, rawIds: unknown): Promise<Card[]> {
  const v = viewerOf(ctx);
  if (!Array.isArray(rawIds) || rawIds.length > 100) throw new PolicyError(400, "INVALID_QUERY", "Invalid message list");
  if (!rawIds.every(isOid)) throw new PolicyError(400, "INVALID_ID", "Invalid ID format");
  const conv = await loadAccessibleConversation(ctx, conversationId);
  if (!conv) throw notFound();
  const ids = Array.from(new Set((rawIds as string[]).map((x) => x.toLowerCase())));
  if (!ids.length) return [];

  const msgs = await ConnectMessage.find({
    _id: { $in: ids },
    conversationId: conv._id,
    clinicId: v.clinicId,
    contentType: { $in: ["appointment_reference", "patient_reference"] },
  })
    .select("contentType referenceId")
    .lean();

  const patientIds = new Set<string>();
  const apptIds = new Set<string>();
  for (const m of msgs) {
    if (!m.referenceId) continue;
    (m.contentType === "patient_reference" ? patientIds : apptIds).add(String(m.referenceId));
  }

  // appointments first (their patients / doctors are needed for the cards); every query is scoped to the viewer's clinic
  const appts = apptIds.size
    ? await Appointment.find({ _id: { $in: Array.from(apptIds) }, clinicId: v.clinicId, type: { $ne: "blocked" } })
        .select("patientId doctorId startAt duration status")
        .lean<ApptRow[]>()
    : [];
  const allowedAppts = appts.filter((a) => canViewAppointment(v, a.doctorId));
  const neededPatients = new Set(patientIds);
  if (canViewPatient(v)) for (const a of allowedAppts) if (a.patientId) neededPatients.add(String(a.patientId));
  const [patientRows, doctorRows] = await Promise.all([
    neededPatients.size ? Patient.find({ _id: { $in: Array.from(neededPatients) }, clinicId: v.clinicId }).select("fullName fileNumber").lean<PatientRow[]>() : Promise.resolve([] as PatientRow[]),
    allowedAppts.length
      ? User.find({ _id: { $in: Array.from(new Set(allowedAppts.map((a) => String(a.doctorId)).filter((x) => x && x !== "undefined"))) }, clinicId: v.clinicId }).select("name").lean()
      : Promise.resolve([]),
  ]);
  const patients = new Map(patientRows.map((p) => [String(p._id), p]));
  const doctors = new Map((doctorRows as { _id: Types.ObjectId; name: string }[]).map((d) => [String(d._id), d.name]));
  const apptById = new Map(appts.map((a) => [String(a._id), a]));

  const out: Card[] = [];
  for (const m of msgs) {
    const messageId = String(m._id);
    const contentType = m.contentType as RefContentType;
    const refId = m.referenceId ? String(m.referenceId) : "";
    if (contentType === "patient_reference") {
      const p = patients.get(refId);
      if (!p) out.push({ messageId, contentType, state: "unavailable" });
      else if (!canViewPatient(v)) out.push({ messageId, contentType, state: "restricted" });
      else out.push({ messageId, contentType, state: "ok", patient: { id: String(p._id), fullName: p.fullName, fileNumber: p.fileNumber } });
    } else {
      const a = apptById.get(refId);
      if (!a) out.push({ messageId, contentType, state: "unavailable" });
      else if (!canViewAppointment(v, a.doctorId)) out.push({ messageId, contentType, state: "restricted" }); // exists, but not for THIS viewer: no data, no id
      else out.push({ messageId, contentType, state: "ok", appointment: appointmentCardOf(a, v, patients, doctors) });
    }
  }
  return out;
}
