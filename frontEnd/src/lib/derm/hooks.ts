import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";
import type {
  CreateAssessmentInput, DermAssessment, DermListFilters, DermListResponse, DermMapResponse,
} from "./types";

/** All Dermatology data flows through these hooks -> authenticated /api/derm endpoints only. */
export const dermMapKey = (patientId: string) => ["derm-map", patientId] as const;
export const dermListKey = (patientId: string, f: DermListFilters = {}) =>
  ["derm-assessments", patientId, f.regionId ?? "", f.recordType ?? "", f.appointmentId ?? "", f.includeVoided ? "1" : "0"] as const;
const dermListRoot = (patientId: string) => ["derm-assessments", patientId] as const;

/** A 403/404 means "not available for this clinic / patient" — retrying cannot help. */
const noRetryOnAuth = (count: number, err: unknown) => {
  const s = axios.isAxiosError(err) ? err.response?.status : undefined;
  return s === 403 || s === 404 ? false : count < 1;
};

export function useDermMap(patientId: string, enabled = true) {
  return useQuery({
    queryKey: dermMapKey(patientId),
    queryFn: async () => (await api.get<DermMapResponse>(`/derm/patients/${patientId}/map`)).data,
    enabled: enabled && !!patientId,
    retry: noRetryOnAuth,
  });
}

export function useDermAssessments(patientId: string, filters: DermListFilters = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: dermListKey(patientId, filters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit: 30 };
      if (filters.regionId) params.regionId = filters.regionId;
      if (filters.recordType) params.recordType = filters.recordType;
      if (filters.appointmentId) params.appointmentId = filters.appointmentId;
      if (filters.includeVoided) params.includeVoided = "1";
      if (pageParam) params.before = pageParam;
      return (await api.get<DermListResponse>(`/derm/patients/${patientId}/assessments`, { params })).data;
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextBefore : undefined),
    enabled: enabled && !!patientId,
    retry: noRetryOnAuth,
  });
}

/** Flattens the pages of an infinite list into one array (newest first). */
export const flattenAssessments = (pages: DermListResponse[] | undefined): DermAssessment[] =>
  (pages ?? []).flatMap((p) => p.assessments);

function useRefreshDerm(patientId: string) {
  const qc = useQueryClient();
  // Every list (any region / type filter) AND the map counts can change after a write — refetch both from the server.
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: dermListRoot(patientId) }),
    qc.invalidateQueries({ queryKey: dermMapKey(patientId) }),
    // Phase 2 views derived from assessments (unified timeline / Area History / overview)
    qc.invalidateQueries({ queryKey: ["derm-timeline", patientId] }),
    qc.invalidateQueries({ queryKey: ["derm-overview", patientId] }),
    qc.invalidateQueries({ queryKey: ["derm-dashboard"] }),
  ]);
}

export function useCreateAssessment(patientId: string) {
  const refresh = useRefreshDerm(patientId);
  return useMutation({
    mutationFn: async (input: CreateAssessmentInput) =>
      (await api.post<{ assessment: DermAssessment; duplicate: boolean }>(`/derm/patients/${patientId}/assessments`, input)).data,
    onSuccess: () => { void refresh(); },
  });
}

export interface EditAssessmentInput {
  assessmentId: string;
  rev: number;
  concern?: string;
  findings?: string;
  diagnosis?: string;
  notes?: string;
}

export function useEditAssessment(patientId: string) {
  const refresh = useRefreshDerm(patientId);
  return useMutation({
    mutationFn: async ({ assessmentId, ...body }: EditAssessmentInput) =>
      (await api.patch<{ assessment: DermAssessment }>(`/derm/patients/${patientId}/assessments/${assessmentId}`, body)).data.assessment,
    // On a STALE conflict the list is refetched too, so the user sees what the other person saved.
    onSuccess: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
}

export function useVoidAssessment(patientId: string) {
  const refresh = useRefreshDerm(patientId);
  return useMutation({
    mutationFn: async (i: { assessmentId: string; note?: string }) =>
      (await api.post<{ assessment: DermAssessment }>(`/derm/patients/${patientId}/assessments/${i.assessmentId}/void`, { note: i.note ?? "" })).data.assessment,
    onSuccess: () => { void refresh(); },
  });
}

/** Server error code (`STALE`, `EMPTY_ASSESSMENT`, ...) or HTTP-derived fallbacks; `null` for a non-HTTP failure. */
export function dermErrorCode(e: unknown): string | null {
  if (!axios.isAxiosError(e)) return null;
  const code = (e.response?.data as { code?: string } | undefined)?.code;
  if (code) return code;
  if (e.response?.status === 403) return "FORBIDDEN";
  if (!e.response) return "NETWORK";
  return null;
}

/** 24-char URL-safe id for `clientRequestId` (idempotent create). */
export function newRequestId(): string {
  const bytes = new Uint8Array(18);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}
