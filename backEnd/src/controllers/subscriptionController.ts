import { Request, Response } from "express";
import { z } from "zod";
import { Clinic } from "../models/Clinic";
import { SubscriptionRequest } from "../models/SubscriptionRequest";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, PLAN_PRICES, daysUntil, type Plan } from "../config/plans";

/**
 * GET /api/subscription
 * Returns the current clinic's subscription state — plan, limits, days remaining,
 * and pricing so the settings page can render the correct upgrade form.
 */
export const getSubscription = asyncHandler(async (req: Request, res: Response) => {
  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  const pending = await SubscriptionRequest.findOne({
    clinicId: req.clinicId,
    status: "pending",
  }).sort({ createdAt: -1 });

  return res.json({
    plan: clinic.plan,
    price: PLAN_PRICES[clinic.plan as Plan],
    status: clinic.status,
    planStartedAt: clinic.planStartedAt,
    planExpiresAt: clinic.planExpiresAt,
    daysRemaining: daysUntil(clinic.planExpiresAt),
    limits: PLANS[clinic.plan as Plan],
    pendingRequest: pending
      ? {
          id: String(pending._id),
          plan: pending.requestedPlan,
          createdAt: pending.createdAt,
        }
      : null,
    plans: {
      trial: { price: PLAN_PRICES.trial, limits: PLANS.trial },
      basic: { price: PLAN_PRICES.basic, limits: PLANS.basic },
      pro: { price: PLAN_PRICES.pro, limits: PLANS.pro },
    },
  });
});

const upgradeSchema = z.object({
  plan: z.enum(["basic", "pro"]),
  billingName: z.string().min(2).max(100),
  billingEmail: z.string().email(),
  billingPhone: z.string().min(7).max(20),
  paymentMethod: z.enum(["cliq", "bank_transfer", "cash"]),
  paymentRef: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/subscription/upgrade
 * Records the owner's request to move to a paid plan. Approval is manual
 * (via Atlas) for the MVP — no payment gateway.
 */
export const requestUpgrade = asyncHandler(async (req: Request, res: Response) => {
  const data = upgradeSchema.parse(req.body);

  // Prevent stacking requests
  const existing = await SubscriptionRequest.findOne({
    clinicId: req.clinicId,
    status: "pending",
  });
  if (existing) {
    return res.status(409).json({
      message: "You already have a pending upgrade request",
    });
  }

  const request = await SubscriptionRequest.create({
    clinicId: req.clinicId,
    requestedPlan: data.plan,
    billingName: data.billingName,
    billingEmail: data.billingEmail,
    billingPhone: data.billingPhone,
    paymentMethod: data.paymentMethod,
    paymentRef: data.paymentRef,
    notes: data.notes,
    status: "pending",
  });

  return res.status(201).json({
    message: "Upgrade request submitted — we'll activate your plan shortly",
    request: {
      id: String(request._id),
      plan: request.requestedPlan,
      status: request.status,
    },
  });
});
