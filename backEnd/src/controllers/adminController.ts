import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { Patient } from "../models/Patient";
import { Appointment } from "../models/Appointment";
import { Invoice } from "../models/Invoice";
import { SubscriptionRequest } from "../models/SubscriptionRequest";
import { ActivityLog } from "../models/ActivityLog";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, PLAN_PRICES, type Plan } from "../config/plans";
import { logActivity } from "../services/activityLogger";

/* ============================================================
 * DASHBOARD — high-level stats and charts
 * ============================================================ */

/**
 * GET /api/admin/stats
 * Returns the KPI numbers displayed on the admin dashboard.  Everything is
 * computed on demand — cheap enough at the scale we care about and always
 * fresh (no stale cache to explain to the user).
 */
export const getDashboardStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [
      totalClinics,
      activeClinics,
      trialClinics,
      basicClinics,
      proClinics,
      suspendedClinics,
      expiringIn3Days,
      expiringIn7Days,
      expired,
      pendingUpgradeRequests,
      totalUsers,
      totalPatients,
      todayAppointments,
      monthPaidBasic,
      monthPaidPro,
      yearPaidBasic,
      yearPaidPro,
    ] = await Promise.all([
      Clinic.countDocuments({}),
      Clinic.countDocuments({ status: "active" }),
      Clinic.countDocuments({ plan: "trial", status: "active" }),
      Clinic.countDocuments({ plan: "basic", status: "active" }),
      Clinic.countDocuments({ plan: "pro", status: "active" }),
      Clinic.countDocuments({ status: "suspended" }),
      Clinic.countDocuments({
        status: "active",
        planExpiresAt: { $gte: now, $lte: in3Days },
      }),
      Clinic.countDocuments({
        status: "active",
        planExpiresAt: { $gt: in3Days, $lte: in7Days },
      }),
      Clinic.countDocuments({
        planExpiresAt: { $lt: now },
      }),
      SubscriptionRequest.countDocuments({ status: "pending" }),
      User.countDocuments({}),
      Patient.countDocuments({}),
      Appointment.countDocuments({
        dateTime: {
          $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
        },
        status: { $ne: "cancelled" },
      }),
      SubscriptionRequest.countDocuments({
        status: "approved",
        requestedPlan: "basic",
        processedAt: { $gte: startOfMonth },
      }),
      SubscriptionRequest.countDocuments({
        status: "approved",
        requestedPlan: "pro",
        processedAt: { $gte: startOfMonth },
      }),
      SubscriptionRequest.countDocuments({
        status: "approved",
        requestedPlan: "basic",
        processedAt: { $gte: startOfYear },
      }),
      SubscriptionRequest.countDocuments({
        status: "approved",
        requestedPlan: "pro",
        processedAt: { $gte: startOfYear },
      }),
    ]);

    const monthRevenue =
      monthPaidBasic * PLAN_PRICES.basic + monthPaidPro * PLAN_PRICES.pro;
    const yearRevenue =
      yearPaidBasic * PLAN_PRICES.basic + yearPaidPro * PLAN_PRICES.pro;

    return res.json({
      totalClinics,
      activeClinics,
      trialClinics,
      basicClinics,
      proClinics,
      suspendedClinics,
      expiringIn3Days,
      expiringIn7Days,
      expired,
      pendingUpgradeRequests,
      totalUsers,
      totalPatients,
      todayAppointments,
      monthRevenue,
      yearRevenue,
    });
  },
);

/**
 * GET /api/admin/stats/growth
 * Monthly clinic sign-up counts for the last 12 months, used to draw a line
 * chart on the dashboard.
 */
export const getGrowthStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const rows = await Clinic.aggregate([
      { $match: { createdAt: { $gte: twelveMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Fill missing months with zero so the chart always has 12 points
    const series: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const found = rows.find(
        (r) => r._id.year === year && r._id.month === month,
      );
      series.push({
        month: `${year}-${String(month).padStart(2, "0")}`,
        count: found ? found.count : 0,
      });
    }
    return res.json(series);
  },
);

/**
 * GET /api/admin/stats/plans
 * Snapshot of how many clinics are on each plan right now — for the pie chart.
 */
export const getPlansDistribution = asyncHandler(
  async (_req: Request, res: Response) => {
    const rows = await Clinic.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: "$plan", count: { $sum: 1 } } },
    ]);
    const dist = { trial: 0, basic: 0, pro: 0 };
    rows.forEach((r) => {
      if (r._id in dist) (dist as Record<string, number>)[r._id] = r.count;
    });
    return res.json(dist);
  },
);

/**
 * GET /api/admin/stats/revenue
 * Last-12-months revenue estimate from approved subscription requests.
 */
export const getRevenueStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const rows = await SubscriptionRequest.aggregate([
      {
        $match: {
          status: "approved",
          processedAt: { $gte: twelveMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$processedAt" },
            month: { $month: "$processedAt" },
            plan: "$requestedPlan",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const series: { month: string; revenue: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const monthRows = rows.filter(
        (r) => r._id.year === year && r._id.month === month,
      );
      const revenue = monthRows.reduce((sum, r) => {
        const p = r._id.plan as Plan;
        return sum + (PLAN_PRICES[p] ?? 0) * r.count;
      }, 0);
      series.push({
        month: `${year}-${String(month).padStart(2, "0")}`,
        revenue,
      });
    }
    return res.json(series);
  },
);

/* ============================================================
 * CLINICS — CRUD & subscription management
 * ============================================================ */

/**
 * GET /api/admin/clinics
 * Paginated list of clinics with search + filter.  Returns just enough per row
 * for the list view; details come from GET /api/admin/clinics/:id.
 */
export const listClinics = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 20));
  const search = ((req.query.search as string) || "").trim();
  const plan = req.query.plan as string | undefined;
  const status = req.query.status as string | undefined;
  const expiring = req.query.expiring as string | undefined; // "3", "7", or undefined
  const sort = (req.query.sort as string) || "-createdAt";

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { slug: { $regex: search, $options: "i" } },
      { specialty: { $regex: search, $options: "i" } },
    ];
  }
  if (plan && ["trial", "basic", "pro"].includes(plan)) {
    filter.plan = plan;
  }
  if (status && ["active", "suspended", "expired"].includes(status)) {
    filter.status = status;
  }
  if (expiring === "3" || expiring === "7") {
    const now = new Date();
    const end = new Date(
      now.getTime() + Number(expiring) * 24 * 60 * 60 * 1000,
    );
    filter.planExpiresAt = { $gte: now, $lte: end };
    filter.status = "active";
  }

  const [total, clinics] = await Promise.all([
    Clinic.countDocuments(filter),
    Clinic.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  // Enrich each clinic with counts (users, patients) — one grouped query each
  const clinicIds = clinics.map((c) => c._id);
  const [userCounts, patientCounts] = await Promise.all([
    User.aggregate([
      { $match: { clinicId: { $in: clinicIds } } },
      { $group: { _id: "$clinicId", count: { $sum: 1 } } },
    ]),
    Patient.aggregate([
      { $match: { clinicId: { $in: clinicIds } } },
      { $group: { _id: "$clinicId", count: { $sum: 1 } } },
    ]),
  ]);
  const userMap = new Map(userCounts.map((u) => [u._id.toString(), u.count]));
  const patientMap = new Map(
    patientCounts.map((p) => [p._id.toString(), p.count]),
  );

  const enriched = clinics.map((c) => {
    const now = new Date();
    const expiresAt = new Date(c.planExpiresAt);
    const daysUntilExpiry = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    return {
      ...c,
      userCount: userMap.get(c._id.toString()) || 0,
      patientCount: patientMap.get(c._id.toString()) || 0,
      daysUntilExpiry,
      isExpired: daysUntilExpiry < 0,
    };
  });

  return res.json({
    clinics: enriched,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

/**
 * GET /api/admin/clinics/:id
 * Everything we know about a single clinic, including its people, upgrade
 * history and recent invoicing.
 */
export const getClinicDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }

    const clinic = await Clinic.findById(id).lean();
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const [
      users,
      patientCount,
      appointmentCount,
      invoices,
      subscriptionHistory,
    ] = await Promise.all([
      User.find({ clinicId: id })
        .select("-password -verifyTokenHash -resetTokenHash")
        .lean(),
      Patient.countDocuments({ clinicId: id }),
      Appointment.countDocuments({ clinicId: id }),
      Invoice.find({ clinicId: id }).sort("-createdAt").limit(10).lean(),
      SubscriptionRequest.find({ clinicId: id })
        .sort("-createdAt")
        .limit(20)
        .lean(),
    ]);

    const invoiceTotal = invoices.reduce(
      (sum, inv) => sum + (inv.total || 0),
      0,
    );

    const now = new Date();
    const expiresAt = new Date(clinic.planExpiresAt);
    const daysUntilExpiry = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );

    return res.json({
      clinic: {
        ...clinic,
        daysUntilExpiry,
        isExpired: daysUntilExpiry < 0,
      },
      users,
      stats: {
        userCount: users.length,
        patientCount,
        appointmentCount,
        recentInvoicesTotal: invoiceTotal,
      },
      recentInvoices: invoices,
      subscriptionHistory,
    });
  },
);

/**
 * PATCH /api/admin/clinics/:id/plan
 * Change the clinic's plan.  Optionally resets the expiry — typically you'd
 * change plan AND extend at once, but keeping them separate lets you correct
 * a plan mistake without also moving the expiry date.
 */
const planChangeSchema = z.object({
  plan: z.enum(["trial", "basic", "pro"]),
  extendDays: z.number().int().min(0).max(3650).optional(),
  reason: z.string().optional(),
});

export const changeClinicPlan = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const parsed = planChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid input", errors: parsed.error.flatten() });
    }

    const clinic = await Clinic.findById(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const oldPlan = clinic.plan;
    const oldExpires = clinic.planExpiresAt;

    clinic.plan = parsed.data.plan;
    clinic.planStartedAt = new Date();

    if (parsed.data.extendDays && parsed.data.extendDays > 0) {
      // If already expired, extend from now; otherwise extend from current expiry
      const base =
        clinic.planExpiresAt > new Date() ? clinic.planExpiresAt : new Date();
      clinic.planExpiresAt = new Date(
        base.getTime() + parsed.data.extendDays * 24 * 60 * 60 * 1000,
      );
    }

    // Reactivate if the change makes them current again
    if (clinic.planExpiresAt > new Date() && clinic.status === "expired") {
      clinic.status = "active";
    }

    await clinic.save();

    await logActivity({
      action: "clinic.plan_changed",
      actorEmail: req.admin?.email || "unknown",
      targetType: "clinic",
      targetId: clinic._id as Types.ObjectId,
      targetLabel: clinic.name,
      details: {
        oldPlan,
        newPlan: parsed.data.plan,
        oldExpires,
        newExpires: clinic.planExpiresAt,
        extendDays: parsed.data.extendDays || 0,
        reason: parsed.data.reason,
      },
    });

    return res.json({
      clinic: clinic.toObject(),
      message: "Plan updated successfully",
    });
  },
);

/**
 * PATCH /api/admin/clinics/:id/extend
 * Extend the clinic's plan expiry by N days without changing the plan.  Useful
 * for grace periods, renewals from a customer who already had the same tier,
 * or comping a customer for a service disruption.
 */
const extendSchema = z.object({
  days: z.number().int().min(1).max(3650),
  reason: z.string().optional(),
});

export const extendClinicPlan = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const parsed = extendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input" });
    }

    const clinic = await Clinic.findById(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const oldExpires = clinic.planExpiresAt;
    const base =
      clinic.planExpiresAt > new Date() ? clinic.planExpiresAt : new Date();
    clinic.planExpiresAt = new Date(
      base.getTime() + parsed.data.days * 24 * 60 * 60 * 1000,
    );

    if (clinic.status === "expired") {
      clinic.status = "active";
    }

    await clinic.save();

    await logActivity({
      action: "clinic.plan_extended",
      actorEmail: req.admin?.email || "unknown",
      targetType: "clinic",
      targetId: clinic._id as Types.ObjectId,
      targetLabel: clinic.name,
      details: {
        oldExpires,
        newExpires: clinic.planExpiresAt,
        days: parsed.data.days,
        reason: parsed.data.reason,
      },
    });

    return res.json({
      clinic: clinic.toObject(),
      message: `Extended by ${parsed.data.days} day(s)`,
    });
  },
);

/**
 * PATCH /api/admin/clinics/:id/status
 * Suspend or reactivate a clinic.  A suspended clinic can't log in but its
 * data stays put, so reactivation is instant.
 */
const statusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().optional(),
});

export const changeClinicStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input" });
    }

    const clinic = await Clinic.findById(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const oldStatus = clinic.status;
    clinic.status = parsed.data.status;
    await clinic.save();

    await logActivity({
      action:
        parsed.data.status === "suspended"
          ? "clinic.suspended"
          : "clinic.reactivated",
      actorEmail: req.admin?.email || "unknown",
      targetType: "clinic",
      targetId: clinic._id as Types.ObjectId,
      targetLabel: clinic.name,
      details: {
        oldStatus,
        newStatus: clinic.status,
        reason: parsed.data.reason,
      },
    });

    return res.json({
      clinic: clinic.toObject(),
      message:
        parsed.data.status === "suspended"
          ? "Clinic suspended"
          : "Clinic reactivated",
    });
  },
);

/**
 * DELETE /api/admin/clinics/:id
 * Permanently delete a clinic and all its data.  Requires the exact clinic
 * name as `confirmText` to prevent fat-finger disasters.
 */
export const deleteClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const { confirmText, reason } = req.body as {
      confirmText?: string;
      reason?: string;
    };

    const clinic = await Clinic.findById(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    if (confirmText !== clinic.name) {
      return res.status(400).json({
        message: `To confirm, please type the clinic name exactly: "${clinic.name}"`,
        code: "CONFIRM_REQUIRED",
      });
    }

    await Promise.all([
      Appointment.deleteMany({ clinicId: id }),
      Invoice.deleteMany({ clinicId: id }),
      Patient.deleteMany({ clinicId: id }),
      User.deleteMany({ clinicId: id }),
      SubscriptionRequest.deleteMany({ clinicId: id }),
      Clinic.deleteOne({ _id: id }),
    ]);

    await logActivity({
      action: "clinic.deleted",
      actorEmail: req.admin?.email || "unknown",
      targetType: "clinic",
      targetId: clinic._id as Types.ObjectId,
      targetLabel: clinic.name,
      details: { reason },
    });

    return res.json({
      message: "Clinic and all associated data deleted permanently.",
      deleted: true,
    });
  },
);

/**
 * GET /api/admin/clinics/:id/export
 * Full JSON dump of the clinic's data — mirrors what the clinic owner can
 * export themselves, for audit or migration purposes.
 */
export const exportClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }

    const [
      clinic,
      users,
      patients,
      appointments,
      invoices,
      subscriptionRequests,
    ] = await Promise.all([
      Clinic.findById(id).lean(),
      User.find({ clinicId: id })
        .select("-password -verifyTokenHash -resetTokenHash")
        .lean(),
      Patient.find({ clinicId: id }).lean(),
      Appointment.find({ clinicId: id }).lean(),
      Invoice.find({ clinicId: id }).lean(),
      SubscriptionRequest.find({ clinicId: id }).lean(),
    ]);

    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    await logActivity({
      action: "clinic.exported",
      actorEmail: req.admin?.email || "unknown",
      targetType: "clinic",
      targetId: clinic._id as Types.ObjectId,
      targetLabel: clinic.name,
    });

    return res.json({
      exportedAt: new Date().toISOString(),
      exportedBy: req.admin?.email,
      format: "ClinicOS admin export v1",
      clinic,
      users,
      patients,
      appointments,
      invoices,
      subscriptionRequests,
    });
  },
);

/**
 * POST /api/admin/clinics/:id/impersonate
 * Issue a normal clinic-user JWT for the clinic's owner so the admin can
 * troubleshoot as that user.  We only impersonate owners — never regular
 * staff members — because impersonating a limited role would hide bugs.
 */
export const impersonateClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }

    const clinic = await Clinic.findById(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const owner = await User.findOne({
      clinicId: id,
      role: "owner",
      isActive: true,
    });
    if (!owner) {
      return res.status(404).json({
        message: "This clinic has no active owner account to impersonate",
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ message: "Server misconfigured" });
    }

    // Short-lived token so an accidental leak has minimal blast radius
    const token = jwt.sign({ userId: String(owner._id) }, secret, {
      expiresIn: "1h",
    });

    await logActivity({
      action: "clinic.impersonated",
      actorEmail: req.admin?.email || "unknown",
      targetType: "clinic",
      targetId: clinic._id as Types.ObjectId,
      targetLabel: clinic.name,
      details: { ownerEmail: owner.email },
    });

    return res.json({
      token,
      user: {
        id: String(owner._id),
        name: owner.name,
        email: owner.email,
        role: owner.role,
        emailVerified: owner.emailVerified,
      },
      clinic: {
        id: String(clinic._id),
        name: clinic.name,
        slug: clinic.slug,
      },
      impersonated: true,
      expiresIn: 3600,
    });
  },
);

/* ============================================================
 * UPGRADE REQUESTS
 * ============================================================ */

/**
 * GET /api/admin/upgrade-requests
 * List of subscription upgrade requests, most recent first, with clinic name
 * hydrated in so the UI doesn't need a second round-trip per row.
 */
export const listUpgradeRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const filter: Record<string, unknown> = {};
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }

    const requests = await SubscriptionRequest.find(filter)
      .sort("-createdAt")
      .limit(200)
      .populate("clinicId", "name slug plan planExpiresAt")
      .lean();

    return res.json({ requests });
  },
);

/**
 * POST /api/admin/upgrade-requests/:id/approve
 * Approve a pending request: mark it approved and update the clinic's plan
 * and expiry in one atomic-feeling step (single DB session).
 */
const approveSchema = z.object({
  extendDays: z.number().int().min(1).max(3650).default(30),
  notes: z.string().optional(),
});

export const approveUpgradeRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input" });
    }

    const request = await SubscriptionRequest.findById(id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({
        message: `This request is already ${request.status}`,
      });
    }

    const clinic = await Clinic.findById(request.clinicId);
    if (!clinic)
      return res.status(404).json({ message: "Associated clinic not found" });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Update the request
        request.status = "approved";
        request.processedAt = new Date();
        if (parsed.data.notes) request.notes = parsed.data.notes;
        await request.save({ session });

        // Update the clinic plan and extend expiry
        clinic.plan = request.requestedPlan;
        clinic.planStartedAt = new Date();
        const base =
          clinic.planExpiresAt > new Date() ? clinic.planExpiresAt : new Date();
        clinic.planExpiresAt = new Date(
          base.getTime() + parsed.data.extendDays * 24 * 60 * 60 * 1000,
        );
        if (clinic.status === "expired") clinic.status = "active";
        await clinic.save({ session });
      });
    } finally {
      session.endSession();
    }

    await logActivity({
      action: "subscription_request.approved",
      actorEmail: req.admin?.email || "unknown",
      targetType: "subscription_request",
      targetId: request._id as Types.ObjectId,
      targetLabel: `${clinic.name} — ${request.requestedPlan}`,
      details: {
        clinicId: String(clinic._id),
        requestedPlan: request.requestedPlan,
        extendDays: parsed.data.extendDays,
        newExpiry: clinic.planExpiresAt,
      },
    });

    return res.json({
      message: "Upgrade approved and clinic activated",
      request: request.toObject(),
      clinic: clinic.toObject(),
    });
  },
);

/**
 * POST /api/admin/upgrade-requests/:id/reject
 */
const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const rejectUpgradeRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    const request = await SubscriptionRequest.findById(id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({
        message: `This request is already ${request.status}`,
      });
    }

    request.status = "rejected";
    request.processedAt = new Date();
    request.notes = parsed.data.reason;
    await request.save();

    await logActivity({
      action: "subscription_request.rejected",
      actorEmail: req.admin?.email || "unknown",
      targetType: "subscription_request",
      targetId: request._id as Types.ObjectId,
      details: { reason: parsed.data.reason },
    });

    return res.json({
      message: "Request rejected",
      request: request.toObject(),
    });
  },
);

/* ============================================================
 * USERS (across all clinics)
 * ============================================================ */

/**
 * GET /api/admin/users
 * List users across all clinics, with clinic name hydrated in.
 */
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 20));
  const search = ((req.query.search as string) || "").trim();
  const role = req.query.role as string | undefined;

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (role && ["owner", "doctor", "receptionist"].includes(role)) {
    filter.role = role;
  }

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select("-password -verifyTokenHash -resetTokenHash")
      .sort("-createdAt")
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("clinicId", "name slug")
      .lean(),
  ]);

  return res.json({
    users,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

/**
 * POST /api/admin/users/:id/reset-password
 * Admin sets a new password directly.  We don't email the user — the admin
 * hands over the new password out of band.
 */
const resetPwSchema = z.object({
  newPassword: z.string().min(8).max(100),
});

export const adminResetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const parsed = resetPwSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = parsed.data.newPassword;
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    await logActivity({
      action: "user.password_reset_by_admin",
      actorEmail: req.admin?.email || "unknown",
      targetType: "user",
      targetId: user._id as Types.ObjectId,
      targetLabel: user.email,
    });

    return res.json({ message: "Password reset successfully" });
  },
);

/**
 * PATCH /api/admin/users/:id/toggle-active
 */
export const toggleUserActive = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isActive = !user.isActive;
    await user.save();

    await logActivity({
      action: user.isActive ? "user.activated" : "user.deactivated",
      actorEmail: req.admin?.email || "unknown",
      targetType: "user",
      targetId: user._id as Types.ObjectId,
      targetLabel: user.email,
    });

    return res.json({
      message: user.isActive ? "User activated" : "User deactivated",
      user: {
        id: String(user._id),
        isActive: user.isActive,
      },
    });
  },
);

/**
 * PATCH /api/admin/users/:id/verify-email
 * Manually mark a user's email as verified.
 */
export const verifyUserEmailManually = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.emailVerified = true;
    user.verifyTokenHash = undefined;
    user.verifyTokenExpires = undefined;
    await user.save();

    await logActivity({
      action: "user.email_verified_by_admin",
      actorEmail: req.admin?.email || "unknown",
      targetType: "user",
      targetId: user._id as Types.ObjectId,
      targetLabel: user.email,
    });

    return res.json({ message: "Email marked as verified" });
  },
);

/* ============================================================
 * ACTIVITY LOG
 * ============================================================ */

/**
 * GET /api/admin/activity-log
 */
export const getActivityLog = asyncHandler(
  async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
    const action = req.query.action as string | undefined;

    const filter: Record<string, unknown> = {};
    if (action) filter.action = action;

    const [total, logs] = await Promise.all([
      ActivityLog.countDocuments(filter),
      ActivityLog.find(filter)
        .sort("-createdAt")
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      logs,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  },
);

/* ============================================================
 * EMAIL — send custom emails to clinics
 * ============================================================ */

/**
 * POST /api/admin/email/send
 * Send a custom email to a clinic's owner.  Uses the same mailer used elsewhere.
 */
const sendEmailSchema = z.object({
  clinicId: z.string(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

export const sendEmailToClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = sendEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input" });
    }
    if (!Types.ObjectId.isValid(parsed.data.clinicId)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }

    const clinic = await Clinic.findById(parsed.data.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const owner = await User.findOne({ clinicId: clinic._id, role: "owner" });
    if (!owner) return res.status(404).json({ message: "Clinic has no owner" });

    // Lazy import to avoid unnecessary work if this endpoint is never called
    const { sendAdminCustomEmail } = await import("../services/adminMailer");
    await sendAdminCustomEmail(
      owner.email,
      owner.name,
      parsed.data.subject,
      parsed.data.body,
    );

    await logActivity({
      action: "email.sent_to_clinic",
      actorEmail: req.admin?.email || "unknown",
      targetType: "clinic",
      targetId: clinic._id as Types.ObjectId,
      targetLabel: clinic.name,
      details: { subject: parsed.data.subject, to: owner.email },
    });

    return res.json({ message: `Email sent to ${owner.email}` });
  },
);

/* ============================================================
 * SETTINGS
 * ============================================================ */

/**
 * POST /api/admin/settings/change-password
 * Generate a new bcrypt hash and return it so the admin can update their
 * ADMIN_PASSWORD_HASH environment variable.  We DO NOT persist the new password
 * anywhere — the admin has to update the env var manually and redeploy.  This
 * is a deliberate design choice: it means a database compromise never reveals
 * or changes the admin password.
 */
const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const changeAdminPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = changePwSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input" });
    }

    const adminHash = process.env.ADMIN_PASSWORD_HASH || "";
    if (!adminHash) {
      return res.status(500).json({ message: "Admin auth not configured" });
    }

    const ok = await bcrypt.compare(parsed.data.currentPassword, adminHash);
    if (!ok) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);

    await logActivity({
      action: "admin.password_hash_generated",
      actorEmail: req.admin?.email || "unknown",
      targetType: "system",
    });

    return res.json({
      message:
        "New hash generated. Update ADMIN_PASSWORD_HASH env var and redeploy to apply.",
      newHash,
      instructions:
        "Copy the new hash, update ADMIN_PASSWORD_HASH in your Render dashboard environment variables, " +
        "then save changes. Render will redeploy automatically. Your new password takes effect on next login.",
    });
  },
);
