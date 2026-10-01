import type { RecordType, RegionGroup } from "./regions";
import type { DermAssessment, DermPerson, DermRegionRef } from "./types";
import type { FollowUpOutcome, PlanStatus, Priority, TargetType } from "./procedures";

/** Wire types of the Phase 2 endpoints (/api/derm/...). Dates arrive as ISO strings. */
export interface BillingView {
  state: "none" | "pending" | "invoiced";
  invoiceId?: string;
  invoiceNumber?: number;
  invoiceItemId?: string;
  /** LIVE amount of the invoice line — the invoice is authoritative, not the estimate. */
  amount?: number;
  invoiceStatus?: string;
  at?: string;
  by?: DermPerson | null;
}
export interface ItemStats { sessionCount: number; lastSessionAt: string | null; nextFollowUpDueAt: string | null; followUpCount: number }
export interface StatusEntry { status: PlanStatus; at: string; by: DermPerson | null; appointmentId?: string; note?: string }

export interface TreatmentItem {
  _id: string;
  planId: string;
  recordType: RecordType;
  procedureCode: string;
  targetType: TargetType;
  regions: DermRegionRef[];
  generalArea?: RegionGroup;
  status: PlanStatus;
  priority: Priority;
  phase: number;
  /** An ESTIMATE only — never an invoice, payment, debt or balance. */
  estimatedPrice: number | null;
  notes?: string;
  sourceAssessmentId: string | null;
  sourceDiagnosis?: string;
  cancelReason?: string;
  statusHistory: StatusEntry[];
  createdBy: DermPerson | null;
  createdAt: string;
  updatedAt: string;
  billing: BillingView;
  stats: ItemStats;
}

export interface ProductInfo { name?: string; brand?: string; lotNumber?: string; expiryDate?: string; quantity?: string; unit?: string; notes?: string }
export interface DeviceInfo { name?: string; identifier?: string; settingsSummary?: string; notes?: string }

export interface TreatmentSession {
  _id: string;
  itemId: string;
  appointmentId: string;
  sessionNumber: number;
  recordType: RecordType;
  procedureCode: string;
  targetType: TargetType;
  regions: DermRegionRef[];
  generalArea?: RegionGroup;
  treatedRegions: DermRegionRef[];
  status: "in_progress" | "ended";
  autoClosed: boolean;
  procedureNotes?: string;
  observations?: string;
  outcome?: string;
  followUpInstructions?: string;
  followUpDueAt?: string;
  followUpResolvedAt?: string;
  product?: ProductInfo;
  device?: DeviceInfo;
  /** Procedure identity stored when the session started (absent on sessions created before Phase 3). */
  procedureSnapshot?: { catalogVersion: number; docSchemaVersion: number; metadata: string; labelEn: string; labelAr: string };
  performedBy: DermPerson | null;
  startedAt: string;
  endedAt?: string;
  itemStatus?: PlanStatus;
}

export interface VisitRef { startAt: string; source: string; status: string }
export interface PlanPhase { number: number; name?: string }
export interface PlanSummary { planned: number; inProgress: number; completed: number; cancelled: number; needsBilling: number; estimatedTotal: number; estimatedRemaining: number }
export interface TreatmentPlanResponse {
  plan: { phases: PlanPhase[] };
  items: TreatmentItem[];
  sessions: TreatmentSession[];
  visits: Record<string, VisitRef>;
  summary: PlanSummary;
}

export interface FollowUp {
  _id: string;
  patientId: string;
  recordType: RecordType;
  itemId: string | null;
  sessionId: string | null;
  assessmentId: string | null;
  appointmentId: string | null;
  regions: DermRegionRef[];
  outcome?: FollowUpOutcome;
  clinicianAssessment: string;
  progress: string;
  complications: string;
  notes: string;
  nextStep: string;
  status: "active" | "entered_in_error";
  rev: number;
  edited: boolean;
  createdBy: DermPerson | null;
  createdAt: string;
  updatedAt: string;
  resolution?: { at: string; by: DermPerson | null; reason: string; note?: string };
}

export interface TreatmentBrief { itemId: string; recordType: RecordType; procedureCode: string; targetType: TargetType; regions: DermRegionRef[]; generalArea?: RegionGroup; priority: Priority; phase: number }
export type TimelineEventName = "assessment" | "planned" | "started" | "completed" | "cancelled" | "session" | "follow_up";
export interface TimelineEvent {
  key: string;
  kind: "assessment" | "treatment" | "follow_up";
  event: TimelineEventName;
  at: string;
  appointmentId: string | null;
  assessment?: DermAssessment;
  treatment?: TreatmentBrief;
  by?: DermPerson | null;
  note?: string;
  session?: TreatmentSession;
  followUp?: FollowUp;
}
export interface TimelineResponse { events: TimelineEvent[]; visits: Record<string, VisitRef>; hasMore: boolean; nextBefore: string | null }
export type TimelineKind = "all" | "assessment" | "treatment" | "follow_up";
export interface TimelineFilters { kind?: TimelineKind; recordType?: RecordType; regionId?: string; includeVoided?: boolean }

export interface DermOverview {
  activeAssessments: number; planned: number; inProgress: number; completed: number; cancelled: number; needsBilling: number;
  upcomingFollowUpAt: string | null; lastActivityAt: string | null;
}

export interface DashItemBrief {
  _id: string; patientId: string; patientName: string | null; recordType: RecordType; procedureCode: string; targetType: TargetType;
  regionIds: string[]; generalArea?: RegionGroup; status: PlanStatus; priority: Priority; estimatedPrice: number | null; updatedAt: string;
}
export interface StatusCounts { planned: number; inProgress: number; completed: number; cancelled: number }
export interface DermDashboard {
  today: { total: number; scheduled: number; confirmed: number; completed: number; cancelled: number; noShow: number; walkIns: number };
  treatmentOverview: StatusCounts & { dermatology: StatusCounts; aesthetic: StatusCounts };
  activeTreatments: (DashItemBrief & { sessionCount: number })[];
  needsBilling: { count: number; capped: boolean; items: DashItemBrief[] };
  followUps: { overdue: number; dueSoon: number; items: { sessionId: string; itemId: string; patientId: string; patientName: string | null; dueAt: string; overdue: boolean; recordType: RecordType; procedureCode: string }[] };
  recentActivity: { at: string; kind: "assessment" | "treatment" | "session" | "follow_up"; patientId: string; patientName: string | null; recordType: RecordType; procedureCode?: string; status?: string; sessionNumber?: number }[];
}

// ---- inputs
export interface CreateTreatmentInput {
  clientRequestId: string;
  recordType: RecordType;
  procedureCode: string;
  targetType: TargetType;
  regions?: DermRegionRef[];
  generalArea?: RegionGroup | null;
  priority?: Priority;
  phase?: number;
  estimatedPrice?: number | null;
  notes?: string;
  sourceAssessmentId?: string | null;
}
export type UpdateTreatmentInput = Partial<Omit<CreateTreatmentInput, "clientRequestId" | "sourceAssessmentId">>;
export interface SessionFieldsInput {
  procedureNotes?: string; observations?: string; outcome?: string; followUpInstructions?: string;
  followUpDueAt?: string | null; treatedRegions?: DermRegionRef[]; product?: ProductInfo | null; device?: DeviceInfo | null;
}
export interface CreateFollowUpInput {
  clientRequestId: string; assessmentId?: string | null; itemId?: string | null; sessionId?: string | null; appointmentId?: string | null;
  regions?: DermRegionRef[]; outcome?: FollowUpOutcome | null;
  clinicianAssessment?: string; progress?: string; complications?: string; notes?: string; nextStep?: string;
}

// ---------------------------------------------------------------- Phase 3: printable reports
export interface DermReportData {
  generatedAt: string;
  clinic: { name: string; phone: string | null; address: string | null; logoUrl: string | null } | null;
  patient: { fullName: string; fileNumber: number; phone: string | null; gender: "male" | "female" | null; birthDate: string | null } | null;
  assessments: Omit<DermAssessment, "markers" | "markerSpace">[];
  followUps: FollowUp[];
  plan: { phases: PlanPhase[] };
  items: TreatmentItem[];
  sessions: TreatmentSession[];
  visits: Record<string, VisitRef>;
  /** ESTIMATES + counts only. Never Paid / Balance / Due. */
  summary: PlanSummary;
  /** null unless explicitly requested AND permitted. Read from the existing Invoice / Payment documents only. */
  financial: null | {
    invoices: { invoiceNumber: number; createdAt: string; total: number; paid: number; status: string }[];
    totalInvoiced: number; totalPaid: number; outstandingBalance: number;
  };
  limits: { assessments: number; followUps: number; invoices: number };
}
