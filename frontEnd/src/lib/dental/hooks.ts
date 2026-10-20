import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DentalEvent, DentalRecordResponse, DentalRecordInfo } from "./types";
import { diffPlanItems, newRequestId, patchItem, upsertItem } from "./planCache";
import { useChangeFeedbackStore } from "./changeFeedback";
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
      void qc.invalidateQueries({ queryKey: ["dental-report", patientId] }); // the printable report lists the events too
      void qc.invalidateQueries({ queryKey: ["clinical-timeline", patientId] }); // unified History shows the new note
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
      void qc.invalidateQueries({ queryKey: ["dental-report", patientId] });
      void qc.invalidateQueries({ queryKey: ["clinical-timeline", patientId] });
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
 * THE one place that brings every screen showing treatment state up to date after a treatment changed.
 *
 *   ["dental-treatment", patientId]            -> Treatment Plan tab, Dental Chart (3D / 2D markers + tooth panel), Overview card
 *   ["dental-visit-treatments", patientId]     -> the Dental section inside the visit (appointment) modal
 *   ["dental-report", patientId]               -> the printable Dental Patient File (marked stale; refetched when opened)
 *   ["dental-dashboard"]                       -> the clinic's Dentistry dashboard counters (marked stale)
 *
 * The returned promise resolves when the plan + visit queries that are ON SCREEN have been re-read from the server, so a
 * mutation only reports "done" once every visible view already shows the persisted state (no reload, no stale flash).
 * Only the keys above are touched — never a blanket invalidate — and every key carries the patient id, so another
 * patient's cache is never involved. A concurrent refetch is cancelled and replaced (React Query default), so an older
 * response can never overwrite a newer one.
 */
export function syncTreatmentCaches(qc: QueryClient, patientId: string): Promise<unknown> {
  void qc.invalidateQueries({ queryKey: ["dental-report", patientId] });
  void qc.invalidateQueries({ queryKey: ["dental-dashboard"] });
  void qc.invalidateQueries({ queryKey: ["clinical-timeline", patientId] }); // Patient File -> Clinical Record lists the same milestones
  return Promise.all([
    qc.invalidateQueries({ queryKey: treatmentKey(patientId) }),
    qc.invalidateQueries({ queryKey: ["dental-visit-treatments", patientId] }),
  ]);
}

/**
 * Every treatment mutation goes through here. PHASE 4 — ONE canonical cache, patched in place:
 *   1. (optional, edit / cancel only) `optimistic` patches the SAME record in the cache immediately; the previous version of THAT record is kept;
 *   2. when the server answers, the confirmed record replaces it by id (never appended twice — no temporary ids exist) so Treatment Plan, 2D chart,
 *      3D chart, tooth panel and Overview all render the persisted state in the same pass;
 *   3. on failure the one record is put back exactly as it was and the cache is re-read — nothing is presented as saved;
 *   4. the dependent views (summary, history timeline, visit sections, report, dashboard) are then re-read in the background.
 * Only this patient's keys are touched.
 */
interface TreatmentMutationOpts<V, R> {
  optimistic?: (v: V) => { id: string; patch: Partial<TreatmentItem> };
  itemOf?: (r: R) => TreatmentItem | undefined;
}
function useTreatmentMutation<V, R>(patientId: string, fn: (v: V) => Promise<R>, opts: TreatmentMutationOpts<V, R> = {}) {
  const qc = useQueryClient();
  const key = treatmentKey(patientId);
  return useMutation<R, Error, V, { prevItem?: TreatmentItem }>({
    mutationFn: fn,
    onMutate: async (v) => {
      if (!opts.optimistic) return {};
      const { id, patch } = opts.optimistic(v);
      await qc.cancelQueries({ queryKey: key }); // an in-flight (older) read must not overwrite the local change
      const prevItem = qc.getQueryData<TreatmentPlanResponse>(key)?.items.find((i) => i._id === id);
      if (prevItem) qc.setQueryData<TreatmentPlanResponse>(key, (old) => patchItem(old, id, patch));
      return { prevItem };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevItem) qc.setQueryData<TreatmentPlanResponse>(key, (old) => patchItem(old, ctx.prevItem!._id, ctx.prevItem!)); // roll back that ONE record
      void qc.invalidateQueries({ queryKey: key }); // …and reconcile with the server
    },
    onSuccess: (r) => {
      const item = opts.itemOf?.(r);
      if (!item) return syncTreatmentCaches(qc, patientId); // no record in the answer (phases, session notes…): wait for the re-read
      const prev = qc.getQueryData<TreatmentPlanResponse>(key);
      const next = upsertItem(prev, item);
      const change = diffPlanItems(prev?.items, next?.items ?? []);
      const wasThere = !!prev?.items.some((i) => i._id === item._id);
      // PUBLISH FIRST, then patch: the new card / glowing tooth mount in the same pass as the data, so the feedback is never missed.
      // Feedback is for what the doctor just did even when an optimistic patch already showed it: always glow this record's teeth.
      useChangeFeedbackStore.getState().publish({
        patientId,
        addedIds: wasThere ? [] : [item._id],
        changedIds: wasThere ? [item._id] : [],
        teeth: change.teeth.length ? change.teeth : item.toothNumbers,
      });
      if (next) qc.setQueryData<TreatmentPlanResponse>(key, next);
      void syncTreatmentCaches(qc, patientId); // summary / timeline / visit sections follow in the background
    },
  });
}
const base = (patientId: string) => `/dental/patients/${patientId}/treatment-plan`;

export interface TreatmentInput {
  procedureCode: string; customName?: string; targetType: string; toothNumbers?: string[]; surfaces?: string[];
  /** PHASE 5 — different surfaces per tooth (multi-tooth, surface-capable procedures). `null` on an edit clears them. */
  toothSurfaces?: Record<string, string[]> | null;
  priority?: string; phase?: number; estimatedPrice?: number | null; notes?: string; sourceDiagnosisIds?: string[];
  /** PHASE 4 idempotency key: one per Save intent. A double click / retry with the same key returns the SAME record. */
  requestId?: string;
}
export { newRequestId };
/** Create: server-confirmed (the id is the database id — no temporary frontend ids). The request id makes a double click harmless. */
export const useCreateTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (body: TreatmentInput) => (await api.post<{ item: TreatmentItem }>(`${base(pid)}/items`, { ...body, requestId: body.requestId ?? newRequestId() })).data.item, { itemOf: (i) => i });
/** Edit: the same record is patched immediately (e.g. surfaces D -> D+O move on the chart at once) and rolled back if the server refuses. */
export const useUpdateTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; body: Partial<TreatmentInput> }) => (await api.put<{ item: TreatmentItem }>(`${base(pid)}/items/${v.id}`, v.body)).data.item, {
    itemOf: (i) => i,
    optimistic: (v) => {
      const { requestId: _ignored, estimatedPrice, toothSurfaces, ...rest } = v.body;
      void _ignored;
      // a target edit that does not restate the per-tooth surfaces drops them on the server too (teeth may have changed): mirror that on the chart at once
      const touchesTarget = rest.procedureCode !== undefined || rest.targetType !== undefined || rest.toothNumbers !== undefined || rest.surfaces !== undefined;
      const perTooth = toothSurfaces !== undefined ? { toothSurfaces: (toothSurfaces ?? undefined) as TreatmentItem["toothSurfaces"] } : touchesTarget ? { toothSurfaces: undefined } : {};
      return { id: v.id, patch: { ...(rest as Partial<TreatmentItem>), ...perTooth, ...(estimatedPrice !== undefined ? { estimatedPrice } : {}) } };
    },
  });
export const useCancelTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; reason?: string }) => (await api.post<{ item: TreatmentItem }>(`${base(pid)}/items/${v.id}/cancel`, { reason: v.reason })).data.item, {
    itemOf: (i) => i,
    optimistic: (v) => ({ id: v.id, patch: { status: "cancelled", cancelReason: v.reason } }),
  });
export const useStartTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; appointmentId: string }) => (await api.post<{ item: TreatmentItem; session: TreatmentSession }>(`${base(pid)}/items/${v.id}/start`, { appointmentId: v.appointmentId })).data, { itemOf: (r) => r.item });
export const useFinishSession = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; appointmentId: string; notes?: string }) => (await api.post<{ session: TreatmentSession }>(`${base(pid)}/items/${v.id}/finish-session`, { appointmentId: v.appointmentId, notes: v.notes })).data);
export const useCompleteTreatment = (pid: string) =>
  useTreatmentMutation(pid, async (v: { id: string; appointmentId: string; notes?: string }) => (await api.post<{ item: TreatmentItem; session: TreatmentSession | null }>(`${base(pid)}/items/${v.id}/complete`, { appointmentId: v.appointmentId, notes: v.notes })).data, { itemOf: (r) => r.item });
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
    onSuccess: (r) => {
      qc.setQueryData<TreatmentPlanResponse>(treatmentKey(patientId), (old) => upsertItem(old, r.item)); // the Invoiced link shows at once; the re-read below confirms it
      void qc.invalidateQueries({ queryKey: ["invoices"] }); // Invoices page + the patient's financial history (existing screens)
      return syncTreatmentCaches(qc, patientId);
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
