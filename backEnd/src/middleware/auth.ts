import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { Clinic } from "../models/Clinic";
import { PLANS, type Plan, type PlanLimits } from "../config/plans";

interface JwtPayload {
  userId: string;
}

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, no token" });
    }
    const token = header.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Not authorized" });
    }

    req.userId = String(user._id);
    req.clinicId = String(user.clinicId);
    req.role = user.role;
    next();
  } catch {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
};

export const authorize =
  (...roles: Array<"owner" | "doctor" | "receptionist">) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };

/**
 * Blocks the request if the clinic's subscription is not active
 * (expired or suspended). Used on every dashboard route so an
 * expired clinic gets a clean 402 instead of silent failures.
 * Read-only routes bypass this so the owner can still see the
 * "renew" screen with their clinic name.
 */
export const requireActivePlan = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  if (clinic.status === "suspended") {
    return res.status(402).json({ message: "Account suspended — contact support", code: "SUSPENDED" });
  }

  const expired = clinic.planExpiresAt && new Date(clinic.planExpiresAt) < new Date();
  if (expired) {
    // Auto-mark expired if we haven't yet
    if (clinic.status !== "expired") {
      clinic.status = "expired";
      await clinic.save();
    }
    return res.status(402).json({ message: "Subscription expired — please renew", code: "EXPIRED" });
  }

  next();
};

/**
 * Enforces a specific feature/limit against the clinic's plan.
 * Usage: requirePlanFeature("exports") or requirePlanFeature("invoicing")
 */
export const requirePlanFeature =
  (feature: keyof Pick<PlanLimits, "invoicing" | "reports" | "exports" | "whiteLabel" | "customBookingColor">) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const clinic = await Clinic.findById(req.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });
    const plan = clinic.plan as Plan;
    if (!PLANS[plan][feature]) {
      return res.status(402).json({
        message: `This feature requires an upgraded plan`,
        code: "PLAN_LIMIT",
        feature,
      });
    }
    next();
  };
