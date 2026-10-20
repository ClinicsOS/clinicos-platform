import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db";
import { errorHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/securityHeaders";
import { assertProductionConfig } from "./config/env";
import { allowedOrigins } from "./config/origins"; // one definition of "which browser origins may call the API" (HTTP CORS and Connect realtime)
import { attachConnectRealtime } from "./services/connect/realtime"; // C3 — Connect realtime delivery layer (Socket.IO) // Phase 10 — refuse to start production with a missing / weak secret

import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import patientRoutes from "./routes/patientRoutes";
import appointmentRoutes from "./routes/appointmentRoutes";
import clinicRoutes from "./routes/clinicRoutes";
import invoiceRoutes from "./routes/invoiceRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import subscriptionRoutes from "./routes/subscriptionRoutes";
import reportsRoutes from "./routes/reportsRoutes";
import analyticsRoutes from "./routes/analyticsRoutes"; // PHASE 6 — Analytics Center
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
import connectRoutes from "./routes/connectRoutes"; // NEW — ClinicOS Connect (C1): internal staff chat, Pro-only, enforced server-side
import { ConnectConversation } from "./models/ConnectConversation";
import { ConnectMessage } from "./models/ConnectMessage";
import { ConnectReadState } from "./models/ConnectReadState";
import patientAccessRoutes from "./routes/patientAccessRoutes"; // NEW — multi-doctor patient isolation: doctor coverage (delegation) + owner assignment
import { PatientDoctorAccess } from "./models/PatientDoctorAccess";
import { DoctorDelegation } from "./models/DoctorDelegation";
import { backfillAllClinics } from "./services/patientAccessBackfill";
import { bootstrapInvoiceCounters } from "./services/invoiceNumbering";
import { InvoiceCounter } from "./models/InvoiceCounter";
import { Invoice } from "./models/Invoice";

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
const corsOrigin = allowedOrigins();
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
app.use("/api/analytics", analyticsRoutes); // PHASE 6 — Analytics Center
app.use("/api/public/loyalty", loyaltyPublicRoutes); // NEW — must come BEFORE /api/public
app.use("/api/public", publicRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reminders", reminderRoutes); // NEW — WhatsApp appointment reminders
app.use("/api/chat", chatRoutes); // NEW — "معك" chatbot
app.use("/api/expenses", expenseRoutes); // NEW — clinic & owner expenses
app.use("/api/dental", dentalRoutes); // NEW — Dentistry module (specialty-gated server-side)
app.use("/api/derm", dermRoutes); // NEW — Dermatology & Aesthetics module (specialty-gated server-side)
app.use("/api/loyalty", noStore, loyaltyRoutes); // NEW — ClinicOS Loyalty (requires the active paid add-on)
app.use("/api/patient-access", noStore, patientAccessRoutes); // NEW — doctor coverage / patient assignment (never cached)
app.use("/api/connect", noStore, connectRoutes); // NEW — ClinicOS Connect C1 (Pro plan; staff messages are never cached)

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

const start = async () => {
  assertProductionConfig();
  await connectDB();
  // Loyalty ledger: replace two faulty multi-key sparse indexes (no-op once repaired; never touches data).
  await repairLoyaltyTransactionIndexes()
    .then((d) => d.length && console.log("[loyalty] repaired legacy ledger indexes:", d.join(", ")))
    .catch((e) => console.error("[loyalty] ledger index repair skipped:", e instanceof Error ? e.message : e));
  // ClinicOS Connect: make sure the unique indexes (one direct conversation per pair, one Clinic Team per clinic) exist BEFORE serving traffic.
  await Promise.all([ConnectConversation.init(), ConnectMessage.init(), ConnectReadState.init()]).catch((e) =>
    console.error("[connect] index build failed:", e instanceof Error ? e.message : e),
  );
  // PHASE 1 (patient isolation): build the access indexes, then link every EXISTING patient to the doctor(s) it provably belongs to
  // BEFORE serving traffic (insert-only, idempotent, never guesses — see services/patientAccessBackfill.ts). PATIENT_ACCESS_BACKFILL=off skips it
  // (the operator script `dist/scripts/patientAccessBackfill.js` does the same on demand). A failure is logged and never blocks the API.
  await Promise.all([PatientDoctorAccess.init(), DoctorDelegation.init()]).catch((e) =>
    console.error("[patient-access] index build failed:", e instanceof Error ? e.message : e),
  );
  if (String(process.env.PATIENT_ACCESS_BACKFILL || "").toLowerCase() !== "off") {
    await backfillAllClinics()
      .then((s) => s.created && console.log(`[patient-access] backfill linked ${s.created} patient(s) across ${s.clinics} clinic(s); ${s.unassigned} left unassigned (owner / front desk only)`))
      .catch((e) => console.error("[patient-access] backfill skipped:", e instanceof Error ? e.message : e));
  }
  // PHASE 3 (invoice safety): build the counter + invoice-number indexes, then give every clinic that already has invoices a counter ABOVE its highest
  // existing number (idempotent, only ever raises, edits nothing — see services/invoiceNumbering.ts). INVOICE_COUNTER_BOOTSTRAP=off skips it;
  // `dist/scripts/invoiceCounterBootstrap.js` does the same on demand. A failure is logged and never blocks the API (the first invoice bootstraps lazily).
  await Promise.all([InvoiceCounter.init(), Invoice.init()]).catch((e) =>
    console.error("[invoice-counter] index build failed:", e instanceof Error ? e.message : e),
  );
  if (String(process.env.INVOICE_COUNTER_BOOTSTRAP || "").toLowerCase() !== "off") {
    await bootstrapInvoiceCounters()
      .then((r) => (r.created || r.raised) && console.log(`[invoice-counter] bootstrap: ${r.created} counter(s) created, ${r.raised} raised, ${r.unchanged} already correct (${r.clinics} clinic(s) with invoices)`))
      .catch((e) => console.error("[invoice-counter] bootstrap skipped:", e instanceof Error ? e.message : e));
  }
  // C3: Connect realtime shares this HTTP server (and its port); it only DELIVERS what the C1 HTTP services have already persisted.
  const server = http.createServer(app);
  const realtime = attachConnectRealtime(server);
  server.listen(PORT, () => {
    console.log(`🚀 ClinicOS API running on port ${PORT}`);
  });
  // Render sends SIGTERM on deploy / restart: close sockets cleanly (clients reconnect and reconcile over HTTP), then stop.
  process.once("SIGTERM", () => {
    const force = setTimeout(() => process.exit(0), 8000);
    force.unref();
    (realtime ? realtime.close() : Promise.resolve()).finally(() => server.close(() => process.exit(0)));
  });
};

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
