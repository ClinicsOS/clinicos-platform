/** PHASE 3 — the normalized clinical timeline item returned by GET /patients/:id/clinical-history (mirrors backEnd/src/services/clinicalHistory.ts). */
export type HistorySource = "appointment" | "treatment_plan" | "dental_chart" | "clinical_map" | "clinical_note";
export type HistoryFilter = "all" | HistorySource;

/** The stable names of the Patient Profile tabs as they appear in the URL (`?tab=`), plus "appointment" which opens the Appointments page. */
export type HistoryTab = "appointment" | "treatment-plan" | "dental-chart" | "derm-plan" | "clinical-map" | "record";

export interface HistoryDeepLink {
  tab: HistoryTab;
  sourceId: string;
  noteId: string;
  appointmentId?: string;
  appointmentDate?: string;
  itemId?: string;
  sessionId?: string;
  eventId?: string;
  assessmentId?: string;
  followUpId?: string;
  toothNumber?: string;
  /** Phase 5: every tooth of a multi-tooth treatment (the chart highlights them all). */
  toothNumbers?: string[];
  surface?: string;
}

export interface ClinicalTimelineItem {
  id: string;
  patientId: string;
  clinicId: string;
  sourceType: HistorySource;
  sourceKind: string;
  sourceId: string;
  noteId: string;
  doctorId: string | null;
  doctorName: string | null;
  at: string;
  createdAt: string;
  updatedAt: string;
  localDate: string;
  text: string;
  edited: boolean;
  editedAt?: string;
  status?: "entered_in_error";
  toothNumber?: string;
  toothNumbers?: string[];
  surface?: string;
  surfaces?: string[];
  treatment?: { code?: string; customName?: string; name?: string; sessionNumber?: number; status?: string };
  regions?: { id: string; surface?: string }[];
  chart?: { category?: string; code?: string };
  appointment?: { id: string; startAt: string; localDate: string; status?: string };
  sourceMissing?: boolean;
  deepLink: HistoryDeepLink;
}

export interface HistoryPage {
  items: ClinicalTimelineItem[];
  nextCursor: string | null;
  sources: HistorySource[];
}
