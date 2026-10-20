import { Types } from "mongoose";
import { PatientDoctorAccess, PRIMARY_GRANT_KEY, delegationGrantKey, type AccessSource } from "../models/PatientDoctorAccess";
import { DoctorDelegation, delegationStatus, MAX_SELECTED_PATIENTS, type DelegationScope, type DelegationStatus, type IDoctorDelegation } from "../models/DoctorDelegation";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { PolicyError, isOid } from "../auth/policy";

/**
 * PHASE 1 — WRITING patient access: who gets a primary row when, and how coverage (delegation) is granted / revoked.
 * (READING / deciding access is auth/patientAccess.ts — this module never authorises a request.)
 *
 * Primary rows are created by the server, never by a client body:
 *   · a doctor registers a patient                                   -> that doctor
 *   · an appointment is booked with a doctor (dashboard, walk-in, public booking, AI assistant, reassignment) -> that doctor
 *   · a non-doctor registers a patient in a clinic that has exactly ONE active doctor -> that doctor (nobody else could treat them)
 *   · the owner assigns the patient (POST /api/patient-access/assign)
 *   · the deterministic backfill of pre-existing data (services/patientAccessBackfill.ts)
 * A patient nobody can be deterministically linked to stays UNASSIGNED: visible to the owner and the front desk, hidden from every
 * doctor until the owner assigns him or an appointment is booked. Ownership is never guessed.
 */

const oid = (v: unknown) => new Types.ObjectId(String(v));
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* primary access                                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** The doctor-role users of a clinic, active or not (history may point at a doctor who has since left). */
export async function clinicDoctors(clinicId: string, opts: { activeOnly?: boolean } = {}) {
  return (await User.find({ clinicId, role: "doctor", ...(opts.activeOnly ? { isActive: true } : {}) })
    .select("name isActive")
    .lean()) as { _id: Types.ObjectId; name: string; isActive: boolean }[];
}

/** The id of the clinic's only ACTIVE doctor, or null when there are none or several. */
export async function soleActiveDoctorId(clinicId: string): Promise<string | null> {
  const docs = (await User.find({ clinicId, role: "doctor", isActive: true }).select("_id").limit(2).lean()) as { _id: Types.ObjectId }[];
  return docs.length === 1 ? String(docs[0]._id) : null;
}

/**
 * Make `doctorId` a primary doctor of the patient (idempotent). Both must belong to `clinicId` — otherwise nothing is written.
 * A row the owner switched off is switched back on by this NEW interaction (a booking / registration); the boot-time backfill
 * (which never resurrects) uses its own insert-only path.
 * Returns true when the doctor now has an active primary row.
 */
export async function ensurePrimaryAccess(clinicId: unknown, patientId: unknown, doctorId: unknown, source: AccessSource, createdBy?: unknown): Promise<boolean> {
  const c = String(clinicId), p = String(patientId), d = String(doctorId);
  if (!isOid(c) || !isOid(p) || !isOid(d)) return false;
  const [patient, doctor] = await Promise.all([Patient.exists({ _id: p, clinicId: c }), User.exists({ _id: d, clinicId: c, role: "doctor" })]);
  if (!patient || !doctor) return false;

  const key = { clinicId: c, patientId: p, doctorId: d, grantKey: PRIMARY_GRANT_KEY };
  try {
    await PatientDoctorAccess.updateOne(
      key,
      { $setOnInsert: { accessType: "primary", source, isActive: true, ...(createdBy && isOid(String(createdBy)) ? { createdBy: oid(createdBy) } : {}) } },
      { upsert: true }
    );
  } catch (e) {
    if (!isDup(e)) throw e; // lost a race with a parallel request that inserted the same row
  }
  await PatientDoctorAccess.updateOne({ ...key, isActive: false }, { $set: { isActive: true }, $unset: { revokedAt: "", revokedBy: "" } });
  await propagateToCoverage(c, p, d);
  return true;
}

/** A new patient file was registered by `creator`: a doctor owns what he registers; otherwise the clinic's only active doctor (if any). */
export async function grantNewPatientAccess(clinicId: unknown, patientId: unknown, creator: { userId?: string; role?: string }): Promise<void> {
  const c = String(clinicId);
  if (creator.role === "doctor" && creator.userId) {
    await ensurePrimaryAccess(c, patientId, creator.userId, "created", creator.userId);
    return;
  }
  const sole = await soleActiveDoctorId(c);
  if (sole) await ensurePrimaryAccess(c, patientId, sole, "sole_doctor", creator.userId);
}

/** Owner: make a doctor a primary doctor of a patient. 404s are uniform (patient / doctor of another clinic are "not found"). */
export async function assignPrimary(clinicId: string, patientId: string, doctorId: string, by: string): Promise<void> {
  if (!isOid(patientId) || !(await Patient.exists({ _id: patientId, clinicId }))) throw new PolicyError(404, "PATIENT_NOT_FOUND", "Patient not found");
  if (!isOid(doctorId) || !(await User.exists({ _id: doctorId, clinicId, role: "doctor", isActive: true }))) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
  await ensurePrimaryAccess(clinicId, patientId, doctorId, "assigned", by);
}

/** Owner: switch a doctor's PRIMARY access to a patient off (the row is kept, inactive). Coverage rows are not touched — revoke the delegation. */
export async function removePrimary(clinicId: string, patientId: string, doctorId: string, by: string): Promise<boolean> {
  if (!isOid(patientId) || !isOid(doctorId)) throw new PolicyError(404, "PATIENT_NOT_FOUND", "Patient not found");
  const r = await PatientDoctorAccess.updateOne(
    { clinicId, patientId, doctorId, grantKey: PRIMARY_GRANT_KEY, isActive: true },
    { $set: { isActive: false, revokedAt: new Date(), revokedBy: oid(by) } }
  );
  return r.modifiedCount > 0;
}

/** Patients with an ACTIVE primary row for this doctor — "his patients" (the pool a delegation can cover). */
export async function primaryPatientIds(clinicId: string, doctorId: string): Promise<Types.ObjectId[]> {
  const rows = (await PatientDoctorAccess.find({ clinicId, doctorId, accessType: "primary", isActive: true }).select("patientId").lean()) as { patientId: Types.ObjectId }[];
  return rows.map((r) => r.patientId);
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* delegation (coverage)                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export interface DelegationInput {
  fromDoctorId: string;
  toDoctorId: string;
  scope: DelegationScope;
  patientIds?: string[];
  startsAt?: Date | null;
  expiresAt?: Date | null;
  note?: string;
}

const CHUNK = 500;

/** Insert-or-keep the delegated rows of ONE delegation for the given patients (skips patients the covering doctor already owns). */
async function writeCoverageRows(del: Pick<IDoctorDelegation, "_id" | "clinicId" | "toDoctorId" | "fromDoctorId" | "createdBy" | "startsAt" | "expiresAt">, patientIds: Types.ObjectId[]): Promise<{ granted: number; alreadyPrimary: number }> {
  if (!patientIds.length) return { granted: 0, alreadyPrimary: 0 };
  const owned = (await PatientDoctorAccess.find({ clinicId: del.clinicId, doctorId: del.toDoctorId, accessType: "primary", isActive: true, patientId: { $in: patientIds } })
    .select("patientId")
    .lean()) as { patientId: Types.ObjectId }[];
  const ownSet = new Set(owned.map((r) => String(r.patientId)));
  const todo = patientIds.filter((p) => !ownSet.has(String(p)));
  const grantKey = delegationGrantKey(del._id);
  for (let i = 0; i < todo.length; i += CHUNK) {
    await PatientDoctorAccess.bulkWrite(
      todo.slice(i, i + CHUNK).map((patientId) => ({
        updateOne: {
          filter: { clinicId: del.clinicId, patientId, doctorId: del.toDoctorId, grantKey },
          update: {
            $setOnInsert: {
              accessType: "delegated",
              source: "delegation",
              isActive: true,
              delegationId: del._id,
              delegatedBy: del.createdBy,
              coveringDoctorId: del.fromDoctorId,
              ...(del.startsAt ? { startsAt: del.startsAt } : {}),
              ...(del.expiresAt ? { expiresAt: del.expiresAt } : {}),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  return { granted: todo.length, alreadyPrimary: ownSet.size };
}

/** A patient just became (or was re-linked as) a primary patient of `fromDoctorId`: every active "all" coverage of him covers the new patient too. */
async function propagateToCoverage(clinicId: string, patientId: string, fromDoctorId: string): Promise<void> {
  const now = new Date();
  const dels = (await DoctorDelegation.find({ clinicId, fromDoctorId, scope: "all", isActive: true, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).lean()) as unknown as IDoctorDelegation[];
  for (const d of dels) {
    try {
      await writeCoverageRows(d, [oid(patientId)]);
    } catch (e) {
      if (!isDup(e)) throw e;
    }
  }
}

async function loadDoctorsOfClinic(clinicId: string, ids: string[]) {
  const docs = (await User.find({ _id: { $in: ids }, clinicId, role: "doctor" }).select("name isActive").lean()) as { _id: Types.ObjectId; name: string; isActive: boolean }[];
  return new Map(docs.map((d) => [String(d._id), d]));
}

/**
 * Owner: let `toDoctorId` cover `fromDoctorId`'s patients ("all" = every current and future primary patient while active, or the
 * "selected" ones). Ownership is not transferred. Throws PolicyError(4xx) for anything that is not valid — nothing is written then.
 */
export async function createDelegation(clinicId: string, createdBy: string, input: DelegationInput): Promise<{ delegation: IDoctorDelegation; granted: number; alreadyPrimary: number }> {
  const { fromDoctorId, toDoctorId } = input;
  if (!isOid(fromDoctorId) || !isOid(toDoctorId)) throw new PolicyError(400, "INVALID_DOCTOR", "Invalid doctor id");
  if (fromDoctorId === toDoctorId) throw new PolicyError(400, "SAME_DOCTOR", "A doctor cannot cover himself");
  const docs = await loadDoctorsOfClinic(clinicId, [fromDoctorId, toDoctorId]);
  const from = docs.get(fromDoctorId), to = docs.get(toDoctorId);
  if (!from || !to || !to.isActive) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");

  const now = new Date();
  const startsAt = input.startsAt ?? null, expiresAt = input.expiresAt ?? null;
  if (expiresAt && expiresAt <= now) throw new PolicyError(400, "INVALID_PERIOD", "The end of the coverage must be in the future");
  if (startsAt && expiresAt && expiresAt <= startsAt) throw new PolicyError(400, "INVALID_PERIOD", "The end of the coverage must be after its start");

  let patientIds: Types.ObjectId[] = [];
  if (input.scope === "selected") {
    const wanted = Array.from(new Set((input.patientIds ?? []).map(String)));
    if (!wanted.length || wanted.length > MAX_SELECTED_PATIENTS || !wanted.every(isOid)) throw new PolicyError(400, "INVALID_PATIENTS", "Select between 1 and " + MAX_SELECTED_PATIENTS + " patients");
    const eligible = new Set((await primaryPatientIds(clinicId, fromDoctorId)).map(String));
    if (!wanted.every((p) => eligible.has(p))) throw new PolicyError(400, "PATIENT_NOT_ELIGIBLE", "Only the covered doctor's own patients can be delegated");
    patientIds = wanted.map(oid);
  } else if (input.scope !== "all") {
    throw new PolicyError(400, "INVALID_SCOPE", "Invalid scope");
  }

  const delegation = await DoctorDelegation.create({
    clinicId,
    fromDoctorId,
    toDoctorId,
    scope: input.scope,
    patientIds,
    ...(startsAt ? { startsAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(input.note ? { note: input.note } : {}),
    createdBy,
  });

  const covered = input.scope === "all" ? await primaryPatientIds(clinicId, fromDoctorId) : patientIds;
  const stats = await writeCoverageRows(delegation, covered);
  return { delegation, ...stats };
}

/** Owner: revoke a delegation NOW. The access rows are switched off first, so the permission is gone before the record says so. Idempotent. */
export async function revokeDelegation(clinicId: string, delegationId: string, by: string): Promise<IDoctorDelegation> {
  if (!isOid(delegationId)) throw new PolicyError(404, "DELEGATION_NOT_FOUND", "Delegation not found");
  const del = await DoctorDelegation.findOne({ _id: delegationId, clinicId });
  if (!del) throw new PolicyError(404, "DELEGATION_NOT_FOUND", "Delegation not found");
  if (!del.isActive) return del;
  const at = new Date();
  await PatientDoctorAccess.updateMany({ clinicId, delegationId: del._id, isActive: true }, { $set: { isActive: false, revokedAt: at, revokedBy: oid(by) } });
  del.isActive = false;
  del.revokedAt = at;
  del.revokedBy = oid(by);
  await del.save();
  return del;
}

export interface DelegationDto {
  _id: string;
  fromDoctor: { _id: string; name: string } | null;
  toDoctor: { _id: string; name: string } | null;
  scope: DelegationScope;
  status: DelegationStatus;
  startsAt: string | null;
  expiresAt: string | null;
  note: string | null;
  patientCount: number;
  createdAt: string;
  revokedAt: string | null;
}

/** Delegations of a clinic, newest first, optionally only the ones involving `involvingDoctorId` (a doctor's read-only view) / one status. */
export async function listDelegations(clinicId: string, opts: { status?: DelegationStatus | "all"; involvingDoctorId?: string; limit?: number } = {}): Promise<DelegationDto[]> {
  const filter: Record<string, unknown> = { clinicId };
  if (opts.involvingDoctorId) filter.$or = [{ fromDoctorId: opts.involvingDoctorId }, { toDoctorId: opts.involvingDoctorId }];
  const rows = (await DoctorDelegation.find(filter).sort({ createdAt: -1 }).limit(Math.min(opts.limit ?? 200, 500)).lean()) as unknown as IDoctorDelegation[];
  const now = new Date();
  const wanted = rows.filter((r) => !opts.status || opts.status === "all" || delegationStatus(r, now) === opts.status);
  const ids = new Set<string>();
  wanted.forEach((r) => { ids.add(String(r.fromDoctorId)); ids.add(String(r.toDoctorId)); });
  const users = (await User.find({ _id: { $in: Array.from(ids) }, clinicId }).select("name").lean()) as { _id: Types.ObjectId; name: string }[];
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  const who = (id: unknown) => (name.has(String(id)) ? { _id: String(id), name: name.get(String(id)) as string } : null);
  const counts = await Promise.all(wanted.map((r) => PatientDoctorAccess.countDocuments({ clinicId, delegationId: r._id })));
  return wanted.map((r, i) => ({
    _id: String(r._id),
    fromDoctor: who(r.fromDoctorId),
    toDoctor: who(r.toDoctorId),
    scope: r.scope,
    status: delegationStatus(r, now),
    startsAt: r.startsAt ? new Date(r.startsAt).toISOString() : null,
    expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
    note: r.note ?? null,
    patientCount: counts[i],
    createdAt: new Date(r.createdAt).toISOString(),
    revokedAt: r.revokedAt ? new Date(r.revokedAt).toISOString() : null,
  }));
}
