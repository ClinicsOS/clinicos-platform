import type { DentitionType } from "./fdi";
import type { EventCategory, SurfaceId } from "./taxonomy";

export interface DentalUserRef { _id: string; name: string }

export interface DentalEvent {
  _id: string;
  fdi: string;
  dentitionType: DentitionType;
  category: EventCategory;
  code: string;
  surfaces: SurfaceId[];
  note?: string;
  status: "active" | "resolved";
  createdAt: string;
  createdBy: DentalUserRef | null;
  resolution?: { at: string; reason: "resolved" | "entered_in_error"; note?: string; by: DentalUserRef | null };
}

export interface DentalRecordInfo {
  exists: boolean;
  dentitionType: DentitionType;
  /** Mixed only: FDI codes currently charted; null => default mixed chart. */
  currentTeeth: string[] | null;
  dentitionLog: Array<{ from: DentitionType; to: DentitionType; changedAt: string }>;
}

export interface DentalRecordResponse {
  record: DentalRecordInfo;
  events: DentalEvent[];
}

/** What the 3D engine needs to know about one tooth (derived from ACTIVE events). */
export interface ToothVisualState {
  missing: boolean;
  restoration: null | "crown" | "bridge" | "implant";
  fillings: SurfaceId[]; // surfaces of existing fillings ([] with filling present => occlusal default)
  hasFilling: boolean;
  rootCanal: boolean;
  partiallyErupted: boolean; // tooth sits lower in the gingiva
  plan: "planned" | "in_progress" | null; // treatment-plan indicator (restrained: a small shape, not a colour wash)
  treated: boolean; // has completed treatment (history indicator)
  unerupted: boolean; // not visible; position stays selectable (ghost)
  diagnoses: Array<{ code: string; surfaces: SurfaceId[] }>;
}

// ---------- Phase 3: treatment plan / sessions ----------
import type { PlanStatus, Priority, TargetType } from "./procedures";
export type { PlanStatus, Priority, TargetType };

export interface PersonRef { _id: string; name: string }
export interface TreatmentItem {
  _id: string;
  planId: string;
  procedureCode: string;
  targetType: TargetType;
  toothNumbers: string[];
  surfaces: SurfaceId[];
  status: PlanStatus;
  priority: Priority;
  phase: number;
  estimatedPrice: number | null; // an ESTIMATE only — never a charge / balance
  notes?: string;
  sourceDiagnosisIds: string[];
  dentitionType: DentitionType;
  cancelReason?: string;
  statusHistory: { status: PlanStatus; at: string; by: PersonRef | null; appointmentId?: string; note?: string }[];
  createdBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  billing: BillingView;
}
export interface TreatmentSession {
  _id: string;
  itemId: string;
  appointmentId: string; // the EXISTING ClinicOS visit
  sessionNumber: number;
  procedureCode: string; // snapshot
  targetType: TargetType;
  toothNumbers: string[];
  surfaces: SurfaceId[];
  status: "in_progress" | "completed";
  autoClosed: boolean;
  notes?: string;
  performedBy: PersonRef | null;
  startedAt: string;
  completedAt?: string;
  itemStatus?: PlanStatus;
  estimatedPrice?: number | null; // visit endpoint only
  billing?: BillingView; // visit endpoint only
}
export type TimelineKind = "plan_created" | "treatment_started" | "session" | "session_finished" | "treatment_completed" | "treatment_cancelled" | "invoiced" | "invoice_released";
export interface TimelineEntry {
  id: string; at: string; kind: TimelineKind; itemId: string; procedureCode: string; targetType: TargetType;
  toothNumbers: string[]; surfaces: SurfaceId[]; by: PersonRef | null; appointmentId?: string; sessionNumber?: number; reason?: string; invoiceNumber?: number; amount?: number;
}
export interface VisitRef { startAt: string; source: string; status: string }
export interface TreatmentPlanResponse {
  plan: { phases: { number: number; name?: string }[] };
  items: TreatmentItem[];
  sessions: TreatmentSession[];
  visits: Record<string, VisitRef>;
  timeline: TimelineEntry[];
  summary: { planned: number; inProgress: number; completed: number; cancelled: number; estimatedTotal: number; estimatedRemaining: number; invoicedTotal: number; invoicedCount: number };
}
export interface VisitTreatmentsResponse {
  visit: { _id: string; status: string; source: string; startAt: string };
  pending: (TreatmentItem & { sessionInVisit: TreatmentSession | null })[];
  performed: TreatmentSession[];
}

// ---------- Phase 4: financial LINK (the Invoice / Payment system remains the only source of truth for money) ----------
export interface BillingView {
  state: "none" | "pending" | "invoiced";
  invoiceId?: string;
  invoiceNumber?: number;
  invoiceItemId?: string;
  amount?: number; // LIVE amount of the invoice line — the estimate (estimatedPrice) is never overwritten by it
  invoiceStatus?: string; // unpaid | partially_paid | paid, read from the invoice
  at?: string;
  by?: PersonRef | null;
}
