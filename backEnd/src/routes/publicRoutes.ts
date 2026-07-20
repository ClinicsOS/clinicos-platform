import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getClinicBySlug, getAvailableSlots, publicBook } from "../controllers/publicController";
import { trackBooking, cancelBooking } from "../controllers/trackController";

const router = Router();

const bookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many requests, try again later" },
});

const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: "Too many requests, try again later" },
});

router.get("/clinics/:slug", getClinicBySlug);
router.get("/clinics/:slug/slots", getAvailableSlots);
router.post("/clinics/:slug/book", bookLimiter, publicBook);

router.post("/track", trackLimiter, trackBooking);
router.post("/track/cancel", trackLimiter, cancelBooking);

export default router;
