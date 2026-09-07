import { Request, Response } from "express";
import { Appointment } from "../models/Appointment";
import { ReminderLog } from "../models/ReminderLog";
import { asyncHandler } from "../middleware/errorHandler";
import { getAmmanTodayRange, formatAmmanTime } from "../utils/timezone";
import { normalizeJordanPhone } from "../utils/phone";
import { sendWhatsAppTemplate } from "../services/whatsappService";

/**
 * NEW CONTROLLER — reads Appointment/Patient/User (via populate) but never
 * writes to them. Only writes to the new ReminderLog collection. Does not
 * modify any existing controller.
 */

const DOCTOR_TEMPLATE = process.env.WHATSAPP_TEMPLATE_DOCTOR || "clinicos_doctor_reminder";
const PATIENT_TEMPLATE = process.env.WHATSAPP_TEMPLATE_PATIENT || "clinicos_patient_reminder";
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "ar";

// Small helper so the doctor-branch and patient-branch below don't repeat
// the same "already sent? normalize phone? send. log." logic twice.
async function sendAndLog(opts: {
  appointmentId: any;
  clinicId: any;
  recipientRole: "doctor" | "patient";
  rawPhone: string | undefined;
  templateName: string;
  bodyParams: string[];
}): Promise<"sent" | "failed" | "skipped"> {
  if (!opts.rawPhone) return "skipped";

  const already = await ReminderLog.findOne({
    appointmentId: opts.appointmentId,
    recipientRole: opts.recipientRole,
    status: "sent",
  });
  if (already) return "skipped"; // already reminded successfully earlier today

  const normalized = normalizeJordanPhone(opts.rawPhone);
  if (!normalized) return "skipped";

  const result = await sendWhatsAppTemplate(
    normalized,
    opts.templateName,
    TEMPLATE_LANG,
    opts.bodyParams
  );

  await ReminderLog.create({
    appointmentId: opts.appointmentId,
    clinicId: opts.clinicId,
    recipientRole: opts.recipientRole,
    recipientPhone: normalized,
    status: result.success ? "sent" : "failed",
    errorMessage: result.error,
  });

  return result.success ? "sent" : "failed";
}

export const sendDailyReminders = asyncHandler(async (_req: Request, res: Response) => {
  const { start, end, dateStr } = getAmmanTodayRange();

  const appointments = await Appointment.find({
    type: "appointment",
    status: { $in: ["scheduled", "confirmed"] },
    startAt: { $gte: start, $lte: end },
  })
    .populate("patientId", "fullName phone whatsappOptIn")
    .populate("doctorId", "name phone")
    .populate("clinicId", "name")
    .lean();

  const tally = { total: appointments.length, sent: 0, failed: 0, skipped: 0 };

  for (const appt of appointments as any[]) {
    const time = formatAmmanTime(appt.startAt);
    const doctor = appt.doctorId;
    const patient = appt.patientId;

    const doctorOutcome = await sendAndLog({
      appointmentId: appt._id,
      clinicId: appt.clinicId?._id,
      recipientRole: "doctor",
      rawPhone: doctor?.phone,
      templateName: DOCTOR_TEMPLATE,
      bodyParams: [doctor?.name || "دكتور", patient?.fullName || "مريض", time],
    });
    tally[doctorOutcome]++;

    // Respect opt-out: only skip on an explicit `false`, so existing
    // patients created before this field existed (where it's undefined)
    // still get reminded by default.
    const patientOptedIn = patient?.whatsappOptIn !== false;
    const patientOutcome = patientOptedIn
      ? await sendAndLog({
          appointmentId: appt._id,
          clinicId: appt.clinicId?._id,
          recipientRole: "patient",
          rawPhone: patient?.phone,
          templateName: PATIENT_TEMPLATE,
          bodyParams: [patient?.fullName || "", time, doctor?.name || "الطبيب"],
        })
      : "skipped";
    tally[patientOutcome]++;
  }

  console.log(
    `[reminders] ${dateStr}: ${tally.sent} sent, ${tally.failed} failed, ${tally.skipped} skipped (of ${tally.total} appointments)`
  );

  return res.json({ date: dateStr, ...tally });
});
