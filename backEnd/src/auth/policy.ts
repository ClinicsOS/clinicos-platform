import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

/**
 * PHASE 4 — the ONE place that answers "who may see / change what" in ClinicOS.
 *
 * Authentication is unchanged (middleware/auth.ts `protect` sets req.userId / req.clinicId / req.role from the DATABASE,
 * never from the client). This module sits on top of it and adds the multi-doctor rules:
 *
 *   - ACCESS         the access matrix as data: for every RESOURCE and every ROLE the data scope is
 *                      "clinic" -> every record of the clinic,   "self" -> only the signed-in doctor's own records,
 *                      "none"   -> not allowed at all.
 *   - requireAccess  route middleware: rejects a role that has "none" for a resource (403).
 *   - resolveDataScope  turns (request, resource) into a DataScope the controller applies to its query. A doctor's scope is
 *                      ALWAYS their own user id; any doctorId the client sends can only NARROW a clinic-wide scope, never
 *                      widen a doctor's. Asking for another doctor's data as a doctor is a 403.
 *   - doctorMatch / doctorMatchOid  the query fragment for a scope (string ids for find(), ObjectIds for aggregate()).
 *   - canSeeDoctorOwned / assertWritableDoctor  the same rule for a single record / a doctorId in a write body.
 *
 * Nothing here queries the database: the role comes from `protect`, which already loaded the user once per request.
 *
 * "Shared" vs "private":
 *   shared per clinic  — patients, the patient file, dental chart, treatment plan, clinical notes, timeline, loyalty.
 *                        (A patient is not "owned" by one doctor; every clinical user must be able to open the file.)
 *   private per doctor — invoices / payments / revenue / analytics attributed to a treating doctor, and a doctor's own
 *                        appointment board. These are the only resources whose doctor scope is "self".
 */

export type Role = "owner" | "doctor" | "receptionist";
export type AccessLevel = "clinic" | "self" | "none";

export const ROLES: readonly Role[] = ["owner", "doctor", "receptionist"];

export const RESOURCES = [
  "appointments", // the board / list, creating, rescheduling, status changes, walk-ins, blocks
  "patients", // registration, lookup, patient file header
  "patientClinical", // READ of dental chart, treatment plan, clinical notes, timeline, derm records
  "clinicalWrite", // WRITE of the above (notes, chart, treatment plan, sessions)
  "invoices", // list / create / edit
  "payments", // recording a payment
  "reports", // /api/reports/* and /api/analytics/*  (analytics): owner = clinic, doctor = own data, receptionist = none
  "reportsClinic", // PHASE 6 — clinic-wide-only analytics material (doctor comparison, loyalty, shared expenses, total patients): owner only
  "dashboardCounts", // appointment counts on the dashboard
  "dashboardRevenue", // money on the dashboard
  "expenses", // PHASE 5 — READ the expense ledger: owner = whole clinic, doctor = only expenses attributed to them
  "expensesManage", // PHASE 5 — create / edit / delete expenses, monthly bills, the owner's personal expenses, the month overview; owner only
  "staff", // create / edit / (de)activate staff, per-doctor working hours
  "clinicSettings", // clinic profile, working hours, export, delete
  "internalChat", // CLINICOS CONNECT (C1) — may use the internal chat at all. Every role may; WHICH conversations is decided by membership (services/connect), never by role
] as const;
export type Resource = (typeof RESOURCES)[number];

/** THE ACCESS MATRIX. Change a role's rights here — every route and controller reads this table. */
export const ACCESS: Readonly<Record<Resource, Readonly<Record<Role, AccessLevel>>>> = {
  appointments: { owner: "clinic", doctor: "self", receptionist: "clinic" },
  patients: { owner: "clinic", doctor: "clinic", receptionist: "clinic" },
  patientClinical: { owner: "clinic", doctor: "clinic", receptionist: "clinic" },
  clinicalWrite: { owner: "clinic", doctor: "clinic", receptionist: "none" },
  invoices: { owner: "clinic", doctor: "self", receptionist: "clinic" },
  payments: { owner: "clinic", doctor: "self", receptionist: "clinic" },
  reports: { owner: "clinic", doctor: "self", receptionist: "none" },
  reportsClinic: { owner: "clinic", doctor: "none", receptionist: "none" },
  dashboardCounts: { owner: "clinic", doctor: "self", receptionist: "clinic" },
  dashboardRevenue: { owner: "clinic", doctor: "self", receptionist: "none" },
  expenses: { owner: "clinic", doctor: "self", receptionist: "none" },
  expensesManage: { owner: "clinic", doctor: "none", receptionist: "none" },
  staff: { owner: "clinic", doctor: "none", receptionist: "none" },
  clinicSettings: { owner: "clinic", doctor: "none", receptionist: "none" },
  internalChat: { owner: "clinic", doctor: "clinic", receptionist: "clinic" },
};

export const accessOf = (role: Role | undefined, resource: Resource): AccessLevel =>
  role && ROLES.includes(role) ? ACCESS[resource][role] : "none";

/** What the signed-in role may do, for the UI (GET /api/auth/me). The UI only uses this to decide what to SHOW. */
export const accessFor = (role: Role): Record<Resource, AccessLevel> =>
  Object.fromEntries(RESOURCES.map((r) => [r, ACCESS[r][role]])) as Record<Resource, AccessLevel>;

/** Thrown by the helpers below; errorHandler turns it into a JSON response with this status / code. */
export class PolicyError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

/** Route middleware: the role must have SOME access ("clinic" or "self") to the resource. */
export const requireAccess =
  (resource: Resource) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (accessOf(req.role, resource) === "none") return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN_ROLE" });
    next();
  };

/** Alias of the existing role gate, exported here so new code needs only one import for authorization. */
export { authorize as requireRole } from "../middleware/auth";

export const OID_RE = /^[a-f\d]{24}$/i;
export const isOid = (v: unknown): v is string => typeof v === "string" && OID_RE.test(v);

export interface DataScope {
  clinicId: string;
  userId: string;
  role: Role;
  resource: Resource;
  level: "clinic" | "self";
  /** "self": the signed-in doctor. "clinic": the doctor the caller narrowed to (optional). */
  doctorId?: string;
  /** "clinic" only: legacy / unattributed records (no treating doctor). */
  unassigned?: boolean;
}

/**
 * The data scope of this request for a resource.
 *   - role has "none"            -> PolicyError 403
 *   - doctor ("self")            -> the doctor's own id. A requested doctorId that is not their own -> 403 (never ignored silently
 *                                   for a malformed attempt to read someone else's data); "unassigned" -> 403
 *   - owner / receptionist       -> clinic-wide; `requestedDoctor` (a 24-hex id, or "unassigned") optionally narrows it.
 * A malformed id is a 400. clinicId always comes from `protect` (req.clinicId), never from the request.
 */
export function resolveDataScope(req: Request, resource: Resource, requestedDoctor?: unknown): DataScope {
  return scopeOf({ clinicId: req.clinicId, userId: req.userId, role: req.role }, resource, requestedDoctor);
}

/** Same as resolveDataScope for callers that have no Express request (the AI chat tools carry the identity in their context). */
export function scopeOf(id: { clinicId?: string; userId?: string; role?: Role }, resource: Resource, requestedDoctor?: unknown): DataScope {
  const role = id.role;
  const level = accessOf(role, resource);
  if (!role || level === "none" || !id.clinicId || !id.userId) throw new PolicyError(403, "FORBIDDEN_ROLE", "Forbidden");

  const raw = requestedDoctor === undefined || requestedDoctor === null || requestedDoctor === "" || requestedDoctor === "all" ? undefined : String(requestedDoctor);
  const base = { clinicId: id.clinicId, userId: id.userId, role, resource };

  if (level === "self") {
    if (raw !== undefined && raw !== id.userId) throw new PolicyError(403, "FORBIDDEN_SCOPE", "You can only access your own records");
    return { ...base, level: "self", doctorId: id.userId };
  }
  if (raw === undefined) return { ...base, level: "clinic" };
  if (raw === "unassigned") return { ...base, level: "clinic", unassigned: true };
  if (!isOid(raw)) throw new PolicyError(400, "INVALID_DOCTOR", "Invalid doctor id");
  return { ...base, level: "clinic", doctorId: raw };
}

/** Query fragment for find()/countDocuments(): `{}` for an unfiltered clinic scope. `field` is the record's doctor field. */
export function doctorMatch(scope: DataScope, field = "doctorId"): Record<string, unknown> {
  if (scope.unassigned) return { [field]: null }; // null matches a missing / null field
  if (scope.doctorId) return { [field]: scope.doctorId };
  return {};
}

/** Same fragment with real ObjectIds, for aggregate() $match stages (aggregation does not cast strings). */
export function doctorMatchOid(scope: DataScope, field = "doctorId"): Record<string, unknown> {
  if (scope.unassigned) return { [field]: null };
  if (scope.doctorId) return { [field]: new mongoose.Types.ObjectId(scope.doctorId) };
  return {};
}

/** Can this scope see a single record whose treating doctor is `ownerDoctorId` (undefined / null = unattributed legacy record)? */
export function canSeeDoctorOwned(scope: DataScope, ownerDoctorId: unknown): boolean {
  if (scope.level === "clinic") {
    if (scope.unassigned) return !ownerDoctorId;
    if (scope.doctorId) return !!ownerDoctorId && String(ownerDoctorId) === scope.doctorId;
    return true;
  }
  return !!ownerDoctorId && String(ownerDoctorId) === scope.userId;
}

/**
 * A doctorId that arrives in a WRITE body (new appointment, new invoice, reassignment). A doctor may only write for themselves;
 * owner / receptionist may name any doctor (the caller still verifies that doctor belongs to the clinic).
 */
export function assertWritableDoctor(scope: DataScope, doctorId: string | undefined): void {
  if (scope.level === "self" && doctorId !== undefined && doctorId !== scope.userId) {
    throw new PolicyError(403, "FORBIDDEN_SCOPE", "You can only act on your own records");
  }
}

/** Business flag used by the dashboard / reports: may this role see money at all? */
export const canSeeMoney = (role: Role | undefined) => accessOf(role, "dashboardRevenue") !== "none";

/** Clinic management rights (staff, settings, re-assigning an invoice's doctor, seeing contact details of colleagues): owner only today. */
export const canManageClinic = (role: Role | undefined) => accessOf(role, "clinicSettings") === "clinic";
