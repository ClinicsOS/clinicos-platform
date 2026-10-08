import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db";
import { errorHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/securityHeaders";
import { assertProductionConfig } from "./config/env"; // Phase 10 — refuse to start production with a missing / weak secret

import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import patientRoutes from "./routes/patientRoutes";
import appointmentRoutes from "./routes/appointmentRoutes";
import clinicRoutes from "./routes/clinicRoutes";
import invoiceRoutes from "./routes/invoiceRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import subscriptionRoutes from "./routes/subscriptionRoutes";
import reportsRoutes from "./routes/reportsRoutes";
import publicRoutes from "./routes/publicRoutes";
import adminRoutes from "./routes/adminRoutes";
import reminderRoutes from "./routes/reminderRoutes"; // NEW — WhatsApp appointment reminders
import chatRoutes from "./routes/chatRoutes"; // NEW — "معك" chatbot
import expenseRoutes from "./routes/expenseRoutes"; // NEW — clinic & owner expenses
import dentalRoutes from "./routes/dentalRoutes"; // NEW — Dentistry module (dentistry clinics only)
import dermRoutes from "./routes/dermRoutes"; // NEW — Dermatology & Aesthetics module (dermatology_aesthetics clinics only)
import { repairLoyaltyTransactionIndexes } from "./models/LoyaltyTransaction"; // NEW — one-time ledger index repair (see model)
import loyaltyRoutes from "./routes/loyaltyRoutes"; // NEW — ClinicOS Loyalty engine (paid add-on; entitlement-gated server-side)
import loyaltyPublicRoutes from "./routes/loyaltyPublicRoutes"; // NEW — public patient Loyalty (slug + short-lived Loyalty-only session)

/** Phase 10 — Loyalty staff responses hold members' balances and activity: never let a browser / proxy keep them. */
const noStore = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Security headers on every response (must run before the routes).
app.use(securityHeaders);

// FIX #11 (F-03) — CORS must fail CLOSED, never reflect every origin.
// Production: only the configured FRONTEND_URL is allowed; localhost is
// never automatically trusted, and a missing FRONTEND_URL means NO origin
// is allowed (rather than the previous `true`, which reflected any origin).
// Development: the local Next.js dev server is also allowed, so local work
// keeps working without needing FRONTEND_URL set.
const frontendUrl = process.env.FRONTEND_URL;
const isProduction = process.env.NODE_ENV === "production";
const corsOrigin: string[] | false = isProduction
  ? (frontendUrl ? [frontendUrl] : false)
  : (frontendUrl ? [frontendUrl, "http://localhost:3000"] : ["http://localhost:3000"]);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_, res) => res.json({ ok: true, service: "clinicos-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/clinic", clinicRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/public/loyalty", loyaltyPublicRoutes); // NEW — must come BEFORE /api/public
app.use("/api/public", publicRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reminders", reminderRoutes); // NEW — WhatsApp appointment reminders
app.use("/api/chat", chatRoutes); // NEW — "معك" chatbot
app.use("/api/expenses", expenseRoutes); // NEW — clinic & owner expenses
app.use("/api/dental", dentalRoutes); // NEW — Dentistry module (specialty-gated server-side)
app.use("/api/derm", dermRoutes); // NEW — Dermatology & Aesthetics module (specialty-gated server-side)
app.use("/api/loyalty", noStore, loyaltyRoutes); // NEW — ClinicOS Loyalty (requires the active paid add-on)

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

const start = async () => {
  assertProductionConfig();
  await connectDB();
  // Loyalty ledger: replace two faulty multi-key sparse indexes (no-op once repaired; never touches data).
  await repairLoyaltyTransactionIndexes()
    .then((d) => d.length && console.log("[loyalty] repaired legacy ledger indexes:", d.join(", ")))
    .catch((e) => console.error("[loyalty] ledger index repair skipped:", e instanceof Error ? e.message : e));
  app.listen(PORT, () => {
    console.log(`🚀 ClinicOS API running on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
