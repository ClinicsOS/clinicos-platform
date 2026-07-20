import { Router } from "express";
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

// Public endpoints
router.post("/register-clinic", registerClinic);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/verify-email", verifyEmail);

// Protected — requires a valid JWT
router.get("/me", protect, me);
router.post("/resend-verification", protect, resendVerification);
router.post("/change-password", protect, changePassword);

export default router;
