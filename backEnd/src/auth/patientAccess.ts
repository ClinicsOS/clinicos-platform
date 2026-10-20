import type { Request } from "express";
import { Types } from "mongoose";
import { PatientDoctorAccess } from "../models/PatientDoctorAccess";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { PolicyError, accessOf, isOid, type Resource, type Role } from "./policy";

/**
 * PHASE 1 (multi-doctor patient isolation) — THE ONE RULE for "may this user open this patient?".
 *
 * Every patient-sensitive endpoint (patient file, list / search, clinical timeline, notes, dental chart, treatment plans, reports,
 * billing of a treatment, the dashboards, the AI assistant, Connect pickers …) asks THIS module — never its own query:
 *
 *   owner         -> every patient of the clinic                       (ACCESS.patients = "clinic")
 *   receptionist  -> every patient of the clinic (front desk)          (ACCESS.patients = "clinic")
 *   doctor        -> only patients with an ACTIVE access row for him   (ACCESS.patients = "self"):
 *                      · primary    the patient is his (registered / booked / assigned)
 *                      · delegated  covered for another doctor, inside its validity window and not revoked
 *
 * The role -> scope mapping is read from the access matrix in auth/policy.ts (accessOf), not hard-coded here, so the matrix stays the
 * single place where a role's rights are changed.
 *
 * A patient the caller may not open is indistinguishable from one that does not exist (404 "Patient not found"): no existence oracle,
 * for another doctor's patient or another clinic's. clinicId and userId always come from `protect`, never from the request.
 * Nothing in this module logs a name, a phone number or a clinical detail.
 */

export interface PatientViewer {
  clinicId: string;
  userId: string;
  role?: Role;
}

export const viewerOf = (req: Request): PatientViewer => ({ clinicId: req.clinicId as string, userId: req.userId as string, role: req.role });

/** Same identity for callers that have no Express request (the AI tools carry it in their context). Null when it is incomplete. */
export const viewerOfCtx = (ctx: { clinicId?: string; userId?: string; role?: Role }): PatientViewer | null =>
  ctx.clinicId && ctx.userId && ctx.role ? { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role } : null;

export const patientNotFound = () => new PolicyError(404, "PATIENT_NOT_FOUND", "Patient not found");

/** Mongo fragment: the access row is switched on AND inside its validity window right now. Missing start / end = unbounded. */
export function activeAccessFilter(now: Date = new Date()): Record<string, unknown> {
  return {
    isActive: true,
    $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }],
  };
}

const levelOf = (v: PatientViewer, resource: Resource) => {
  const level = accessOf(v.role, resource);
  if (level === "none" || !isOid(v.clinicId) || !isOid(v.userId)) throw new PolicyError(403, "FORBIDDEN_ROLE", "Forbidden");
  return level;
};

/**
 * The patients this user may open: `null` = every patient of the clinic (no restriction), otherwise the exact list of ids.
 * Throws 403 for a role with no patient access at all.
 */
export async function accessiblePatientIds(v: PatientViewer, resource: Resource = "patients", now: Date = new Date()): Promise<Types.ObjectId[] | null> {
  if (levelOf(v, resource) === "clinic") return null;
  const rows = (await PatientDoctorAccess.find({ clinicId: v.clinicId, doctorId: v.userId, ...activeAccessFilter(now) })
    .select("patientId")
    .lean()) as { patientId: Types.ObjectId }[];
  const seen = new Set<string>();
  const out: Types.ObjectId[] = [];
  for (const r of rows) {
    const k = String(r.patientId);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r.patientId);
    }
  }
  return out;
}

/**
 * A doctor's patients split by WHY he can open them: `own` (primary) and `delegated` (covering another doctor, and not also his own).
 * Only meaningful for a restricted viewer — an unrestricted one gets `null` (use the whole clinic).
 */
export async function accessiblePatientIdsByKind(v: PatientViewer, resource: Resource = "patients", now: Date = new Date()): Promise<{ own: Types.ObjectId[]; delegated: Types.ObjectId[] } | null> {
  if (levelOf(v, resource) === "clinic") return null;
  const rows = (await PatientDoctorAccess.find({ clinicId: v.clinicId, doctorId: v.userId, ...activeAccessFilter(now) })
    .select("patientId accessType")
    .lean()) as { patientId: Types.ObjectId; accessType: string }[];
  const own = new Map<string, Types.ObjectId>();
  const del = new Map<string, Types.ObjectId>();
  for (const r of rows) (r.accessType === "primary" ? own : del).set(String(r.patientId), r.patientId);
  for (const k of own.keys()) del.delete(k);
  return { own: Array.from(own.values()), delegated: Array.from(del.values()) };
}

/** `{}` for an unrestricted viewer, otherwise `{ [field]: { $in: ids } }` — merge it into any patient-bearing query. */
export async function patientScopeFilter(v: PatientViewer, field = "patientId", resource: Resource = "patients"): Promise<Record<string, unknown>> {
  const ids = await accessiblePatientIds(v, resource);
  return ids === null ? {} : { [field]: { $in: ids } };
}

/** May this user open this ONE patient? False for a malformed id, a patient of another clinic, an unknown patient, or a doctor without access. */
export async function canAccessPatient(v: PatientViewer, patientId: unknown, resource: Resource = "patients"): Promise<boolean> {
  const pid = typeof patientId === "string" ? patientId : patientId instanceof Types.ObjectId ? String(patientId) : "";
  if (!isOid(pid)) return false;
  let level;
  try {
    level = levelOf(v, resource);
  } catch {
    return false;
  }
  if (level === "clinic") return !!(await Patient.exists({ _id: pid, clinicId: v.clinicId }));
  return !!(await PatientDoctorAccess.exists({ clinicId: v.clinicId, doctorId: v.userId, patientId: pid, ...activeAccessFilter() }));
}

/** Throws the uniform 404 when the user may not open the patient. */
export async function assertCanAccessPatient(v: PatientViewer, patientId: unknown, resource: Resource = "patients"): Promise<void> {
  if (!(await canAccessPatient(v, patientId, resource))) throw patientNotFound();
}

/**
 * The subset of `ids` this user may open (as strings). For an unrestricted viewer: all well-formed ids (the caller's own queries are
 * already clinic-scoped). One query, however many ids.
 */
export async function filterAccessibleIds(v: PatientViewer, ids: unknown[], resource: Resource = "patients"): Promise<Set<string>> {
  const wanted = Array.from(new Set(ids.filter((x) => x !== undefined && x !== null).map(String).filter(isOid)));
  if (!wanted.length) return new Set();
  if (levelOf(v, resource) === "clinic") return new Set(wanted);
  const rows = (await PatientDoctorAccess.find({ clinicId: v.clinicId, doctorId: v.userId, patientId: { $in: wanted }, ...activeAccessFilter() })
    .select("patientId")
    .lean()) as { patientId: Types.ObjectId }[];
  return new Set(rows.map((r) => String(r.patientId)));
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Presentation helpers: WHY can this user see this patient? (list badges). Never used to authorise anything.                      */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export interface PatientAccessInfo {
  /** own = the doctor's patient · delegated = covering another doctor · clinic = owner / front desk (see `doctors`) */
  kind: "own" | "delegated" | "clinic";
  /** doctor viewer, delegated: the doctor(s) being covered. */
  covering: { _id: string; name: string }[];
  /** doctor viewer, delegated: when the earliest coverage ends (null = until revoked). */
  until: string | null;
  /** owner / front-desk viewer: the doctors the patient belongs to (empty = unassigned). */
  doctors: { _id: string; name: string }[];
}

export async function describeAccess(v: PatientViewer, patientIds: unknown[]): Promise<Map<string, PatientAccessInfo>> {
  const ids = Array.from(new Set(patientIds.map(String).filter(isOid)));
  const out = new Map<string, PatientAccessInfo>();
  if (!ids.length) return out;
  const level = levelOf(v, "patients");
  const now = new Date();

  const nameIds = new Set<string>();
  if (level === "clinic") {
    const rows = (await PatientDoctorAccess.find({ clinicId: v.clinicId, patientId: { $in: ids }, accessType: "primary", ...activeAccessFilter(now) })
      .select("patientId doctorId")
      .lean()) as { patientId: Types.ObjectId; doctorId: Types.ObjectId }[];
    rows.forEach((r) => nameIds.add(String(r.doctorId)));
    const names = await nameMap(v.clinicId, nameIds);
    for (const id of ids) out.set(id, { kind: "clinic", covering: [], until: null, doctors: [] });
    for (const r of rows) out.get(String(r.patientId))?.doctors.push({ _id: String(r.doctorId), name: names.get(String(r.doctorId)) ?? "—" });
    return out;
  }

  const rows = (await PatientDoctorAccess.find({ clinicId: v.clinicId, doctorId: v.userId, patientId: { $in: ids }, ...activeAccessFilter(now) })
    .select("patientId accessType coveringDoctorId expiresAt")
    .lean()) as { patientId: Types.ObjectId; accessType: string; coveringDoctorId?: Types.ObjectId; expiresAt?: Date }[];
  rows.forEach((r) => r.coveringDoctorId && nameIds.add(String(r.coveringDoctorId)));
  const names = await nameMap(v.clinicId, nameIds);
  for (const r of rows) {
    const key = String(r.patientId);
    const cur = out.get(key) ?? { kind: "delegated" as const, covering: [], until: null, doctors: [] };
    if (r.accessType === "primary") cur.kind = "own";
    else if (r.coveringDoctorId) {
      const id = String(r.coveringDoctorId);
      if (!cur.covering.some((c) => c._id === id)) cur.covering.push({ _id: id, name: names.get(id) ?? "—" });
      if (r.expiresAt) {
        const iso = new Date(r.expiresAt).toISOString();
        if (!cur.until || iso < cur.until) cur.until = iso;
      }
    }
    out.set(key, cur);
  }
  return out;
}

async function nameMap(clinicId: string, ids: Set<string>): Promise<Map<string, string>> {
  if (!ids.size) return new Map();
  const users = (await User.find({ _id: { $in: Array.from(ids) }, clinicId }).select("name").lean()) as { _id: Types.ObjectId; name: string }[];
  return new Map(users.map((u) => [String(u._id), u.name]));
}
