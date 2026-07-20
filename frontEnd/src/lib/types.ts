export interface WorkingHour { day: number; isOpen: boolean; from: string; to: string; }

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
}

export interface Staff { _id: string; name: string; email: string; role: string; phone?: string; isActive: boolean; }

export interface Patient {
  _id: string; fileNumber: number; fullName: string; phone: string; email?: string;
  gender?: string; birthDate?: string; medicalNotes?: string; createdAt: string;
}

export interface Appointment {
  _id: string;
  patientId: Patient | string;
  doctorId: { _id: string; name: string } | string;
  startAt: string; duration: number; status: string; source: string;
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
