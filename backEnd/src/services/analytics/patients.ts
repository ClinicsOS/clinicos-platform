import { Appointment } from "../../models/Appointment";
import { Patient } from "../../models/Patient";
import type { AnalyticsScope } from "./scope";
import { doctorFilter } from "./scope";
import type { DateRange } from "./range";
import { dayOf } from "./agg";

/**
 * PHASE 6 — PATIENT METRICS.
 *
 * Source of truth for "a patient was seen": an Appointment with status "completed" (type ≠ blocked). That is the only event ClinicOS
 * records that means "this patient actually came" — a scheduled / cancelled / no-show record is not a visit. patient.updatedAt is NEVER used.
 *
 *  • Patients seen         = distinct patients with ≥ 1 completed visit in the range (doctor scope: with THAT doctor).
 *  • NEW patient           = a patient seen in the range whose FIRST-EVER completed visit (in this clinic; with this doctor for a
 *                            doctor scope) happened inside the range.
 *  • RETURNING patient     = a patient seen in the range who already had a completed visit BEFORE the range start.
 *      new + returning = patients seen  (every patient seen is exactly one of the two)
 *  • Visits per patient    = completed visits ÷ patients seen.
 *  • Registered patients   = Patient.createdAt in the range (a registration date — a patient may register without ever being seen).
 *      Clinic-wide only: patients belong to the clinic, so "registered" cannot be attributed to a doctor.
 *  • Total patients        = patients registered up to the end of the range (clinic-wide only).
 *  • Retention rate        = NOT implemented (deferred): it needs an agreed follow-up window and a return event; any number shown
 *                            without that definition would be invented.
 */

export interface PatientVisitStats {
  seen: number;
  newPatients: number;
  returningPatients: number;
  completedVisits: number;
  visitsPerPatient: number | null;
}

export async function patientVisitStats(s: AnalyticsScope, r: DateRange): Promise<PatientVisitStats> {
  const rows = await Appointment.aggregate([
    // all completed visits up to the end of the range (the history is needed to know whether this is the FIRST visit)
    { $match: { clinicId: s.clinicOid, ...doctorFilter(s), type: { $ne: "blocked" }, status: "completed", startAt: { $lt: r.end } } },
    { $group: { _id: "$patientId", first: { $min: "$startAt" }, inRange: { $sum: { $cond: [{ $gte: ["$startAt", r.start] }, 1, 0] } } } },
    { $match: { inRange: { $gt: 0 } } },
    { $group: { _id: { isNew: { $gte: ["$first", r.start] } }, patients: { $sum: 1 }, visits: { $sum: "$inRange" } } },
  ]);
  let newPatients = 0, returning = 0, visits = 0;
  for (const x of rows) {
    visits += x.visits ?? 0;
    if (x._id?.isNew) newPatients += x.patients ?? 0;
    else returning += x.patients ?? 0;
  }
  const seen = newPatients + returning;
  return { seen, newPatients, returningPatients: returning, completedVisits: visits, visitsPerPatient: seen > 0 ? Math.round((visits / seen) * 100) / 100 : null };
}

/** Patients registered in the range (clinic-wide). */
export async function registeredPatients(s: AnalyticsScope, r: DateRange): Promise<number> {
  return Patient.countDocuments({ clinicId: s.clinicOid, createdAt: { $gte: r.start, $lt: r.end } });
}

/** All patients registered up to the end of the range (clinic-wide). */
export async function totalPatients(s: AnalyticsScope, r: DateRange): Promise<number> {
  return Patient.countDocuments({ clinicId: s.clinicOid, createdAt: { $lt: r.end } });
}

/** Registrations per clinic-local day. */
export async function registrationsByDay(s: AnalyticsScope, r: DateRange): Promise<Map<string, number>> {
  const rows = await Patient.aggregate([{ $match: { clinicId: s.clinicOid, createdAt: { $gte: r.start, $lt: r.end } } }, { $group: { _id: dayOf("$createdAt"), n: { $sum: 1 } } }]);
  return new Map(rows.map((x: any) => [String(x._id), x.n ?? 0]));
}

/** Patients seen per clinic-local day (distinct patients with a completed visit that day). */
export async function patientsSeenByDay(s: AnalyticsScope, r: DateRange): Promise<Map<string, number>> {
  const rows = await Appointment.aggregate([
    { $match: { clinicId: s.clinicOid, ...doctorFilter(s), type: { $ne: "blocked" }, status: "completed", startAt: { $gte: r.start, $lt: r.end } } },
    { $group: { _id: { day: dayOf("$startAt"), patientId: "$patientId" } } },
    { $group: { _id: "$_id.day", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((x: any) => [String(x._id), x.n ?? 0]));
}
