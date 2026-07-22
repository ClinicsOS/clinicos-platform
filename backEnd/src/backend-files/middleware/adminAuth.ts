import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/**
 * Admin JWT payload — kept explicit so we know exactly what's inside the token.
 * Note we deliberately use `sub: "admin"` as a marker, so a leaked user token
 * can never be replayed against admin endpoints (different secret AND payload shape).
 */
export interface AdminJwtPayload {
  sub: "admin";
  email: string;
  iat?: number;
  exp?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminJwtPayload;
    }
  }
}

/**
 * Requires a valid admin JWT signed with ADMIN_JWT_SECRET.
 *
 * We intentionally use a different secret than the clinic-facing JWT_SECRET so
 * even if one is compromised the other blast radius stays contained.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Admin authentication required" });
  }

  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    // Refuse to run at all if the secret isn't configured — much safer than
    // silently allowing requests through with an empty key.
    console.error("[adminAuth] ADMIN_JWT_SECRET is not set — refusing all admin requests");
    return res.status(500).json({ message: "Admin auth not configured" });
  }

  try {
    const payload = jwt.verify(header.slice(7), secret) as AdminJwtPayload;
    if (payload.sub !== "admin") {
      return res.status(401).json({ message: "Invalid admin token" });
    }
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Admin token invalid or expired" });
  }
};
