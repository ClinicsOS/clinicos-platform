import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ClinicalNote, NoteRevision, NoteSource, TimelineFilter, TimelinePage } from "./types";

/**
 * The patient's clinical record talks to ONE read endpoint (the timeline) and two write endpoints (create / edit a note).
 * Cache strategy (same as the dental module): mutations are SERVER-CONFIRMED — nothing is drawn before the backend has
 * saved it — and `onSuccess` returns the invalidation promise, so `mutateAsync` resolves only after the visible timeline
 * holds the fresh data (no stale flash, no manual refresh).
 */
export const timelineKey = (patientId: string, filter?: TimelineFilter) =>
  filter ? (["clinical-timeline", patientId, filter] as const) : (["clinical-timeline", patientId] as const);

/** Brings every clinical-record view of this patient up to date (all filters). */
export const syncClinicalRecord = (qc: QueryClient, patientId: string) => qc.invalidateQueries({ queryKey: timelineKey(patientId) });

const retryPolicy = (count: number, err: unknown) => {
  const st = (err as { response?: { status?: number } })?.response?.status;
  return st === 403 || st === 404 ? false : count < 1;
};

export function useClinicalTimeline(patientId: string, filter: TimelineFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: timelineKey(patientId, filter),
    enabled,
    retry: retryPolicy,
    initialPageParam: "" as string,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<TimelinePage>(`/patients/${patientId}/clinical-timeline`, {
          params: { limit: 20, ...(filter !== "all" ? { kind: filter } : {}), ...(pageParam ? { before: pageParam } : {}) },
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export interface CreateNoteInput { text: string; sourceType: NoteSource; sourceId?: string; requestId: string }

export function useCreateNote(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CreateNoteInput) =>
      (await api.post<{ note: ClinicalNote; duplicate: boolean }>(`/patients/${patientId}/clinical-notes`, v)).data,
    onSuccess: () => syncClinicalRecord(qc, patientId),
  });
}

export function useUpdateNote(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; text: string; expectedEditCount: number }) =>
      (await api.put<{ note: ClinicalNote; unchanged: boolean }>(`/patients/${patientId}/clinical-notes/${v.id}`, { text: v.text, expectedEditCount: v.expectedEditCount })).data,
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["clinical-note-revisions", patientId, v.id] });
      return syncClinicalRecord(qc, patientId);
    },
  });
}

/** Loaded only when someone opens "View edit history" (never with the timeline). */
export function useNoteRevisions(patientId: string, noteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["clinical-note-revisions", patientId, noteId],
    enabled,
    retry: retryPolicy,
    queryFn: async () => (await api.get<{ revisions: NoteRevision[] }>(`/patients/${patientId}/clinical-notes/${noteId}/revisions`)).data.revisions,
  });
}

/** One id per "Add note" dialog: a double click / retry of the same dialog is the same note, server-side too. */
export const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
