import { Request, Response } from "express";
import { z } from "zod";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { Patient } from "../models/Patient";
import { Appointment } from "../models/Appointment";
import { Invoice } from "../models/Invoice";
import { SubscriptionRequest } from "../models/SubscriptionRequest";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, PLAN_PRICES, daysUntil, type Plan } from "../config/plans";
import { isValidWorkingRange, timeToMinutes } from "../utils/workingHoursTime";

/** Attach plan info (limits, price, days remaining) to a clinic response. */
const enrich = (clinic: any) => {
  const plan = clinic.plan as Plan;
  return {
    ...clinic.toObject(),
    planInfo: {
      plan,
      price: PLAN_PRICES[plan],
      limits: PLANS[plan],
      daysRemaining: daysUntil(clinic.planExpiresAt),
    },
  };
};

export const getMyClinic = asyncHandler(async (req: Request, res: Response) => {
  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });
  return res.json(enrich(clinic));
});

const updateClinicSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  specialty: z.string().min(2).max(50).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(200).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  slotDuration: z.number().min(10).max(120).optional(),
  workingHours: z
    .array(
      z.object({
        day: z.number().min(0).max(6),
        isOpen: z.boolean(),
        from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        breakFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
        breakTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
      })
    )
    .length(7)
    .optional(),
});

export const updateMyClinic = asyncHandler(async (req: Request, res: Response) => {
  const data = updateClinicSchema.parse(req.body);

  if (data.workingHours) {
    for (const wh of data.workingHours) {
      if (wh.isOpen && !isValidWorkingRange(wh.from, wh.to)) {
        return res.status(400).json({
          message: `Invalid hours for day ${wh.day}: 'from' must be before 'to'`,
        });
      }

      // A partial break (only one of the two times set) is never a valid
      // configuration on its own — reject it regardless of isOpen, so a
      // dangling half-set break can never be persisted.
      if ((wh.breakFrom && !wh.breakTo) || (!wh.breakFrom && wh.breakTo)) {
        return res.status(400).json({
          message: `Invalid break for day ${wh.day}: both break start and break end are required`,
        });
      }

      // A fully-specified break must fall inside that day's working hours:
      // workingStart <= breakStart < breakEnd <= workingEnd. Mirrors the
      // working-hours `to` semantics for the break's own end — a breakTo of
      // "00:00" means "runs to the end of this day" (e.g. "23:30" -> "00:00"
      // on a clinic that closes at midnight), not "the start of the day" —
      // so a clinic that closes at midnight can still validly configure a
      // break that runs right up to closing.
      if (wh.isOpen && wh.breakFrom && wh.breakTo) {
        const workingStart = timeToMinutes(wh.from);
        const workingEnd = timeToMinutes(wh.to, { endOfDay: true });
        const breakStart = timeToMinutes(wh.breakFrom);
        const breakEnd = timeToMinutes(wh.breakTo, { endOfDay: true });

        if (!(workingStart <= breakStart && breakStart < breakEnd && breakEnd <= workingEnd)) {
          return res.status(400).json({
            message: `Invalid break for day ${wh.day}: break must fall within working hours`,
          });
        }
      }
    }
  }

  // brandColor is a Pro-only feature — gate it here
  if (data.brandColor !== undefined) {
    const clinic = await Clinic.findById(req.clinicId);
    if (clinic && !PLANS[clinic.plan as Plan].customBookingColor) {
      return res.status(402).json({
        message: "Custom booking colour is a Pro feature",
        code: "PLAN_LIMIT",
        feature: "customBookingColor",
      });
    }
  }

  const clinic = await Clinic.findByIdAndUpdate(
    req.clinicId,
    { $set: data },
    { new: true, runValidators: true }
  );

  if (!clinic) return res.status(404).json({ message: "Clinic not found" });
  return res.json(enrich(clinic));
});

// ==================================================================
// DELETE /api/clinic — permanently deletes the clinic and every
// associated document (patients, appointments, invoices, users).
// Owner-only.  Requires "confirmText: DELETE" in the body.
// ==================================================================
export const deleteMyClinic = asyncHandler(async (req: Request, res: Response) => {
  const { confirmText } = req.body as { confirmText?: string };
  if (confirmText !== "DELETE") {
    return res.status(400).json({
      message: "To confirm deletion, please type DELETE exactly.",
      code: "CONFIRM_REQUIRED",
    });
  }

  const clinicId = req.clinicId;
  await Promise.all([
    Appointment.deleteMany({ clinicId }),
    Invoice.deleteMany({ clinicId }),
    Patient.deleteMany({ clinicId }),
    User.deleteMany({ clinicId }),
    SubscriptionRequest.deleteMany({ clinicId }),
    Clinic.deleteOne({ _id: clinicId }),
  ]);

  return res.json({
    message: "Clinic and all associated data deleted permanently.",
    deleted: true,
  });
});

// ==================================================================
// GET /api/clinic/export — returns every clinic document as JSON.
// The user can download this to keep their data before deleting.
// ==================================================================
export const exportMyClinic = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = req.clinicId;

  const [clinic, users, patients, appointments, invoices] = await Promise.all([
    Clinic.findById(clinicId).lean(),
    User.find({ clinicId }).select("-password -verifyTokenHash -resetTokenHash").lean(),
    Patient.find({ clinicId }).lean(),
    Appointment.find({ clinicId }).lean(),
    Invoice.find({ clinicId }).lean(),
  ]);

  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  return res.json({
    exportedAt: new Date().toISOString(),
    format: "ClinicOS export v1",
    clinic,
    users,
    patients,
    appointments,
    invoices,
  });
});
