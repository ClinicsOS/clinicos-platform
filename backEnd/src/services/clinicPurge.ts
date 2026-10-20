/**
 * PHASE 7 — one list of every clinic-owned collection, used by BOTH "delete my clinic" paths (owner + platform admin)
 * and by BOTH exports.
 *
 * Why it exists: the two delete handlers used to remove only appointments / invoices / patients / users / subscription
 * requests / loyalty. Every later module (clinical notes, dental + dermatology records, treatment plans, expenses,
 * reminder logs, AI conversations) kept its rows after the clinic was "permanently deleted" — patient clinical data
 * left orphaned in the database, which is both a privacy defect and a data-lifecycle defect.
 *
 * Kept on purpose (platform-level records, not clinic content): the admin ActivityLog and the platform-admin ClinicNote.
 */
import { PatientDoctorAccess } from "../models/PatientDoctorAccess";
import { DoctorDelegation } from "../models/DoctorDelegation";
import { InvoiceCounter } from "../models/InvoiceCounter";
import { ClinicalNote } from "../models/ClinicalNote";
import { DentalRecord } from "../models/DentalRecord";
import { DentalToothEvent } from "../models/DentalToothEvent";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalTreatmentPlan } from "../models/DentalTreatmentPlan";
import { DentalTreatmentSession } from "../models/DentalTreatmentSession";
import { DermAssessment } from "../models/DermAssessment";
import { DermFollowUp } from "../models/DermFollowUp";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { DermTreatmentPlan } from "../models/DermTreatmentPlan";
import { DermTreatmentSession } from "../models/DermTreatmentSession";
import { Expense } from "../models/Expense";
import { RecurringExpense } from "../models/RecurringExpense";
import { ExpenseReminderLog } from "../models/ExpenseReminderLog";
import { ReminderLog } from "../models/ReminderLog";
import { SubscriptionReminderLog } from "../models/SubscriptionReminderLog";
import { Conversation } from "../models/Conversation";
import { ConnectConversation } from "../models/ConnectConversation";
import { ConnectMessage } from "../models/ConnectMessage";
import { ConnectReadState } from "../models/ConnectReadState";

type Finder = { find: (f: any) => any; deleteMany: (f: any) => Promise<unknown> };

/** Clinic content that is part of the owner's data: exported AND purged. */
export const CLINIC_CONTENT_MODELS: Record<string, Finder> = {
  clinicalNotes: ClinicalNote as unknown as Finder,
  dentalRecords: DentalRecord as unknown as Finder,
  dentalToothEvents: DentalToothEvent as unknown as Finder,
  dentalTreatmentPlans: DentalTreatmentPlan as unknown as Finder,
  dentalTreatmentItems: DentalTreatmentItem as unknown as Finder,
  dentalTreatmentSessions: DentalTreatmentSession as unknown as Finder,
  dermAssessments: DermAssessment as unknown as Finder,
  dermFollowUps: DermFollowUp as unknown as Finder,
  dermTreatmentPlans: DermTreatmentPlan as unknown as Finder,
  dermTreatmentItems: DermTreatmentItem as unknown as Finder,
  dermTreatmentSessions: DermTreatmentSession as unknown as Finder,
  expenses: Expense as unknown as Finder,
  recurringExpenses: RecurringExpense as unknown as Finder,
};

/** System bookkeeping: purged with the clinic, not part of the owner's export. */
const CLINIC_SYSTEM_MODELS: Finder[] = [
  ExpenseReminderLog as unknown as Finder,
  ReminderLog as unknown as Finder,
  SubscriptionReminderLog as unknown as Finder,
  Conversation as unknown as Finder,
  // ClinicOS Connect — internal staff chat. Purged with the clinic; deliberately NOT in the owner export (private DMs are not the owner's to export).
  ConnectConversation as unknown as Finder,
  ConnectMessage as unknown as Finder,
  ConnectReadState as unknown as Finder,
  // PHASE 1 (multi-doctor patient isolation) — who may open which patient, and the coverage grants. Authorization data: purged with the clinic.
  PatientDoctorAccess as unknown as Finder,
  DoctorDelegation as unknown as Finder,
  // PHASE 3 — the clinic's invoice number counter. Purged with the clinic (the invoices themselves are deleted by the callers).
  InvoiceCounter as unknown as Finder,
];

/** Delete every clinic-owned collection above (the callers keep deleting the core ones + loyalty themselves). */
export async function purgeClinicData(clinicId: unknown): Promise<void> {
  const filter = { clinicId };
  await Promise.all([
    ...Object.values(CLINIC_CONTENT_MODELS).map((m) => m.deleteMany(filter)),
    ...CLINIC_SYSTEM_MODELS.map((m) => m.deleteMany(filter)),
  ]);
}

/** The clinical + financial collections for an export, keyed by name. */
export async function exportClinicContent(clinicId: unknown): Promise<Record<string, unknown[]>> {
  const entries = await Promise.all(
    Object.entries(CLINIC_CONTENT_MODELS).map(async ([key, m]) => [key, await m.find({ clinicId }).lean()] as const),
  );
  return Object.fromEntries(entries);
}
