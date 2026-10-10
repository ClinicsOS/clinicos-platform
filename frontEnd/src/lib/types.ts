export interface WorkingHour {
  day: number;
  isOpen: boolean;
  from: string;
  to: string;
  breakFrom?: string;
  breakTo?: string;
}

export type Plan = "trial" | "basic" | "pro";
export interface PlanLimits {
  maxDoctors: number;
  maxReceptionists: number;
  maxAppointments: number;
  maxInvoicesPerMonth: number;
  invoicing: boolean;
  reports: boolean;
  exports: boolean;
  whiteLabel: boolean;
  customBookingColor: boolean;
  aiAssistant: boolean;
  supportSlaHours: number;
  trialDays: number;
}

export interface Clinic {
  _id: string; name: string; slug: string; specialty: string;
  phone?: string; address?: string; logoUrl?: string; brandColor?: string;
  workingHours: WorkingHour[]; slotDuration: number;
  plan?: Plan;
  planStartedAt?: string;
  planExpiresAt?: string;
  status?: "active" | "suspended" | "expired";
  planInfo?: {
    plan: Plan;
    price: number;
    limits: PlanLimits;
    daysRemaining: number | null;
  };
}

// ===== Paid add-ons (separate from plans — see backEnd/src/config/addons.ts) =====
export type AddonId = "loyalty";
export type AddonStatus = "inactive" | "active" | "suspended" | "cancelled";

/**
 * What a CLINIC USER may see about an add-on (GET /api/subscription → addons).
 * Read-only: clinic users can never change entitlement — only the Platform Admin can.
 * `enabled` is the EFFECTIVE entitlement (already accounts for account suspension / expiry /
 * the add-on's billing period) — gate UI on it, but remember the server is the real boundary.
 */
export interface ClinicAddonEntitlement {
  enabled: boolean;
  status: AddonStatus;
  monthlyPrice: number;
  currentPeriodEnd: string | null;
  periodExpired: boolean;
}
export type ClinicAddons = Record<AddonId, ClinicAddonEntitlement>;

export type AddonDenyReason =
  | "not_subscribed"
  | "suspended"
  | "cancelled"
  | "period_ended"
  | "account_suspended"
  | "account_expired";

/** Full subscription record as seen by the PLATFORM ADMIN (GET /api/admin/clinics/:id/addons). */
export interface AddonSubscription {
  id: AddonId;
  name: string;
  status: AddonStatus;
  entitled: boolean;
  reason: AddonDenyReason | null;
  hasRecord: boolean;
  enabled: boolean;
  setupFee: number | null;
  monthlyPrice: number | null;
  activatedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;
  periodExpired: boolean;
  accountEligible: boolean;
  daysUntilPeriodEnd: number | null;
}

/** Product-level defaults (list price etc.) — the clinic's own record stores the agreed numbers. */
export interface AddonDefinition {
  id: AddonId;
  name: string;
  currency: "JOD";
  defaultMonthlyPrice: number;
  setupFeeGuidance: { min: number; max: number } | null;
  defaultPeriodDays: number;
}

export interface AdminAddonsResponse {
  addons: Record<AddonId, AddonSubscription>;
  defaults: Record<AddonId, AddonDefinition>;
  clinicPlan: { plan: Plan; monthlyPrice: number };
}

export interface Subscription {
  plan: Plan;
  price: number;
  status: "active" | "suspended" | "expired";
  planStartedAt: string;
  planExpiresAt: string;
  daysRemaining: number | null;
  limits: PlanLimits;
  pendingRequest: { id: string; plan: Plan; createdAt: string } | null;
  plans: Record<Plan, { price: number; limits: PlanLimits }>;
  cliqInfo: { alias: string; bank: string };
  /** Optional so older cached responses / older API versions still type-check. */
  addons?: ClinicAddons;
}

// PHASE 4 — email/phone are only returned to the owner; workingHours is the doctor's OPTIONAL own schedule (absent = follows clinic).
export interface DoctorHoursDay { day: number; isOpen: boolean; from: string; to: string; breakFrom?: string; breakTo?: string; }
export interface Staff { _id: string; name: string; email?: string; role: string; phone?: string; isActive: boolean; workingHours?: DoctorHoursDay[]; }

export interface MedicalFlag { has: boolean; details?: string; }

export interface Patient {
  _id: string; fileNumber: number; fullName: string; phone: string; email?: string;
  gender?: string; birthDate?: string; medicalNotes?: string; createdAt: string;
  updatedAt?: string;
  whatsappOptIn?: boolean;
  // ===== NEW — extended patient file =====
  nationalId?: string;
  address?: string;
  occupation?: string;
  maritalStatus?: "single" | "married" | "divorced" | "widowed";
  bloodType?: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";
  referralSource?: "social_media" | "friend_family" | "google" | "doctor_referral" | "walk_in" | "other";
  emergencyContact?: { name?: string; relation?: string; phone?: string };
  insurance?: { provider?: string; policyNumber?: string };
  medicalHistory?: Partial<Record<string, MedicalFlag>>;
  medicalUpdatedAt?: string;
}

export interface Appointment {
  _id: string;
  patientId?: Patient | string;
  doctorId: { _id: string; name: string } | string;
  startAt: string; duration: number; status: string; source: string;
  type?: "appointment" | "blocked";
  blockNote?: string;
  visitType?: "consultation" | "procedure";
  procedureNote?: string;
  visitNote?: string; cancelReason?: string; refCode?: string;
  createdBy?: string; // walk-ins: the staff user who registered the visit
  readBy?: string[];
}

export interface InvoiceItem { _id?: string; description: string; price: number; qty: number; sourceType?: string; sourceId?: string; }
export interface Payment { amount: number; method: string; paidAt: string; note?: string; }
export interface Invoice {
  _id: string; invoiceNumber: number; patientId: Patient;
  items: InvoiceItem[]; discount: number; total: number;
  payments: Payment[]; status: string; createdAt: string;
  // PHASE 4 — treating doctor (optional: legacy invoices have none = "unassigned"). Populated {_id,name} by GET /invoices.
  doctorId?: { _id: string; name: string } | string | null;
}

export interface Stats {
  today: { total: number; completed: number; cancelled: number; noShow: number; revenue: number | null };
  week: { date: string; count: number }[];
  // PHASE 4 — what the server actually scoped this response to.
  scope?: { level: "clinic" | "self"; doctorId: string | null; showsRevenue: boolean };
}

export const paidOf = (inv: Invoice) => inv.payments.reduce((s, p) => s + p.amount, 0);

// ===== NEW — clinic & owner expenses =====
export type ExpenseScope = "clinic" | "personal";
export type BillStatus = "paid" | "overdue" | "due_soon" | "upcoming";

export interface BillRow {
  _id: string;
  title: string;
  category: string;
  scope: ExpenseScope;
  amount: number;
  dueDay: number;
  remindDaysBefore: number;
  startPeriod: string;
  isActive: boolean;
  notes?: string;
  period: string;
  doctorId?: string | null; // PHASE 5 — financial owner (a clinic doctor); null/absent = shared clinic expense
  doctorName?: string | null;
  vendor?: string;
  dueDate: string; // YYYY-MM-DD
  daysUntil: number;
  status: BillStatus;
  payment: { _id: string; amount: number; date: string; method?: string } | null;
}

export interface ExpenseEntry {
  _id: string;
  title: string;
  category: string;
  scope: ExpenseScope;
  amount: number;
  status: "paid" | "pending";
  date: string; // YYYY-MM-DD
  period: string;
  method?: string;
  remindDaysBefore?: number;
  recurringId?: string;
  notes?: string;
  doctorId?: string | null; // PHASE 5
  doctorName?: string | null;
  vendor?: string;
  reference?: string;
}

/** PHASE 5 — a row of GET /expenses/ledger. */
export type ExpenseKind = "clinic" | "doctor" | "personal";
export interface LedgerRow {
  _id: string;
  title: string;
  category: string;
  scope: ExpenseScope;
  kind: ExpenseKind;
  amount: number;
  status: "paid" | "pending";
  date: string; // YYYY-MM-DD (the financial date)
  period: string;
  method?: string;
  vendor?: string;
  reference?: string;
  notes?: string;
  recurringId?: string;
  doctor: { _id: string; name: string } | null;
  createdBy: { _id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface LedgerPage {
  items: LedgerRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  scope?: { level: "clinic" | "self"; doctorId: string | null };
}
export interface ExpenseSummary {
  currency: string;
  count: number;
  totals: { business: number; clinic: number; doctor: number; personal: number };
  pending: number;
  byCategory: { category: string; total: number; clinic: number; doctor: number; personal: number }[];
  byDoctor: { doctorId: string; name: string; total: number }[];
  scope?: { level: "clinic" | "self"; doctorId: string | null };
}

export interface ExpenseOverview {
  period: string;
  today: string;
  currentPeriod: string;
  bills: BillRow[];
  notStarted: BillRow[];
  carryOver: BillRow[];
  entries: ExpenseEntry[];
  overduePending: ExpenseEntry[];
  totals: { clinic: number; personal: number; total: number; pending: number; expected: number };
  byCategory: { category: string; clinic: number; personal: number; total: number }[];
}
