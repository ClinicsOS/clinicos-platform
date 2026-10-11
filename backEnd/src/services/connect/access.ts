import { User } from "../../models/User";
import { Clinic } from "../../models/Clinic";
import { accessOf } from "../../auth/policy";
import { PLANS, type Plan } from "../../config/plans";

/**
 * CLINICOS CONNECT (C3) — "may this identity use Connect RIGHT NOW?" for the realtime connection.
 *
 * This is the SAME decision the HTTP gate makes (routes/connectRoutes.ts), written once as a pure function over the user + clinic
 * records, in the same order and with the same denial codes:
 *   protect               → user exists, is ACTIVE, token not revoked (tokenVersion)        → UNAUTHORIZED
 *   requireAccess         → role matrix, resource "internalChat"                              → FORBIDDEN_ROLE
 *   requireActivePlan     → clinic exists; suspended → SUSPENDED; expired → (a lapsed PAID plan drops to trial, which has no chat) PLAN_LIMIT /
 *                           (an expired TRIAL) EXPIRED
 *   requirePlanFeature    → PLANS[plan].internalChat (Pro only)                               → PLAN_LIMIT
 * It has no side effects (the HTTP gate's "drop an expired paid plan to a trial" write is left to the HTTP path), and the test-suite
 * proves the two agree for every plan state. The realtime layer calls it at the handshake, periodically for every open socket,
 * before it delivers to a recipient and before it honours a client event — so it never becomes a second authorisation system.
 */
export type ConnectDenial = "UNAUTHORIZED" | "FORBIDDEN_ROLE" | "SUSPENDED" | "EXPIRED" | "PLAN_LIMIT";

export interface ConnectIdentity {
  userId: string;
  clinicId: string;
  role: "owner" | "doctor" | "receptionist";
  name: string;
}

export type ConnectAccess = { ok: true; identity: ConnectIdentity } | { ok: false; code: ConnectDenial };

interface UserLike {
  _id: unknown;
  clinicId: unknown;
  name: string;
  role: "owner" | "doctor" | "receptionist";
  isActive?: boolean;
  tokenVersion?: number;
}
interface ClinicLike {
  plan: string;
  status: string;
  planExpiresAt?: Date | null;
}

export function evaluateConnectAccess(user: UserLike | null | undefined, clinic: ClinicLike | null | undefined, tokenVersion: number, now: Date = new Date()): ConnectAccess {
  if (!user || !user.isActive) return { ok: false, code: "UNAUTHORIZED" };
  if ((tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) return { ok: false, code: "UNAUTHORIZED" };
  if (accessOf(user.role, "internalChat") === "none") return { ok: false, code: "FORBIDDEN_ROLE" };
  if (!clinic) return { ok: false, code: "UNAUTHORIZED" };
  if (clinic.status === "suspended") return { ok: false, code: "SUSPENDED" };
  const expired = !!clinic.planExpiresAt && new Date(clinic.planExpiresAt) < now;
  if (expired) return { ok: false, code: clinic.plan === "trial" ? "EXPIRED" : "PLAN_LIMIT" };
  const plan = PLANS[clinic.plan as Plan];
  if (!plan || !plan.internalChat) return { ok: false, code: "PLAN_LIMIT" };
  return { ok: true, identity: { userId: String(user._id), clinicId: String(user.clinicId), role: user.role, name: user.name } };
}

/** Loads the user + clinic fresh from the database and decides. */
export async function loadConnectAccess(userId: string, tokenVersion: number): Promise<ConnectAccess> {
  const user = await User.findById(userId).select("clinicId name role isActive tokenVersion").lean();
  if (!user) return { ok: false, code: "UNAUTHORIZED" };
  const clinic = await Clinic.findById(user.clinicId).select("plan status planExpiresAt").lean();
  return evaluateConnectAccess(user as unknown as UserLike, clinic as unknown as ClinicLike | null, tokenVersion);
}

/** Batch variant for the periodic re-check: two queries however many sockets are open. Key = userId. */
export async function loadConnectAccessMany(entries: { userId: string; tokenVersion: number }[]): Promise<Map<string, ConnectAccess>> {
  const out = new Map<string, ConnectAccess>();
  if (!entries.length) return out;
  const users = await User.find({ _id: { $in: entries.map((e) => e.userId) } }).select("clinicId name role isActive tokenVersion").lean();
  const clinics = await Clinic.find({ _id: { $in: Array.from(new Set(users.map((u) => String(u.clinicId)))) } }).select("plan status planExpiresAt").lean();
  const userBy = new Map(users.map((u) => [String(u._id), u]));
  const clinicBy = new Map(clinics.map((c) => [String(c._id), c]));
  for (const e of entries) {
    const u = userBy.get(e.userId);
    out.set(e.userId + ":" + e.tokenVersion, evaluateConnectAccess(u as unknown as UserLike, u ? (clinicBy.get(String(u.clinicId)) as unknown as ClinicLike) : null, e.tokenVersion));
  }
  return out;
}
