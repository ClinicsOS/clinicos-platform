import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

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
  console.error("🔴", err.message || err);

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
    return res.status(400).json({ message: err.message });
  }
  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid ID format" });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  return res.status(500).json({ message: "Server error" });
};
