import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db";
import { errorHandler } from "./middleware/errorHandler";

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

const app = express();

const frontendUrl = process.env.FRONTEND_URL;
app.use(
  cors({
    origin: frontendUrl ? [frontendUrl, "http://localhost:3000"] : true,
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
app.use("/api/public", publicRoutes);

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 ClinicOS API running on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
