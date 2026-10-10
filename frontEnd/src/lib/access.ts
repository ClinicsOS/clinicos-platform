"use client";
// PHASE 4 — role-aware UX helper. This is PRESENTATION ONLY: the backend (auth/policy.ts) is authoritative and re-checks every
// request. We read the access map from /auth/me (so the UI never has its own opinion that can drift from the server) and fall
// back to a static table, derived from the same matrix, until it loads. Never use this for security decisions.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";

export type AccessLevel = "clinic" | "self" | "none";
export type AccessResource =
  | "appointments" | "patients" | "patientClinical" | "clinicalWrite" | "invoices" | "payments"
  | "reports" | "reportsClinic" | "dashboardCounts" | "dashboardRevenue" | "expenses" | "expensesManage" | "staff" | "clinicSettings";
export type AccessMap = Partial<Record<AccessResource, AccessLevel>>;

const T = (owner: AccessLevel, doctor: AccessLevel, receptionist: AccessLevel) => ({ owner, doctor, receptionist });
const FALLBACK: Record<AccessResource, Record<string, AccessLevel>> = {
  appointments: T("clinic", "self", "clinic"),
  patients: T("clinic", "clinic", "clinic"),
  patientClinical: T("clinic", "clinic", "clinic"),
  clinicalWrite: T("clinic", "clinic", "none"),
  invoices: T("clinic", "self", "clinic"),
  payments: T("clinic", "self", "clinic"),
  reports: T("clinic", "self", "none"),
  reportsClinic: T("clinic", "none", "none"),
  dashboardCounts: T("clinic", "self", "clinic"),
  dashboardRevenue: T("clinic", "self", "none"),
  // PHASE 5: a doctor READS the expenses attributed to them ("self"); only the owner manages (create / edit / delete / bills).
  expenses: T("clinic", "self", "none"),
  expensesManage: T("clinic", "none", "none"),
  staff: T("clinic", "none", "none"),
  clinicSettings: T("clinic", "none", "none"),
};

export function useAccess() {
  const role = useAuth((s) => s.user?.role) || "";
  const token = useAuth((s) => s.token);
  const q = useQuery({
    queryKey: ["auth-me-access"],
    queryFn: async () => (await api.get("/auth/me")).data as { access?: AccessMap },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
  const server = q.data?.access;
  const level = (r: AccessResource): AccessLevel => {
    if (server && server[r]) return server[r] as AccessLevel;
    return FALLBACK[r]?.[role] ?? "none";
  };
  return {
    role,
    isOwner: role === "owner",
    isDoctor: role === "doctor",
    isReceptionist: role === "receptionist",
    level,
    can: (r: AccessResource) => level(r) !== "none",
    loaded: !!server,
  };
}

/** Active doctors of the signed-in user's clinic (same query key + endpoint the appointments page already uses). */
export function useClinicDoctors(enabled = true) {
  const token = useAuth((s) => s.token);
  const q = useQuery({
    queryKey: ["staff"],
    queryFn: async () => (await api.get<import("@/lib/types").Staff[]>("/users")).data,
    enabled: enabled && !!token,
  });
  return { ...q, doctors: (q.data ?? []).filter((s) => s.role === "doctor" && s.isActive) };
}
