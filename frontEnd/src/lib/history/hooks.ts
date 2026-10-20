import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HistoryFilter, HistoryPage } from "./types";

/**
 * PHASE 3 — the unified clinical history of ONE patient (GET /patients/:id/clinical-history).
 * The key starts with ["clinical-timeline", patientId] on purpose: every existing mutation that already refreshes the Clinical Record
 * (notes, treatment sessions, appointment edits, dental events) refreshes this view too — no manual reload, no second cache to forget.
 */
export const historyKey = (patientId: string, source: HistoryFilter, q: string) =>
  ["clinical-timeline", patientId, "history", source, q] as const;

const retryPolicy = (count: number, err: unknown) => {
  const st = (err as { response?: { status?: number } })?.response?.status;
  return st === 403 || st === 404 ? false : count < 1;
};

export function useClinicalHistory(patientId: string, source: HistoryFilter, q: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: historyKey(patientId, source, q),
    enabled,
    retry: retryPolicy,
    initialPageParam: "" as string,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<HistoryPage>(`/patients/${patientId}/clinical-history`, {
          signal,
          params: { limit: 20, ...(source !== "all" ? { source } : {}), ...(q ? { q } : {}), ...(pageParam ? { before: pageParam } : {}) },
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
