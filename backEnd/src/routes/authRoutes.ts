import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  registerClinic,
  login,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  changePassword,
  me,
} from "../controllers/authController";
import { protect } from "../middleware/auth";

const router = Router();

// Aggressive limiter for the credential-guessing surface: login, and the
// password-reset / email-verification token endpoints. Mirrors the limiter
// already used on the admin login and public booking routes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in a few minutes." },
});

// Slightly looser limiter for account creation so a shared clinic network
// (single public IP) can still onboard, while blocking scripted abuse.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many sign-up attempts. Please try again later." },
});

// Public endpoints
router.post("/register-clinic", registerLimiter, registerClinic);
router.post("/login", authLimiter, login);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/verify-email", authLimiter, verifyEmail);

// Protected — requires a valid JWT
router.get("/me", protect, me);
router.post("/resend-verification", protect, resendVerification);
router.post("/change-password", protect, changePassword);

export default router;
