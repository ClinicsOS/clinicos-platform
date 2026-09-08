import { Router } from "express";
import rateLimit from "express-rate-limit";
import { optionalAuth } from "../middleware/optionalAuth";
import { sendMessage } from "../controllers/chatController";

const router = Router();

// Public-facing and costs money per call — keep it capped per IP.
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { message: "Too many messages, try again later" },
});

router.post("/message", chatLimiter, optionalAuth, sendMessage);

export default router;
