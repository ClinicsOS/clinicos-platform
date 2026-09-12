import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";

interface JwtPayload {
  userId: string;
  tokenVersion?: number;
}

/**
 * Like `protect`, but never rejects the request. If a valid Bearer token
 * is present, req.userId/clinicId/role are populated exactly like the
 * authenticated flow. If it's missing, invalid, or expired, the request
 * just continues as anonymous (all three fields stay undefined).
 *
 * Used only by the chatbot endpoint, which must serve both anonymous
 * visitors/patients and logged-in clinic users through the same route.
 */
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return next();
    }
    const token = header.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return next(); // invalid/stale token — treat as anonymous, don't error
    }
    // Revoked token (password change / reset / deactivation) — treat as anonymous.
    if ((decoded.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      return next();
    }

    req.userId = String(user._id);
    req.clinicId = String(user.clinicId);
    req.role = user.role;
    next();
  } catch {
    next(); // bad/expired token — treat as anonymous
  }
};
