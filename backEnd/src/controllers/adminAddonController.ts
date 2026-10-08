import { Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Clinic, type IAddonSubscription } from "../models/Clinic";
import { asyncHandler } from "../middleware/errorHandler";
import { logActivity } from "../services/activityLogger";
import { toAdminAddonView } from "../services/addons";
import { PLAN_PRICES, type Plan } from "../config/plans";
import {
  ADDONS,
  ADDON_IDS,
  canTransitionAddon,
  type AddonId,
  type AddonStatus,
} from "../config/addons";

/**
 * PLATFORM-ADMIN ONLY — paid add-on entitlement (e.g. ClinicOS Loyalty).
 *
 * Every route that reaches these handlers sits behind `requireAdmin` in adminRoutes.ts
 * (the admin JWT, signed with ADMIN_JWT_SECRET). Clinic owners / doctors / receptionists
 * hold a different token type and are rejected before they get here.
 *
 * These handlers only manage the ENTITLEMENT record (has the clinic paid, and is it allowed
 * to use the module). They never touch a module's own data or settings, and none of them
 * deletes anything: suspending or cancelling keeps the full subscription record so any future
 * module data (members, points, history…) stays intact and re-activation is lossless.
 */

type ClinicSnap = {
  _id: Types.ObjectId;
  name: string;
  plan?: string | null;
  status?: string | null;
  planExpiresAt?: Date | null;
  addons?: Partial<Record<AddonId, IAddonSubscription>> | null;
};

const SNAP_FIELDS = "name plan status planExpiresAt addons";
const DAY_MS = 86_400_000;
const round3 = (n: number) => Math.round(n * 1000) / 1000; // JOD has 3 decimals (fils)

/* ---------- validation ---------- */

const money = z
  .number({ invalid_type_error: "must be a number" })
  .finite()
  .min(0, "must be 0 or more")
  .max(100000, "is unreasonably large")
  .transform(round3);

/** ISO date or date-time string. Rejects null / numbers / garbage, and absurd years. */
const dateField = z
  .string({ invalid_type_error: "must be a date string" })
  .regex(/^\d{4}-\d{2}-\d{2}/, "must be an ISO date (YYYY-MM-DD…)")
  .transform((s, ctx) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "is not a valid date" });
      return z.NEVER;
    }
    const y = d.getUTCFullYear();
    if (y < 2020 || y > 2100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "is outside the supported range" });
      return z.NEVER;
    }
    return d;
  });

const reasonField = z.string().trim().max(300).optional();

// .strict() everywhere: an unknown key (e.g. someone sending `status` or `enabled`) is rejected
// instead of silently ignored, so state can only change through the explicit lifecycle endpoints.
const activateSchema = z
  .object({
    setupFee: money.optional(),
    monthlyPrice: money.optional(),
    activatedAt: dateField.optional(),
    currentPeriodStart: dateField.optional(),
    currentPeriodEnd: dateField.optional(),
    reason: reasonField,
  })
  .strict();

const updateSchema = z
  .object({
    setupFee: money.optional(),
    monthlyPrice: money.optional(),
    activatedAt: dateField.optional(),
    currentPeriodStart: dateField.optional(),
    currentPeriodEnd: dateField.optional(),
    reason: reasonField,
  })
  .strict()
  .refine(
    (v) =>
      v.setupFee !== undefined ||
      v.monthlyPrice !== undefined ||
      v.activatedAt !== undefined ||
      v.currentPeriodStart !== undefined ||
      v.currentPeriodEnd !== undefined,
    { message: "Provide at least one field to change" }
  );

const reactivateSchema = z
  .object({
    currentPeriodStart: dateField.optional(),
    currentPeriodEnd: dateField.optional(),
    reason: reasonField,
  })
  .strict();

const reasonOnlySchema = z.object({ reason: reasonField }).strict();

const addonIdSchema = z.enum(ADDON_IDS);

/* ---------- small helpers ---------- */

type Parsed<T> = { ok: true; data: T } | { ok: false; res: Response };

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown, res: Response): Parsed<z.output<S>> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  return {
    ok: false,
    res: res.status(400).json({
      message: `Invalid input — ${where}${first?.message ?? "check the values"}`,
      code: "INVALID_INPUT",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    }),
  };
}

type Ctx = { clinic: ClinicSnap; addonId: AddonId; existing: IAddonSubscription | null; from: AddonStatus };

/** Validates :id / :addonId, loads the clinic. Sends the error response itself and returns null on failure. */
async function loadContext(req: Request, res: Response): Promise<Ctx | null> {
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "Invalid clinic id" });
    return null;
  }
  const idParsed = addonIdSchema.safeParse(req.params.addonId);
  if (!idParsed.success) {
    res.status(400).json({ message: "Unknown add-on", code: "INVALID_ADDON" });
    return null;
  }
  const clinic = (await Clinic.findById(id).select(SNAP_FIELDS).lean()) as ClinicSnap | null;
  if (!clinic) {
    res.status(404).json({ message: "Clinic not found" });
    return null;
  }
  const existing = clinic.addons?.[idParsed.data] ?? null;
  return { clinic, addonId: idParsed.data, existing, from: existing?.status ?? "inactive" };
}

const bad = (res: Response, message: string, code = "INVALID_INPUT") =>
  res.status(400).json({ message, code });

function invalidTransition(res: Response, name: string, from: AddonStatus, hint: string) {
  return res.status(409).json({
    message: `${name} is ${from === "inactive" ? "not subscribed" : from} — ${hint}`,
    code: "INVALID_TRANSITION",
    status: from,
  });
}

/** Plain, fully-populated copy of a record (never mutates the lean document we read). */
function copyRecord(r: IAddonSubscription): IAddonSubscription {
  return {
    enabled: r.enabled,
    status: r.status,
    setupFee: r.setupFee,
    monthlyPrice: r.monthlyPrice,
    activatedAt: r.activatedAt ?? null,
    currentPeriodStart: r.currentPeriodStart ?? null,
    currentPeriodEnd: r.currentPeriodEnd ?? null,
    suspendedAt: r.suspendedAt ?? null,
    cancelledAt: r.cancelledAt ?? null,
  };
}

/** Matches only if the add-on is still in the status we based our decision on (stale / double-click guard). */
function statusGuard(id: AddonId, from: AddonStatus): Record<string, unknown> {
  const path = `addons.${id}`;
  return from === "inactive"
    ? { $or: [{ [path]: { $exists: false } }, { [path]: null }, { [`${path}.status`]: "inactive" }] }
    : { [`${path}.status`]: from };
}

async function commitWholeRecord(clinicId: Types.ObjectId, id: AddonId, from: AddonStatus, next: IAddonSubscription) {
  return (await Clinic.findOneAndUpdate(
    { _id: clinicId, ...statusGuard(id, from) },
    { $set: { [`addons.${id}`]: next } },
    { new: true, runValidators: true }
  ).lean()) as ClinicSnap | null;
}

async function commitFields(
  clinicId: Types.ObjectId,
  id: AddonId,
  from: AddonStatus,
  fields: Partial<IAddonSubscription>
) {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) set[`addons.${id}.${k}`] = v;
  return (await Clinic.findOneAndUpdate(
    { _id: clinicId, ...statusGuard(id, from) },
    { $set: set },
    { new: true, runValidators: true }
  ).lean()) as ClinicSnap | null;
}

const conflict = (res: Response) =>
  res.status(409).json({
    message: "This add-on was changed by someone else — refresh and try again",
    code: "ADDON_CONFLICT",
  });

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

async function audit(
  req: Request,
  clinic: ClinicSnap,
  id: AddonId,
  event: "activated" | "updated" | "suspended" | "reactivated" | "cancelled",
  details: Record<string, unknown>
) {
  await logActivity({
    action: `clinic.addon.${id}_${event}`,
    actorEmail: req.admin?.email || "unknown",
    targetType: "clinic",
    targetId: clinic._id,
    targetLabel: clinic.name,
    details: { addon: id, clinicId: String(clinic._id), ...details },
  });
}

const respond = (res: Response, clinic: ClinicSnap, id: AddonId, message: string) =>
  res.json({ addon: toAdminAddonView(clinic, id), message });

/* ============================================================
 * GET /api/admin/clinics/:id/addons
 * ============================================================ */
export const listClinicAddons = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid clinic id" });
  const clinic = (await Clinic.findById(id).select(SNAP_FIELDS).lean()) as ClinicSnap | null;
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  const addons = {} as Record<AddonId, ReturnType<typeof toAdminAddonView>>;
  for (const a of ADDON_IDS) addons[a] = toAdminAddonView(clinic, a);
  // Product defaults come from config/addons.ts and plan prices from config/plans.ts,
  // so the UI never hard-codes a price (it shows e.g. "Pro 40 + Loyalty 10 = 50 JOD").
  const plan = (clinic.plan ?? "trial") as Plan;
  return res.json({
    addons,
    defaults: ADDONS,
    clinicPlan: { plan, monthlyPrice: PLAN_PRICES[plan] ?? 0 },
  });
});

/* ============================================================
 * POST /api/admin/clinics/:id/addons/:addonId/activate
 * inactive | cancelled  →  active
 * ============================================================ */
export const activateAddon = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  const { clinic, addonId, existing, from } = ctx;
  const def = ADDONS[addonId];

  if (from === "active") return invalidTransition(res, def.name, from, "it is already active");
  if (from === "suspended") return invalidTransition(res, def.name, from, "use Reactivate (or Cancel)");

  const p = parseBody(activateSchema, req.body, res);
  if (!p.ok) return;
  const input = p.data;

  const setupFee = input.setupFee ?? existing?.setupFee;
  if (setupFee === undefined) return bad(res, "setupFee is required to activate (it is agreed per clinic)");
  const monthlyPrice = input.monthlyPrice ?? existing?.monthlyPrice ?? def.defaultMonthlyPrice;

  const now = new Date();
  const activatedAt = input.activatedAt ?? now;
  const start = input.currentPeriodStart ?? activatedAt;
  const end = input.currentPeriodEnd ?? new Date(start.getTime() + def.defaultPeriodDays * DAY_MS);
  if (end.getTime() <= start.getTime()) return bad(res, "currentPeriodEnd must be after currentPeriodStart");
  if (end.getTime() <= now.getTime()) return bad(res, "currentPeriodEnd must be in the future");

  const next: IAddonSubscription = {
    enabled: true,
    status: "active",
    setupFee,
    monthlyPrice,
    activatedAt,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    suspendedAt: null,
    cancelledAt: null,
  };

  const updated = await commitWholeRecord(clinic._id, addonId, from, next);
  if (!updated) return conflict(res);

  await audit(req, clinic, addonId, "activated", {
    previousStatus: from,
    newStatus: "active",
    previousMonthlyPrice: existing?.monthlyPrice ?? null,
    newMonthlyPrice: monthlyPrice,
    previousSetupFee: existing?.setupFee ?? null,
    newSetupFee: setupFee,
    newActivatedAt: iso(activatedAt),
    newPeriodStart: iso(start),
    newPeriodEnd: iso(end),
    reason: input.reason,
  });
  return respond(res, updated, addonId, `${def.name} activated`);
});

/* ============================================================
 * PATCH /api/admin/clinics/:id/addons/:addonId
 * Edit pricing / dates of an active or suspended subscription (status is NOT changed here).
 * ============================================================ */
export const updateAddon = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  const { clinic, addonId, existing, from } = ctx;
  const def = ADDONS[addonId];

  if (!existing || (from !== "active" && from !== "suspended")) {
    return invalidTransition(res, def.name, from, "only an active or suspended subscription can be edited");
  }

  const p = parseBody(updateSchema, req.body, res);
  if (!p.ok) return;
  const input = p.data;

  const now = new Date();
  const start = input.currentPeriodStart ?? existing.currentPeriodStart ?? null;
  const end = input.currentPeriodEnd ?? existing.currentPeriodEnd ?? null;
  if (start && end && end.getTime() <= new Date(start).getTime()) {
    return bad(res, "currentPeriodEnd must be after currentPeriodStart");
  }
  if (from === "active" && input.currentPeriodEnd && input.currentPeriodEnd.getTime() <= now.getTime()) {
    return bad(res, "An active subscription's period end must be in the future — suspend or cancel it instead");
  }

  const fields: Partial<IAddonSubscription> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const track = <K extends keyof IAddonSubscription>(key: K, value: IAddonSubscription[K] | undefined) => {
    if (value === undefined) return;
    const before = existing[key];
    const same =
      before instanceof Date || value instanceof Date
        ? iso(before as Date | null) === iso(value as Date | null)
        : before === value;
    if (same) return;
    fields[key] = value;
    changes[key] = {
      from: before instanceof Date ? iso(before) : before ?? null,
      to: value instanceof Date ? iso(value) : value,
    };
  };
  track("setupFee", input.setupFee);
  track("monthlyPrice", input.monthlyPrice);
  track("activatedAt", input.activatedAt);
  track("currentPeriodStart", input.currentPeriodStart);
  track("currentPeriodEnd", input.currentPeriodEnd);

  if (Object.keys(fields).length === 0) {
    return respond(res, clinic, addonId, "No changes — values are already up to date");
  }

  const updated = await commitFields(clinic._id, addonId, from, fields);
  if (!updated) return conflict(res);

  await audit(req, clinic, addonId, "updated", {
    previousStatus: from,
    newStatus: from,
    previousMonthlyPrice: existing.monthlyPrice,
    newMonthlyPrice: fields.monthlyPrice ?? existing.monthlyPrice,
    previousSetupFee: existing.setupFee,
    newSetupFee: fields.setupFee ?? existing.setupFee,
    previousPeriodStart: iso(existing.currentPeriodStart),
    previousPeriodEnd: iso(existing.currentPeriodEnd),
    newPeriodStart: iso(fields.currentPeriodStart ?? existing.currentPeriodStart),
    newPeriodEnd: iso(fields.currentPeriodEnd ?? existing.currentPeriodEnd),
    changes,
    reason: input.reason,
  });
  return respond(res, updated, addonId, `${def.name} subscription updated`);
});

/* ============================================================
 * POST /api/admin/clinics/:id/addons/:addonId/suspend       active → suspended
 * ============================================================ */
export const suspendAddon = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  const { clinic, addonId, existing, from } = ctx;
  const def = ADDONS[addonId];

  if (!existing || !canTransitionAddon(from, "suspended")) {
    return invalidTransition(res, def.name, from, "only an active subscription can be suspended");
  }
  const p = parseBody(reasonOnlySchema, req.body, res);
  if (!p.ok) return;

  const next = copyRecord(existing);
  next.enabled = false;
  next.status = "suspended";
  next.suspendedAt = new Date();

  const updated = await commitWholeRecord(clinic._id, addonId, from, next);
  if (!updated) return conflict(res);

  await audit(req, clinic, addonId, "suspended", {
    previousStatus: from,
    newStatus: "suspended",
    previousMonthlyPrice: existing.monthlyPrice,
    newMonthlyPrice: existing.monthlyPrice,
    reason: p.data.reason,
  });
  return respond(res, updated, addonId, `${def.name} suspended — its record is kept`);
});

/* ============================================================
 * POST /api/admin/clinics/:id/addons/:addonId/reactivate    suspended → active
 * Keeps price / setup fee / activation date. Dates may be refreshed (required if the period ended).
 * ============================================================ */
export const reactivateAddon = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  const { clinic, addonId, existing, from } = ctx;
  const def = ADDONS[addonId];

  if (!existing || from !== "suspended") {
    return invalidTransition(
      res,
      def.name,
      from,
      from === "cancelled" ? "use Activate to re-subscribe" : "only a suspended subscription can be reactivated"
    );
  }
  const p = parseBody(reactivateSchema, req.body, res);
  if (!p.ok) return;

  const now = new Date();
  const start = p.data.currentPeriodStart ?? existing.currentPeriodStart ?? now;
  const end = p.data.currentPeriodEnd ?? existing.currentPeriodEnd ?? null;
  if (!end || new Date(end).getTime() <= now.getTime()) {
    return res.status(400).json({
      message: "The billing period has ended — set a new period end date to reactivate",
      code: "PERIOD_ENDED",
    });
  }
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    return bad(res, "currentPeriodEnd must be after currentPeriodStart");
  }

  const next = copyRecord(existing);
  next.enabled = true;
  next.status = "active";
  next.suspendedAt = null;
  next.currentPeriodStart = start;
  next.currentPeriodEnd = end;

  const updated = await commitWholeRecord(clinic._id, addonId, from, next);
  if (!updated) return conflict(res);

  await audit(req, clinic, addonId, "reactivated", {
    previousStatus: from,
    newStatus: "active",
    previousMonthlyPrice: existing.monthlyPrice,
    newMonthlyPrice: existing.monthlyPrice,
    previousPeriodStart: iso(existing.currentPeriodStart),
    previousPeriodEnd: iso(existing.currentPeriodEnd),
    newPeriodStart: iso(start),
    newPeriodEnd: iso(end),
    reason: p.data.reason,
  });
  return respond(res, updated, addonId, `${def.name} reactivated`);
});

/* ============================================================
 * POST /api/admin/clinics/:id/addons/:addonId/cancel        active | suspended → cancelled
 * The record is kept (never deleted) so any future module data survives and re-subscribing is lossless.
 * ============================================================ */
export const cancelAddon = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  const { clinic, addonId, existing, from } = ctx;
  const def = ADDONS[addonId];

  if (!existing || !canTransitionAddon(from, "cancelled")) {
    return invalidTransition(res, def.name, from, "only an active or suspended subscription can be cancelled");
  }
  const p = parseBody(reasonOnlySchema, req.body, res);
  if (!p.ok) return;

  const next = copyRecord(existing);
  next.enabled = false;
  next.status = "cancelled";
  next.cancelledAt = new Date();

  const updated = await commitWholeRecord(clinic._id, addonId, from, next);
  if (!updated) return conflict(res);

  await audit(req, clinic, addonId, "cancelled", {
    previousStatus: from,
    newStatus: "cancelled",
    previousMonthlyPrice: existing.monthlyPrice,
    newMonthlyPrice: existing.monthlyPrice,
    reason: p.data.reason,
  });
  return respond(res, updated, addonId, `${def.name} cancelled — its record is kept`);
});
