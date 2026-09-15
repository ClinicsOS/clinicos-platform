import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { logActivity } from "../services/activityLogger";
import { verifyTotpToken } from "../services/totp";

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
 *
 * TWO-FACTOR AUTH: if ADMIN_TOTP_SECRET is configured, a correct password
 * alone is no longer enough to get a real session token — this handler
 * issues a short-lived "pending" token instead, and the frontend must then
 * call adminVerifyTotp with a 6-digit code before receiving the real admin
 * JWT. If ADMIN_TOTP_SECRET is NOT set, behaviour is unchanged (password
 * only) — this keeps the login working before 2FA has been set up, and
 * during the setup flow itself (see setupTotp / verifyTotpSetup in
 * adminController.ts).
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
    console.error(
      "[adminLogin] ADMIN_EMAIL / ADMIN_PASSWORD_HASH / ADMIN_JWT_SECRET not fully configured",
    );
    return res
      .status(500)
      .json({ message: "Admin auth not configured on server" });
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

  const totpSecret = process.env.ADMIN_TOTP_SECRET || "";

  if (!totpSecret) {
    // 2FA not configured yet — same behaviour as before it existed.
    const token = jwt.sign({ sub: "admin", email: adminEmail }, adminSecret, {
      expiresIn: "12h",
    });
    await logActivity({
      action: "admin.login_success",
      actorEmail: adminEmail,
      targetType: "system",
    });
    return res.json({ token, admin: { email: adminEmail } });
  }

  // Password confirmed, 2FA required. Issue a short-lived pending token —
  // note the different `sub` value, so this can never be mistaken for (or
  // replayed as) a real admin session token by requireAdmin.
  const pendingToken = jwt.sign(
    { sub: "admin_pending", email: adminEmail },
    adminSecret,
    { expiresIn: "5m" },
  );

  await logActivity({
    action: "admin.login_password_ok_awaiting_totp",
    actorEmail: adminEmail,
    targetType: "system",
  });

  return res.json({ requiresTotp: true, pendingToken });
});

const verifyTotpLoginSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(6).max(6),
});

/**
 * POST /api/admin/auth/verify-totp
 * Second step of login when ADMIN_TOTP_SECRET is configured. Exchanges a
 * valid pendingToken (proof the password was already correct, expires in
 * 5 minutes) plus a correct 6-digit code for a real admin session token.
 */
export const adminVerifyTotp = asyncHandler(async (req: Request, res: Response) => {
  const parsed = verifyTotpLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const adminSecret = process.env.ADMIN_JWT_SECRET || "";
  const totpSecret = process.env.ADMIN_TOTP_SECRET || "";
  if (!adminSecret || !totpSecret) {
    return res.status(500).json({ message: "Admin auth not configured on server" });
  }

  let payload: { sub: string; email: string };
  try {
    payload = jwt.verify(parsed.data.pendingToken, adminSecret) as {
      sub: string;
      email: string;
    };
  } catch {
    return res.status(401).json({ message: "Login session expired — please sign in again" });
  }
  if (payload.sub !== "admin_pending") {
    return res.status(401).json({ message: "Invalid login session" });
  }

  const codeOk = await verifyTotpToken(totpSecret, parsed.data.code);
  if (!codeOk) {
    await logActivity({
      action: "admin.totp_failed",
      actorEmail: payload.email,
      targetType: "system",
    });
    return res.status(401).json({ message: "Invalid authentication code" });
  }

  const token = jwt.sign({ sub: "admin", email: payload.email }, adminSecret, {
    expiresIn: "12h",
  });

  await logActivity({
    action: "admin.login_success",
    actorEmail: payload.email,
    targetType: "system",
  });

  return res.json({ token, admin: { email: payload.email } });
});

/**
 * GET /api/admin/me — used by the frontend to verify a token is still valid
 * after page reload without needing to re-authenticate.
 */
export const adminMe = asyncHandler(async (req: Request, res: Response) => {
  return res.json({ email: req.admin?.email });
});
