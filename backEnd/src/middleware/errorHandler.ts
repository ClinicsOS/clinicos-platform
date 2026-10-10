import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { safeErrorText } from "../utils/logSafe";

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error("🔴", safeErrorText(err)); // PHASE 7 — never the submitted VALUE of a duplicate / cast / validation error (patient phone, e-mail…)

  // Phase 4 — authorization / data-scope refusals raised by auth/policy.ts
  if (err?.name === "PolicyError" && typeof err.status === "number") {
    return res.status(err.status).json({ message: err.message, code: err.code });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: "Invalid input",
      details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: "Duplicate value — already exists" });
  }
  if (err.name === "ValidationError") {
    // PHASE 7 — a Mongoose message names model fields and echoes values; the client gets a controlled message everywhere.
    return res.status(400).json({ message: "Invalid input" });
  }
  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid ID format" });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body too large" });
  }
  return res.status(500).json({ message: "Server error" });
};
