import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";
import type {
  CreateFollowUpInput, CreateTreatmentInput, DermDashboard, DermOverview, FollowUp, SessionFieldsInput, TimelineFilters, TimelineResponse,
  TreatmentItem, TreatmentPlanResponse, TreatmentSession, UpdateTreatmentInput, BillingView, DermReportData,
} from "./treatmentTypes";
import type { DermAssessment } from "./types";

/** Phase 2 data flows through these hooks -> authenticated /api/derm endpoints only (server enforces specialty + role). */
export const planKey = (pid: string) => ["derm-plan", pid] as const;
export const timelineRoot = (pid: string) => ["derm-timeline", pid] as const;
export const overviewKey = (pid: string) => ["derm-overview", pid] as const;
export const followUpsRoot = (pid: string) => ["derm-followups", pid] as const;
export const dashboardKey = ["derm-dashboard"] as const;

const noRetryOnAuth = (count: number, err: unknown) => {
  const s = axios.isAxiosError(err) ? err.response?.status : undefined;
  return s === 403 || s === 404 ? false : count < 1;
};
const base = (pid: string) => `/derm/patients/${pid}`;

export function useTreatmentPlan(patientId: string, enabled = true) {
  return useQuery({
    queryKey: planKey(patientId),
    queryFn: async () => (await api.get<TreatmentPlanResponse>(`${base(patientId)}/treatment-plan`)).data,
    enabled: enabled && !!patientId,
    retry: noRetryOnAuth,
  });
}

export function useDermOverview(patientId: string, enabled = true) {
  return useQuery({
    queryKey: overviewKey(patientId),
    queryFn: async () => (await api.get<DermOverview>(`${base(patientId)}/overview`)).data,
    enabled: enabled && !!patientId,
    retry: noRetryOnAuth,
  });
}

export function useDermDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: async () => (await api.get<DermDashboard>("/derm/dashboard")).data,
    refetchInterval: 60_000,
    retry: noRetryOnAuth,
  });
}

export function useDermTimeline(patientId: string, filters: TimelineFilters = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...timelineRoot(patientId), filters.kind ?? "all", filters.recordType ?? "", filters.regionId ?? "", filters.includeVoided ? "1" : "0"] as const,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit: 30 };
      if (filters.kind && filters.kind !== "all") params.kind = filters.kind;
      if (filters.recordType) params.recordType = filters.recordType;
      if (filters.regionId) params.regionId = filters.regionId;
      if (filters.includeVoided) params.includeVoided = "1";
      if (pageParam) params.before = pageParam;
      return (await api.get<TimelineResponse>(`${base(patientId)}/timeline`, { params })).data;
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextBefore : undefined),
    enabled: enabled && !!patientId,
    retry: noRetryOnAuth,
  });
}

export function useFollowUps(patientId: string, q: { itemId?: string; assessmentId?: string } = {}, enabled = true) {
  return useQuery({
    queryKey: [...followUpsRoot(patientId), q.itemId ?? "", q.assessmentId ?? ""] as const,
    queryFn: async () => (await api.get<{ followUps: FollowUp[] }>(`${base(patientId)}/follow-ups`, { params: { ...q, limit: 50 } })).data.followUps,
    enabled: enabled && !!patientId,
    retry: noRetryOnAuth,
  });
}

/** After ANY Phase 2 write, everything derived from it is refetched from the server (never patched locally). */
function useRefreshPlan(patientId: string) {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: planKey(patientId) }),
    qc.invalidateQueries({ queryKey: timelineRoot(patientId) }),
    qc.invalidateQueries({ queryKey: overviewKey(patientId) }),
    qc.invalidateQueries({ queryKey: followUpsRoot(patientId) }),
    qc.invalidateQueries({ queryKey: dashboardKey }),
  ]);
}

const items = (pid: string) => `${base(pid)}/treatment-plan/items`;

export function useCreateTreatment(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async (input: CreateTreatmentInput) => (await api.post<{ item: TreatmentItem; duplicate: boolean }>(items(patientId), input)).data,
    onSuccess: () => { void refresh(); },
  });
}
export function useUpdateTreatment(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async ({ itemId, ...body }: UpdateTreatmentInput & { itemId: string }) => (await api.put<{ item: TreatmentItem }>(`${items(patientId)}/${itemId}`, body)).data.item,
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); }, // ITEM_CHANGED / ITEM_LOCKED: show what the server has now
  });
}
export function useCancelTreatment(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async (i: { itemId: string; reason?: string }) => (await api.post<{ item: TreatmentItem }>(`${items(patientId)}/${i.itemId}/cancel`, { reason: i.reason ?? "" })).data.item,
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
}
export function useStartTreatment(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async (i: { itemId: string; appointmentId: string }) =>
      (await api.post<{ item: TreatmentItem; session: TreatmentSession; alreadyStarted: boolean }>(`${items(patientId)}/${i.itemId}/start`, { appointmentId: i.appointmentId })).data,
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
}
export function useSaveSession(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async ({ sessionId, ...body }: SessionFieldsInput & { sessionId: string }) => (await api.put<{ session: TreatmentSession }>(`${base(patientId)}/treatment-sessions/${sessionId}`, body)).data.session,
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
}
/** END THIS SESSION — the treatment stays IN_PROGRESS. */
export function useEndSession(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async ({ itemId, ...body }: SessionFieldsInput & { itemId: string; appointmentId: string }) =>
      (await api.post<{ item: TreatmentItem; session: TreatmentSession; alreadyEnded: boolean }>(`${items(patientId)}/${itemId}/end-session`, body)).data,
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
}
/** COMPLETE TREATMENT — the whole plan item is finished. */
export function useCompleteTreatment(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async ({ itemId, ...body }: SessionFieldsInput & { itemId: string; appointmentId: string }) =>
      (await api.post<{ item: TreatmentItem; session: TreatmentSession | null; alreadyCompleted: boolean }>(`${items(patientId)}/${itemId}/complete`, body)).data,
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
}
export function useSetPhases(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async (phases: { number: number; name?: string }[]) => (await api.put(`${base(patientId)}/treatment-plan/phases`, { phases })).data,
    onSuccess: () => { void refresh(); },
  });
}

export function useCreateFollowUp(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async (input: CreateFollowUpInput) => (await api.post<{ followUp: FollowUp; duplicate: boolean }>(`${base(patientId)}/follow-ups`, input)).data,
    onSuccess: () => { void refresh(); },
  });
}
export function useEditFollowUp(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async ({ followUpId, ...body }: { followUpId: string; rev: number } & Partial<Pick<FollowUp, "clinicianAssessment" | "progress" | "complications" | "notes" | "nextStep">> & { outcome?: FollowUp["outcome"] | null }) =>
      (await api.patch<{ followUp: FollowUp }>(`${base(patientId)}/follow-ups/${followUpId}`, body)).data.followUp,
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
}
export function useVoidFollowUp(patientId: string) {
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async (i: { followUpId: string; note?: string }) => (await api.post<{ followUp: FollowUp }>(`${base(patientId)}/follow-ups/${i.followUpId}/void`, { note: i.note ?? "" })).data.followUp,
    onSuccess: () => { void refresh(); },
  });
}

/** "Add to Invoice" — the EXISTING Invoice module stays the only financial authority; only a link is stored on the treatment. */
export function useBillDermTreatment(patientId: string) {
  const qc = useQueryClient();
  const refresh = useRefreshPlan(patientId);
  return useMutation({
    mutationFn: async (i: { itemId: string; price: number; description: string; invoiceId?: string }) => {
      const { itemId, ...body } = i;
      return (await api.post<{ item: TreatmentItem; invoice: { _id: string; invoiceNumber: number; status: string; total: number }; alreadyInvoiced: boolean }>(`${items(patientId)}/${itemId}/invoice`, body)).data;
    },
    onSuccess: () => {
      void refresh();
      // the invoice / patient-balance screens of Core read these keys
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: () => { void refresh(); },
  });
}

export type { BillingView, DermAssessment };

/** Printable-report payload: ONE server-authorized read (the financial block is opt-in and permission-gated server-side). */
export const reportKey = (pid: string, financial: boolean) => ["derm-report", pid, financial] as const;
export function useDermReport(patientId: string, financial: boolean, enabled = true) {
  return useQuery({
    queryKey: reportKey(patientId, financial),
    queryFn: async () => (await api.get<DermReportData>(`${base(patientId)}/report`, { params: financial ? { financial: 1 } : {} })).data,
    enabled: enabled && !!patientId,
    retry: noRetryOnAuth,
    staleTime: 0,
    gcTime: 0,
  });
}
