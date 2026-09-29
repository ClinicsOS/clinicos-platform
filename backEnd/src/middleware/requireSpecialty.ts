import { Request, Response, NextFunction } from "express";
import { Clinic } from "../models/Clinic";

/**
 * Server-side specialty gate. Must run AFTER `protect` (which derives req.clinicId from
 * the authenticated user's own document — never from the client).
 *
 * The specialty is read fresh from the database and compared to the STABLE id
 * (e.g. "dentistry"). Translated labels, legacy free-text values and anything the client
 * sends are never used: a legacy clinic whose stored value is "Dentist" is intentionally
 * NOT granted access (no normalisation/migration is performed).
 */
export const requireSpecialty =
  (specialtyId: string) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinic = await Clinic.findById(req.clinicId).select("specialty");
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });
      if (clinic.specialty !== specialtyId) {
        return res.status(403).json({
          message: "This module is not available for your clinic's specialty",
          code: "SPECIALTY_FORBIDDEN",
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
