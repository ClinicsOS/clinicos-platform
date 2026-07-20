import { Request, Response } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Clinic } from "../models/Clinic";
import { User, generateToken, hashToken } from "../models/User";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS } from "../config/plans";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/mailer";

const registerSchema = z.object({
  clinicName: z.string().min(2).max(100),
  specialty: z.string().min(2).max(50),
  ownerName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  phone: z.string().optional(),
});

const RESERVED = ["admin", "api", "login", "signup", "signin", "dashboard", "book", "pricing", "track", "settings"];

const slugify = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const uniqueSlug = async (name: string): Promise<string> => {
  let base = slugify(name);
  if (base.length < 3 || RESERVED.includes(base)) base = `clinic-${base}`;
  let candidate = base;
  let counter = 2;
  while (await Clinic.exists({ slug: candidate })) {
    candidate = `${base}-${counter++}`;
  }
  return candidate;
};

const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn: "7d" });

// ==================================================================
// POST /api/auth/register-clinic
// Creates the clinic + owner, sends a verification email, and returns a JWT.
// ==================================================================
export const registerClinic = asyncHandler(async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body);

  const emailTaken = await User.exists({ email: data.email.toLowerCase() });
  if (emailTaken) {
    return res.status(409).json({ message: "This email is already registered" });
  }

  const slug = await uniqueSlug(data.clinicName);
  const trialDays = PLANS.trial.trialDays;
  const trialExpiresAt = new Date();
  trialExpiresAt.setDate(trialExpiresAt.getDate() + trialDays);

  const [verifyPlain, verifyHash] = generateToken();
  const verifyExpires = new Date();
  verifyExpires.setHours(verifyExpires.getHours() + 24);

  const session = await mongoose.startSession();
  try {
    let clinicId!: string;
    let userId!: string;
    let planExp!: Date;

    await session.withTransaction(async () => {
      const [clinic] = await Clinic.create(
        [
          {
            name: data.clinicName,
            slug,
            specialty: data.specialty,
            phone: data.phone,
            workingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
              day,
              isOpen: day !== 5,
              from: "10:00",
              to: "18:00",
            })),
            plan: "trial",
            planStartedAt: new Date(),
            planExpiresAt: trialExpiresAt,
            status: "active",
          },
        ],
        { session }
      );

      const [owner] = await User.create(
        [
          {
            clinicId: clinic._id,
            name: data.ownerName,
            email: data.email,
            password: data.password,
            role: "owner",
            emailVerified: false,
            verifyTokenHash: verifyHash,
            verifyTokenExpires: verifyExpires,
          },
        ],
        { session }
      );

      clinicId = String(clinic._id);
      userId = String(owner._id);
      planExp = trialExpiresAt;
    });

    // Fire-and-forget: don't block the sign-up response on the email delivery
    sendVerificationEmail(data.email, data.ownerName, verifyPlain).catch((err) =>
      console.error("[registerClinic] failed to send verification email:", err)
    );

    return res.status(201).json({
      token: signToken(userId),
      user: {
        id: userId,
        name: data.ownerName,
        email: data.email,
        role: "owner",
        emailVerified: false,
      },
      clinic: { id: clinicId, name: data.clinicName, slug, plan: "trial", planExpiresAt: planExp },
    });
  } finally {
    session.endSession();
  }
});

// ==================================================================
// POST /api/auth/login
// ==================================================================
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const data = loginSchema.parse(req.body);

  const user = await User.findOne({ email: data.email.toLowerCase() }).select("+password");

  if (!user || !(await user.comparePassword(data.password))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }
  if (!user.isActive) {
    return res.status(401).json({ message: "Your account has been deactivated" });
  }

  return res.json({
    token: signToken(String(user._id)),
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
    },
  });
});

// ==================================================================
// POST /api/auth/forgot-password
// Always returns 200 even if the email doesn't exist — prevents email enumeration.
// ==================================================================
const forgotSchema = z.object({ email: z.string().email() });

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = forgotSchema.parse(req.body);

  const user = await User.findOne({ email: email.toLowerCase() });
  // If the account exists AND is active, generate + send a reset link
  if (user && user.isActive) {
    const [plain, hash] = generateToken();
    const expires = new Date();
    expires.setHours(expires.getHours() + 1); // 1 hour validity

    user.resetTokenHash = hash;
    user.resetTokenExpires = expires;
    await user.save();

    sendPasswordResetEmail(user.email, user.name, plain).catch((err) =>
      console.error("[forgotPassword] failed to send reset email:", err)
    );
  }

  // Deliberately vague message — same for existing/non-existing emails
  return res.json({
    message: "If an account exists with that email, a reset link has been sent.",
  });
});

// ==================================================================
// POST /api/auth/reset-password
// ==================================================================
const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(100),
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = resetSchema.parse(req.body);
  const hash = hashToken(token);

  const user = await User.findOne({
    resetTokenHash: hash,
    resetTokenExpires: { $gt: new Date() },
  }).select("+password +resetTokenHash +resetTokenExpires");

  if (!user) {
    return res.status(400).json({
      message: "This reset link is invalid or has expired. Please request a new one.",
    });
  }

  user.password = password;
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();

  return res.json({
    message: "Password reset successfully. You can now sign in.",
  });
});

// ==================================================================
// POST /api/auth/verify-email
// ==================================================================
const verifySchema = z.object({ token: z.string().min(20) });

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = verifySchema.parse(req.body);
  const hash = hashToken(token);

  const user = await User.findOne({
    verifyTokenHash: hash,
    verifyTokenExpires: { $gt: new Date() },
  }).select("+verifyTokenHash +verifyTokenExpires");

  if (!user) {
    return res.status(400).json({
      message: "This verification link is invalid or has expired. Please request a new one.",
    });
  }

  user.emailVerified = true;
  user.verifyTokenHash = undefined;
  user.verifyTokenExpires = undefined;
  await user.save();

  return res.json({ message: "Email verified successfully.", verified: true });
});

// ==================================================================
// POST /api/auth/resend-verification (requires auth)
// ==================================================================
export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.emailVerified) {
    return res.json({ message: "Email is already verified." });
  }

  const [plain, hash] = generateToken();
  const expires = new Date();
  expires.setHours(expires.getHours() + 24);

  user.verifyTokenHash = hash;
  user.verifyTokenExpires = expires;
  await user.save();

  sendVerificationEmail(user.email, user.name, plain).catch((err) =>
    console.error("[resendVerification] failed:", err)
  );

  return res.json({ message: "Verification email sent." });
});

// ==================================================================
// POST /api/auth/change-password (requires auth)
// ==================================================================
const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = changePwSchema.parse(req.body);

  const user = await User.findById(req.userId).select("+password");
  if (!user) return res.status(404).json({ message: "User not found" });

  const ok = await user.comparePassword(currentPassword);
  if (!ok) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ message: "The new password must be different from the current one" });
  }

  user.password = newPassword;
  await user.save();
  return res.json({ message: "Password changed successfully." });
});

// ==================================================================
// GET /api/auth/me — returns current user info (used to refresh after verification)
// ==================================================================
export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
  });
});
