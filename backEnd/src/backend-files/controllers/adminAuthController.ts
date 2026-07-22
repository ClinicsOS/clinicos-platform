import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { logActivity } from "../services/activityLogger";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * The admin credentials live in environment variables — there is no self-serve
 * signup for admins.  ADMIN_PASSWORD_HASH is a bcrypt hash of the plaintext
 * password (see the README for how to generate it).
 *
 * We match on email first because we always want a constant-time password check
 * for the valid-email case and a fast reject for the wrong-email case.
 */
export const adminLogin = asyncHandler(async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid credentials" });
  }
  const { email, password } = parsed.data;

  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const adminHash = process.env.ADMIN_PASSWORD_HASH || "";
  const adminSecret = process.env.ADMIN_JWT_SECRET || "";

  if (!adminEmail || !adminHash || !adminSecret) {
    console.error("[adminLogin] ADMIN_EMAIL / ADMIN_PASSWORD_HASH / ADMIN_JWT_SECRET not fully configured");
    return res.status(500).json({ message: "Admin auth not configured on server" });
  }

  // Use bcrypt.compare unconditionally to avoid timing-based email enumeration —
  // if the emails don't match, we compare against the real hash anyway then
  // reject.  Both branches take roughly the same time.
  const emailMatches = email.toLowerCase() === adminEmail;
  const passwordOk = await bcrypt.compare(password, adminHash);

  if (!emailMatches || !passwordOk) {
    await logActivity({
      action: "admin.login_failed",
      actorEmail: email,
      targetType: "system",
      details: { reason: emailMatches ? "wrong_password" : "wrong_email" },
    });
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = jwt.sign(
    { sub: "admin", email: adminEmail },
    adminSecret,
    { expiresIn: "12h" }
  );

  await logActivity({
    action: "admin.login_success",
    actorEmail: adminEmail,
    targetType: "system",
  });

  return res.json({
    token,
    admin: { email: adminEmail },
  });
});

/**
 * GET /api/admin/me — used by the frontend to verify a token is still valid
 * after page reload without needing to re-authenticate.
 */
export const adminMe = asyncHandler(async (req: Request, res: Response) => {
  return res.json({ email: req.admin?.email });
});
