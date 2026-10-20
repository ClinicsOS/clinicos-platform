import { Appointment } from "../../models/Appointment";
import { Patient } from "../../models/Patient";
import { User } from "../../models/User";
import { PolicyError, doctorMatch, scopeOf } from "../../auth/policy";
import { clinicTodayRange } from "../../utils/timezone";
import { patientSearchFilter } from "../patientSearch";
import { accessiblePatientIds, filterAccessibleIds } from "../../auth/patientAccess";
import { appointmentCardOf, canViewPatient, type AppointmentCard, type PatientCard, type Viewer } from "./references";

/**
 * CLINICOS CONNECT (C4) — what the "Share → Patient / Appointment" pickers list. Small, paginated and permission-scoped by the SAME rules
 * as the rest of ClinicOS; nothing here can be used to read more than the normal APIs already allow the caller.
 *   patients      same search filter as GET /api/patients (services/patientSearch.ts); only { id, fullName, fileNumber } leave the server
 *   appointments  the schedule's own scope (a doctor: their own; owner / receptionist: the clinic) via auth/policy.ts, real appointments only
 *                 (no blocked slots), grouped Today / Upcoming / Recent, optional search by patient
 * Never the whole table: 20 rows per page (+1 look-ahead to know whether there is a next page).
 */
export const PICKER_PAGE = 20;

const pageOf = (raw: unknown): number => {
  if (raw === undefined) return 1;
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw) || Number(raw) < 1) throw new PolicyError(400, "INVALID_QUERY", "Invalid page");
  return Number(raw);
};
const qOf = (raw: unknown): string => {
  if (raw === undefined) return "";
  if (typeof raw !== "string") throw new PolicyError(400, "INVALID_QUERY", "Invalid search");
  return raw.trim().slice(0, 60);
};

export async function pickPatients(v: Viewer, rawQ: unknown, rawPage: unknown): Promise<{ patients: PatientCard[]; page: number; hasMore: boolean }> {
  if (!canViewPatient(v)) throw new PolicyError(403, "FORBIDDEN_ROLE", "Forbidden");
  const q = qOf(rawQ);
  const page = pageOf(rawPage);
  const filter = patientSearchFilter(v.clinicId, q, { fileNumber: true });
  const scope = await accessiblePatientIds(v, "patients"); // PHASE 1: a doctor can share only patients he may open (null = whole clinic)
  if (scope !== null) filter._id = { $in: scope };
  const rows = await Patient.find(filter)
    .select("fullName fileNumber")
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * PICKER_PAGE)
    .limit(PICKER_PAGE + 1)
    .lean();
  return {
    patients: rows.slice(0, PICKER_PAGE).map((p) => ({ id: String(p._id), fullName: p.fullName, fileNumber: p.fileNumber })),
    page,
    hasMore: rows.length > PICKER_PAGE,
  };
}

export type ApptGroup = "today" | "upcoming" | "recent";
export const APPT_GROUPS: readonly ApptGroup[] = ["today", "upcoming", "recent"];

export async function pickAppointments(
  v: Viewer,
  rawGroup: unknown,
  rawQ: unknown,
  rawPage: unknown,
): Promise<{ appointments: AppointmentCard[]; group: ApptGroup; page: number; hasMore: boolean }> {
  const group = (rawGroup === undefined ? "today" : rawGroup) as ApptGroup;
  if (!APPT_GROUPS.includes(group)) throw new PolicyError(400, "INVALID_QUERY", "Invalid group");
  const q = qOf(rawQ);
  const page = pageOf(rawPage);
  // the schedule's scope: 403 for a role without appointments, a doctor is always narrowed to their own id
  const scope = scopeOf({ clinicId: v.clinicId, userId: v.userId, role: v.role }, "appointments");
  const filter: Record<string, any> = { clinicId: v.clinicId, type: { $ne: "blocked" }, ...doctorMatch(scope) };

  const today = clinicTodayRange();
  let sort: Record<string, 1 | -1>;
  if (group === "today") {
    filter.startAt = { $gte: today.start, $lt: today.end };
    sort = { startAt: 1, _id: 1 };
  } else if (group === "upcoming") {
    filter.startAt = { $gte: today.end };
    sort = { startAt: 1, _id: 1 };
  } else {
    filter.startAt = { $lt: today.start };
    sort = { startAt: -1, _id: -1 };
  }

  if (q) {
    // find by the patient's name / phone / file number (archived included: their visits still exist), then restrict to those patients
    const pf = patientSearchFilter(v.clinicId, q, { includeArchived: true, fileNumber: true });
    const scope = await accessiblePatientIds(v, "patients"); // PHASE 1: search never reaches a patient the caller may not open
    if (scope !== null) pf._id = { $in: scope };
    const ids = await Patient.find(pf).select("_id").limit(200).lean();
    if (!ids.length) return { appointments: [], group, page, hasMore: false };
    filter.patientId = { $in: ids.map((p) => p._id) };
  }

  const rows = await Appointment.find(filter)
    .select("patientId doctorId startAt duration status")
    .sort(sort)
    .skip((page - 1) * PICKER_PAGE)
    .limit(PICKER_PAGE + 1)
    .lean();
  const slice = rows.slice(0, PICKER_PAGE);
  const [pats, docs] = await Promise.all([
    slice.length ? Patient.find({ _id: { $in: slice.map((a) => a.patientId).filter(Boolean) }, clinicId: v.clinicId }).select("fullName fileNumber").lean() : Promise.resolve([]),
    slice.length ? User.find({ _id: { $in: slice.map((a) => a.doctorId).filter(Boolean) }, clinicId: v.clinicId }).select("name").lean() : Promise.resolve([]),
  ]);
  const openable = await filterAccessibleIds(v, (pats as any[]).map((p) => p._id), "patients"); // names only for patients the caller may open
  const patients = new Map((pats as any[]).filter((p) => openable.has(String(p._id))).map((p) => [String(p._id), p]));
  const doctors = new Map((docs as any[]).map((d) => [String(d._id), d.name as string]));
  return {
    appointments: slice.map((a) => appointmentCardOf(a as any, v, patients as any, doctors)),
    group,
    page,
    hasMore: rows.length > PICKER_PAGE,
  };
}
