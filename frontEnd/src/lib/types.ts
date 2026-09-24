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
}

export interface Staff { _id: string; name: string; email: string; role: string; phone?: string; isActive: boolean; }

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
  readBy?: string[];
}

export interface InvoiceItem { description: string; price: number; qty: number; }
export interface Payment { amount: number; method: string; paidAt: string; }
export interface Invoice {
  _id: string; invoiceNumber: number; patientId: Patient;
  items: InvoiceItem[]; discount: number; total: number;
  payments: Payment[]; status: string; createdAt: string;
}

export interface Stats {
  today: { total: number; completed: number; cancelled: number; noShow: number; revenue: number };
  week: { date: string; count: number }[];
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
