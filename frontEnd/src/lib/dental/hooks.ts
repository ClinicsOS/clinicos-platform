import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DentalEvent, DentalRecordResponse, DentalRecordInfo } from "./types";
import type { DentitionType } from "./fdi";
import type { EventCategory, SurfaceId } from "./taxonomy";

/** All Dental data flows through these hooks -> authenticated /api/dental endpoints only. */
export const dentalKey = (patientId: string) => ["dental-record", patientId] as const;

export function useDentalRecord(patientId: string, enabled = true) {
  return useQuery({
    queryKey: dentalKey(patientId),
    queryFn: async () => (await api.get<DentalRecordResponse>(`/dental/patients/${patientId}/record`)).data,
    enabled,
    retry: (count, err: any) => (err?.response?.status === 403 || err?.response?.status === 404 ? false : count < 1),
  });
}

export interface AddEventInput { fdi: string; category: EventCategory; code: string; surfaces: SurfaceId[]; note?: string }

export function useAddDentalEvent(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: AddEventInput) => {
      const path = i.category === "diagnosis" ? "diagnoses" : "conditions";
      const body: { code: string; surfaces?: SurfaceId[]; note?: string } = { code: i.code };
      if (i.surfaces.length) body.surfaces = i.surfaces;
      if (i.note?.trim()) body.note = i.note.trim();
      return (await api.post<{ event: DentalEvent }>(`/dental/patients/${patientId}/teeth/${i.fdi}/${path}`, body)).data.event;
    },
    // Chart + panel + history update immediately, no refresh (server row is the source of truth).
    onSuccess: (event) => {
      qc.setQueryData<DentalRecordResponse>(dentalKey(patientId), (old) =>
        old ? { ...old, record: { ...old.record, exists: true }, events: [event, ...old.events] } : old
      );
    },
  });
}

export function useResolveDentalEvent(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { eventId: string; reason: "resolved" | "entered_in_error"; note?: string }) =>
      (await api.post<{ event: DentalEvent }>(`/dental/patients/${patientId}/events/${i.eventId}/resolve`, { reason: i.reason, note: i.note })).data.event,
    onSuccess: (event) => {
      qc.setQueryData<DentalRecordResponse>(dentalKey(patientId), (old) =>
        old ? { ...old, events: old.events.map((e) => (e._id === event._id ? event : e)) } : old
      );
    },
  });
}

export function useSetDentition(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dentitionType: DentitionType) =>
      (await api.put<{ record: DentalRecordInfo }>(`/dental/patients/${patientId}/dentition`, { dentitionType })).data.record,
    onSuccess: (record) => {
      qc.setQueryData<DentalRecordResponse>(dentalKey(patientId), (old) => (old ? { ...old, record } : old));
    },
  });
}

/** Mixed dentition: choose which teeth the chart currently shows. Never touches clinical history. */
export function useSetCurrentTeeth(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teeth: string[]) =>
      (await api.put<{ record: DentalRecordInfo }>(`/dental/patients/${patientId}/current-teeth`, { teeth })).data.record,
    onSuccess: (record) => {
      qc.setQueryData<DentalRecordResponse>(dentalKey(patientId), (old) => (old ? { ...old, record } : old));
    },
  });
}

// ---------- Phase 3: treatment plan ----------
import type { TreatmentItem, TreatmentPlanResponse, TreatmentSession, VisitTreatmentsResponse, PlanStatus, Priority, TargetType, TimelineEntry } from "./types";

export const treatmentKey = (patientId: string) => ["dental-treatment", patientId] as const;
export const visitTreatmentsKey = (patientId: string, appointmentId: string) => ["dental-visit-treatments", patientId, appointmentId] as const;

const retryPolicy = (count: number, err: unknown) => {
  const st = (err as { response?: { status?: number } })?.response?.status;
  return st === 403 || st === 404 ? false : count < 1; // a forbidden / missing patient will not fix itself
};

export function useTreatmentPlan(patientId: string, enabled = true) {
  return useQuery({
    queryKey: treatmentKey(patientId),
    enabled,
    retry: retryPolicy,
    queryFn: async () => (await api.get<TreatmentPlanResponse>(`/dental/patients/${patientId}/treatment-plan`)).data,
  });
}

export function useVisitTreatments(patientId: string, appointmentId: string, enabled = true) {
  return useQuery({
    queryKey: visitTreatmentsKey(patientId, appointmentId),
    enabled,
    retry: retryPolicy,
    queryFn: async () => (await api.get<VisitTreatmentsResponse>(`/dental/patients/${patientId}/visits/${appointmentId}/treatments`)).data,
  });
}

/**
 * Every treatment mutation refetches the plan + the visit sections from the SERVER on success (no optimistic
 * pretending): the UI only ever shows what the backend actually persisted.
 */
function useTreatmentMutation<V, R>(patientId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: treatmentKey(patientId) });
      qc.invalidateQueries({ queryKey: ["dental-visit-treatments", patientId] });
    },
  });
}
const base = (patientId: string) => `/dental/patients/${patientId}/treatment-plan`;

export interface TreatmentInput {
  procedureCode: string; customName?: string; targetType: string; toothNumbers?: string[]; surfaces?: string[];
  priority?: string; phase?: number; estimatedPrice?: number | null; notes?: string; sourceDiagnosisIds?: string[];
}
export const useCreateTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (body: TreatmentInput) => (await api.post<{ item: TreatmentItem }>(`${base(pid)}/items`, body)).data.item);
export const useUpdateTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; body: Partial<TreatmentInput> }) => (await api.put<{ item: TreatmentItem }>(`${base(pid)}/items/${v.id}`, v.body)).data.item);
export const useCancelTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; reason?: string }) => (await api.post<{ item: TreatmentItem }>(`${base(pid)}/items/${v.id}/cancel`, { reason: v.reason })).data.item);
export const useStartTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; appointmentId: string }) => (await api.post<{ item: TreatmentItem; session: TreatmentSession }>(`${base(pid)}/items/${v.id}/start`, { appointmentId: v.appointmentId })).data);
export const useFinishSession = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; appointmentId: string; notes?: string }) => (await api.post<{ session: TreatmentSession }>(`${base(pid)}/items/${v.id}/finish-session`, { appointmentId: v.appointmentId, notes: v.notes })).data);
export const useCompleteTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; appointmentId: string; notes?: string }) => (await api.post<{ item: TreatmentItem; session: TreatmentSession | null }>(`${base(pid)}/items/${v.id}/complete`, { appointmentId: v.appointmentId, notes: v.notes })).data);
export const useSessionNotes = (pid: string) =>
  useTreatmentMutation(pid, async (v: { sessionId: string; notes: string }) => (await api.put<{ session: TreatmentSession }>(`/dental/patients/${pid}/treatment-sessions/${v.sessionId}/notes`, { notes: v.notes })).data.session);
export const useSetPhases = (pid: string) =>
  useTreatmentMutation(pid, async (phases: { number: number; name?: string }[]) => (await api.put(`${base(pid)}/phases`, { phases })).data);

/**
 * The ONE "Add to Invoice" mutation (Treatment Plan, tooth panel and visit all use it). The UI only shows "Invoiced"
 * after the server confirms; it then refetches the plan, the visit sections AND every invoice query.
 */
export function useBillTreatment(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; price: number; description: string; invoiceId?: string }) =>
      (await api.post<{ item: TreatmentItem; invoice: { _id: string; invoiceNumber: number; status: string; total: number }; alreadyInvoiced: boolean }>(
        `/dental/patients/${patientId}/treatment-plan/items/${v.id}/invoice`,
        { price: v.price, description: v.description, ...(v.invoiceId ? { invoiceId: v.invoiceId } : {}) }
      )).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: treatmentKey(patientId) });
      qc.invalidateQueries({ queryKey: ["dental-visit-treatments", patientId] });
      qc.invalidateQueries({ queryKey: ["invoices"] }); // Invoices page + the patient's financial history (existing screens)
    },
  });
}

// ---------- Final V1 polish: Dental Dashboard ----------
export interface DentalDashboardResponse {
  date: string;
  today: {
    counts: { total: number; scheduled: number; confirmed: number; completed: number; cancelled: number; noShow: number; walkIns: number };
    appointments: {
      _id: string; startAt: string; status: string; source: string; patientId: string | null; patientName: string | null; doctorName: string | null;
      treatment: { status: PlanStatus; procedureCode: string; customName?: string; targetType: TargetType; toothNumbers: string[] } | null;
    }[];
  };
  treatmentOverview: { planned: number; inProgress: number; completed: number; cancelled: number };
  activeTreatments: { _id: string; patientId: string; patientName: string | null; procedureCode: string; customName?: string; targetType: TargetType; toothNumbers: string[]; surfaces: SurfaceId[]; status: PlanStatus; priority: Priority; phase: number; sessionCount: number; updatedAt: string }[];
  needsBilling: { _id: string; patientId: string; patientName: string | null; procedureCode: string; customName?: string; targetType: TargetType; toothNumbers: string[]; surfaces: SurfaceId[]; estimatedPrice: number | null }[];
  recentActivity: { at: string; kind: string; patientId: string; patientName: string | null; procedureCode?: string; customName?: string; targetType?: TargetType; toothNumbers?: string[]; invoiceNumber?: number; amount?: number }[];
}

/** One summary read for the Dentistry operational dashboard (dentistry clinics only — the route itself is specialty-gated). */
export function useDentalDashboard(enabled = true) {
  return useQuery({
    queryKey: ["dental-dashboard"],
    queryFn: async () => (await api.get<DentalDashboardResponse>("/dental/dashboard")).data,
    enabled,
    refetchInterval: 60_000, // same cadence as the Core dashboard stats
  });
}

// ---------- Final V1 patch: Dental Patient File / print reports ----------
export interface DentalReportResponse {
  generatedAt: string;
  clinic: { name: string; phone: string | null; address: string | null; logoUrl: string | null } | null;
  patient: { fullName: string; fileNumber: number; phone: string; gender: string | null; birthDate: string | null } | null;
  record: { exists: boolean; dentitionType: DentitionType; currentTeeth: string[] | null };
  events: DentalEvent[];
  planItems: TreatmentItem[];
  sessions: TreatmentSession[];
  timeline: TimelineEntry[];
  summary: TreatmentPlanResponse["summary"];
  financial: { totalInvoiced: number; totalPaid: number; outstandingBalance: number } | null;
}

/** One server-authorized read for every printable Dental document — the frontend only lays it out for print;
 *  it never assembles a report from data already sitting in the page. */
export function useDentalReport(patientId: string, financial: boolean, enabled = true) {
  return useQuery({
    queryKey: ["dental-report", patientId, financial],
    queryFn: async () => (await api.get<DentalReportResponse>(`/dental/patients/${patientId}/report${financial ? "?financial=1" : ""}`)).data,
    enabled: enabled && !!patientId,
    retry: false,
  });
}
