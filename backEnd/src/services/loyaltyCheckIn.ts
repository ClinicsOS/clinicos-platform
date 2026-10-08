import { Types } from "mongoose";
import { Appointment } from "../models/Appointment";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyCheckIn, type ILoyaltyCheckIn } from "../models/LoyaltyCheckIn";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { CHECKIN, type CheckInVia } from "../config/loyalty";
import { getSettings, isOid } from "./loyaltyService";

/**
 * Patient check-in (Phase 5) — the ONLY place that creates or changes a check-in request.
 *
 * Guarantees:
 *  • A check-in never touches a balance or the ledger. No points are awarded here (visit points still come from a
 *    completed appointment — Phase 3).
 *  • Every transition is a single conditional update (`status: "pending"` is in the filter), so racing actors
 *    (two receptionists, or reception vs. the patient) can never both succeed.
 *  • "At most one pending request per member" is enforced by the unique sparse `activeKey` index; a lost race simply
 *    returns the request that won.
 *  • Everything is clinic-scoped: ids from a client are only ever looked up WITHIN the clinic derived server-side.
 *  • Requests nobody answered are marked `expired` (never deleted); this happens lazily whenever they are read or
 *    a new request is made, so no background job is needed.
 */

export type CheckInErrorCode =
  | "CHECKIN_DISABLED"
  | "ACCOUNT_NOT_ACTIVE"
  | "CHECKIN_NOT_FOUND"
  | "CHECKIN_NOT_PENDING"
  | "CHECKIN_EXPIRED"
  | "CHECKIN_LIMIT"
  | "CHECKIN_QUEUE_FULL"
  | "PATIENT_ARCHIVED"
  | "INVALID_APPOINTMENT";

export class CheckInError extends Error {
  constructor(
    public code: CheckInErrorCode,
    message: string,
    public status = 400,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CheckInError";
  }
}

const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

/* ============================================================
 * Expiry (lazy)
 * ============================================================ */

/** Marks every overdue pending request of one member as expired. */
export async function expireStaleForAccount(accountId: string, now = new Date(), clinicId?: string): Promise<void> {
  await LoyaltyCheckIn.updateMany(
    { ...(clinicId ? { clinicId: oid(clinicId) } : {}), accountId: oid(accountId), status: "pending", expiresAt: { $lte: now } },
    { $set: { status: "expired", resolvedAt: now }, $unset: { activeKey: 1 } }
  );
}

/** Marks every overdue pending request of one clinic as expired. */
export async function expireStaleForClinic(clinicId: string, now = new Date()): Promise<void> {
  await LoyaltyCheckIn.updateMany(
    { clinicId: oid(clinicId), status: "pending", expiresAt: { $lte: now } },
    { $set: { status: "expired", resolvedAt: now }, $unset: { activeKey: 1 } }
  );
}

/* ============================================================
 * Patient side (public Loyalty session)
 * ============================================================ */

export type RequestState = "created" | "already_pending" | "already_confirmed";

export interface RequestResult {
  checkIn: ILoyaltyCheckIn;
  state: RequestState;
}

/**
 * The patient taps "Check in". Idempotent: an already-pending request (or a very recent confirmed one) is returned
 * instead of creating a second queue entry.
 */
export async function requestCheckIn(input: { clinicId: string; accountId: string; patientId: string; via?: CheckInVia }): Promise<RequestResult> {
  const now = new Date();
  const { settings } = await getSettings(input.clinicId);
  if (!settings.checkin?.enabled) throw new CheckInError("CHECKIN_DISABLED", "Check-in is not available at this clinic right now", 409);

  const account = await LoyaltyAccount.findOne({ _id: oid(input.accountId), clinicId: oid(input.clinicId), status: "active" }).select("_id").lean();
  if (!account) throw new CheckInError("ACCOUNT_NOT_ACTIVE", "This membership is not active", 409);

  await expireStaleForAccount(input.accountId, now, input.clinicId);

  const pending = await LoyaltyCheckIn.findOne({ clinicId: oid(input.clinicId), accountId: oid(input.accountId), status: "pending" });
  if (pending) return { checkIn: pending, state: "already_pending" };

  const confirmed = await LoyaltyCheckIn.findOne({
    clinicId: oid(input.clinicId),
    accountId: oid(input.accountId),
    status: "confirmed",
    resolvedAt: { $gte: new Date(now.getTime() - minutes(CHECKIN.confirmedDedupeMinutes)) },
  }).sort({ resolvedAt: -1 });
  if (confirmed) return { checkIn: confirmed, state: "already_confirmed" };

  const last24h = await LoyaltyCheckIn.countDocuments({ clinicId: oid(input.clinicId), accountId: oid(input.accountId), requestedAt: { $gte: new Date(now.getTime() - hours(24)) } });
  if (last24h >= CHECKIN.maxRequestsPerAccountPer24h) {
    throw new CheckInError("CHECKIN_LIMIT", "Too many check-in requests today. Please ask reception.", 429);
  }
  const queue = await LoyaltyCheckIn.countDocuments({ clinicId: oid(input.clinicId), status: "pending", expiresAt: { $gt: now } });
  if (queue >= CHECKIN.maxPendingPerClinic) {
    throw new CheckInError("CHECKIN_QUEUE_FULL", "Check-in is very busy right now. Please tell reception you have arrived.", 503);
  }

  try {
    const created = await LoyaltyCheckIn.create({
      clinicId: oid(input.clinicId),
      accountId: oid(input.accountId),
      patientId: oid(input.patientId),
      status: "pending",
      via: input.via && (CHECKIN.vias as readonly string[]).includes(input.via) ? input.via : "link",
      requestedAt: now,
      expiresAt: new Date(now.getTime() + minutes(CHECKIN.pendingTtlMinutes)),
      activeKey: input.accountId,
    });
    return { checkIn: created, state: "created" };
  } catch (e: any) {
    if (e?.code === 11000) {
      // Lost a race with another request of the same member → return the one that won.
      const winner = await LoyaltyCheckIn.findOne({ clinicId: oid(input.clinicId), accountId: oid(input.accountId), status: "pending" });
      if (winner) return { checkIn: winner, state: "already_pending" };
    }
    throw e;
  }
}

/**
 * What the patient's page should show right now: a pending request, a recent confirmation, or a recent
 * rejected / expired outcome. Cancelled requests and old outcomes are not shown (→ null, "you can check in").
 */
export async function currentCheckInForAccount(clinicId: string, accountId: string): Promise<ILoyaltyCheckIn | null> {
  const now = new Date();
  await expireStaleForAccount(accountId, now, clinicId);
  const latest = await LoyaltyCheckIn.findOne({ clinicId: oid(clinicId), accountId: oid(accountId) }).sort({ requestedAt: -1, _id: -1 });
  if (!latest) return null;
  if (latest.status === "pending") return latest;
  const resolved = latest.resolvedAt ? latest.resolvedAt.getTime() : latest.requestedAt.getTime();
  if (latest.status === "confirmed") return now.getTime() - resolved <= minutes(CHECKIN.confirmedDedupeMinutes) ? latest : null;
  if (latest.status === "rejected" || latest.status === "expired") return now.getTime() - resolved <= minutes(CHECKIN.recentOutcomeMinutes) ? latest : null;
  return null; // cancelled
}

/** The patient withdraws their own PENDING request. Nothing to cancel → null (idempotent). */
export async function cancelOwnCheckIn(clinicId: string, accountId: string): Promise<ILoyaltyCheckIn | null> {
  return LoyaltyCheckIn.findOneAndUpdate(
    { clinicId: oid(clinicId), accountId: oid(accountId), status: "pending" },
    { $set: { status: "cancelled", resolvedAt: new Date() }, $unset: { activeKey: 1 } },
    { new: true }
  );
}

/* ============================================================
 * Clinic side (reception)
 * ============================================================ */

export async function countPending(clinicId: string): Promise<number> {
  const now = new Date();
  await expireStaleForClinic(clinicId, now);
  return LoyaltyCheckIn.countDocuments({ clinicId: oid(clinicId), status: "pending", expiresAt: { $gt: now } });
}

export interface LinkableAppointment {
  id: string;
  startAt: Date;
  status: string;
  visitType: string | null;
  doctorName: string | null;
}

/** The patients' appointments close to now that reception may link to a check-in (one query for the whole page). */
async function linkableAppointments(clinicId: string, patientIds: Types.ObjectId[], around: Date): Promise<Map<string, LinkableAppointment[]>> {
  const out = new Map<string, LinkableAppointment[]>();
  if (!patientIds.length) return out;
  const win = hours(CHECKIN.appointmentWindowHours);
  const rows = await Appointment.find({
    clinicId: oid(clinicId),
    patientId: { $in: patientIds },
    type: "appointment",
    status: { $in: [...CHECKIN.linkableAppointmentStatuses] },
    startAt: { $gte: new Date(around.getTime() - win), $lte: new Date(around.getTime() + win) },
  })
    .sort({ startAt: 1 })
    .limit(300)
    .select("patientId startAt status visitType doctorId")
    .lean();
  const doctorIds = [...new Set(rows.map((r) => String(r.doctorId)))];
  const doctors = doctorIds.length ? await User.find({ _id: { $in: doctorIds }, clinicId: oid(clinicId) }).select("name").lean() : [];
  const dn = new Map(doctors.map((d) => [String(d._id), (d as { name?: string }).name ?? null]));
  for (const r of rows) {
    const k = String(r.patientId);
    const list = out.get(k) ?? [];
    list.push({ id: String(r._id), startAt: r.startAt, status: r.status, visitType: r.visitType ?? null, doctorName: dn.get(String(r.doctorId)) ?? null });
    out.set(k, list);
  }
  return out;
}

export interface CheckInRow {
  id: string;
  accountId: string;
  status: string;
  via: string;
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedBy: { id: string; name: string | null } | null;
  appointmentId: string | null;
  patient: { id: string; fullName: string; phone: string; fileNumber: number } | null;
  balance: number | null;
  appointments: LinkableAppointment[];
}

async function toRows(clinicId: string, docs: ILoyaltyCheckIn[] | Record<string, any>[], withAppointments: boolean): Promise<CheckInRow[]> {
  const list = docs as Record<string, any>[];
  const patientIds = [...new Set(list.map((d) => String(d.patientId)))];
  const accountIds = [...new Set(list.map((d) => String(d.accountId)))];
  const actorIds = [...new Set(list.filter((d) => d.resolvedBy).map((d) => String(d.resolvedBy)))];
  const [patients, accounts, actors, appts] = await Promise.all([
    patientIds.length ? Patient.find({ _id: { $in: patientIds }, clinicId: oid(clinicId) }).select("fullName phone fileNumber").lean() : Promise.resolve([]),
    accountIds.length ? LoyaltyAccount.find({ _id: { $in: accountIds }, clinicId: oid(clinicId) }).select("pointsBalance").lean() : Promise.resolve([]),
    actorIds.length ? User.find({ _id: { $in: actorIds }, clinicId: oid(clinicId) }).select("name").lean() : Promise.resolve([]),
    withAppointments ? linkableAppointments(clinicId, patientIds.map((i) => oid(i)), new Date()) : Promise.resolve(new Map<string, LinkableAppointment[]>()),
  ]);
  const pm = new Map(patients.map((p) => [String(p._id), p as Record<string, any>]));
  const am = new Map(accounts.map((a) => [String(a._id), a as Record<string, any>]));
  const um = new Map(actors.map((u) => [String(u._id), u as Record<string, any>]));
  return list.map((d) => {
    const p = pm.get(String(d.patientId));
    return {
      id: String(d._id),
      accountId: String(d.accountId),
      status: d.status,
      via: d.via,
      requestedAt: d.requestedAt,
      expiresAt: d.expiresAt,
      resolvedAt: d.resolvedAt ?? null,
      resolvedBy: d.resolvedBy ? { id: String(d.resolvedBy), name: um.get(String(d.resolvedBy))?.name ?? null } : null,
      appointmentId: d.appointmentId ? String(d.appointmentId) : null,
      patient: p ? { id: String(p._id), fullName: p.fullName, phone: p.phone, fileNumber: p.fileNumber } : null,
      balance: am.get(String(d.accountId))?.pointsBalance ?? null,
      appointments: withAppointments ? appts.get(String(d.patientId)) ?? [] : [],
    };
  });
}

/** The reception queue: live pending requests, oldest first (first come, first served). */
export async function listPending(clinicId: string): Promise<{ rows: CheckInRow[]; total: number }> {
  const now = new Date();
  await expireStaleForClinic(clinicId, now);
  const filter = { clinicId: oid(clinicId), status: "pending", expiresAt: { $gt: now } };
  const [docs, total] = await Promise.all([LoyaltyCheckIn.find(filter).sort({ requestedAt: 1, _id: 1 }).limit(CHECKIN.pendingListMax).lean(), LoyaltyCheckIn.countDocuments(filter)]);
  return { rows: await toRows(clinicId, docs, true), total };
}

/** History: everything that is no longer pending, newest first. */
export async function listRecent(clinicId: string, page: number, limit: number): Promise<{ rows: CheckInRow[]; total: number; page: number; pages: number }> {
  await expireStaleForClinic(clinicId);
  const filter = { clinicId: oid(clinicId), status: { $ne: "pending" } };
  const [docs, total] = await Promise.all([
    LoyaltyCheckIn.find(filter)
      .sort({ requestedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LoyaltyCheckIn.countDocuments(filter),
  ]);
  return { rows: await toRows(clinicId, docs, false), total, page, pages: Math.ceil(total / limit) };
}

export type ResolveAction = "confirm" | "reject";

/**
 * Reception confirms or rejects a request. `appointmentId` (confirm only, optional) links the patient's
 * appointment for reference — it never changes the appointment.
 */
export async function resolveCheckIn(input: { clinicId: string; checkInId: string; action: ResolveAction; userId: string; appointmentId?: string | null }): Promise<CheckInRow> {
  if (!isOid(input.checkInId)) throw new CheckInError("CHECKIN_NOT_FOUND", "Check-in request not found", 404);
  const clinicId = oid(input.clinicId);
  const doc = await LoyaltyCheckIn.findOne({ _id: oid(input.checkInId), clinicId }).lean();
  if (!doc) throw new CheckInError("CHECKIN_NOT_FOUND", "Check-in request not found", 404);

  const now = new Date();
  let appointmentId: Types.ObjectId | null = null;

  if (input.action === "confirm") {
    const [account, patient] = await Promise.all([
      LoyaltyAccount.findOne({ _id: doc.accountId, clinicId, status: "active" }).select("_id").lean(),
      Patient.findOne({ _id: doc.patientId, clinicId }).select("isArchived").lean(),
    ]);
    if (!account) throw new CheckInError("ACCOUNT_NOT_ACTIVE", "This Loyalty membership is not active", 409);
    if (!patient || patient.isArchived) throw new CheckInError("PATIENT_ARCHIVED", "This patient is archived", 409);

    if (input.appointmentId) {
      if (!isOid(input.appointmentId)) throw new CheckInError("INVALID_APPOINTMENT", "Choose one of the patient's appointments around this time", 400);
      const win = hours(CHECKIN.appointmentWindowHours);
      const appt = await Appointment.findOne({
        _id: oid(input.appointmentId),
        clinicId,
        patientId: doc.patientId,
        type: "appointment",
        status: { $in: [...CHECKIN.linkableAppointmentStatuses] },
        startAt: { $gte: new Date(now.getTime() - win), $lte: new Date(now.getTime() + win) }, // same window the reception list offers (around now)
      })
        .select("_id")
        .lean();
      if (!appt) throw new CheckInError("INVALID_APPOINTMENT", "Choose one of the patient's appointments around this time", 400);
      appointmentId = appt._id as Types.ObjectId;
    }
  }

  const $set: Record<string, unknown> = { status: input.action === "confirm" ? "confirmed" : "rejected", resolvedAt: now, resolvedBy: oid(input.userId) };
  if (appointmentId) $set.appointmentId = appointmentId;

  // The transition itself: atomic, and only from "pending" and only while not expired.
  const updated = await LoyaltyCheckIn.findOneAndUpdate({ _id: doc._id, clinicId, status: "pending", expiresAt: { $gt: now } }, { $set, $unset: { activeKey: 1 } }, { new: true }).lean();
  if (!updated) {
    const cur = await LoyaltyCheckIn.findOne({ _id: doc._id, clinicId }).lean();
    if (cur && cur.status === "pending") {
      await expireStaleForAccount(String(cur.accountId), now, input.clinicId);
      throw new CheckInError("CHECKIN_EXPIRED", "This request has expired — the patient can check in again", 409, { status: "expired" });
    }
    throw new CheckInError("CHECKIN_NOT_PENDING", "This request was already handled", 409, { status: cur?.status ?? null });
  }
  return (await toRows(input.clinicId, [updated], false))[0];
}
