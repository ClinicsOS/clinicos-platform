"use client";
// PHASE 6 — the contract every section follows: ask the server for ONE section payload, show a skeleton while loading, a clear error
// state on failure, and render only what the server returned.
import axios from "axios";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { filtersValid, useAnalytics, type Filters, type Json, type Meta, type SectionId } from "@/lib/analytics";
import { Empty, SectionError, SectionSkeleton } from "./kit";

export interface SectionProps {
  filters: Filters;
  owner: boolean;
  meta: Meta;
  /** open the Expenses ledger already filtered to the current range (+ optional category / doctor) */
  openLedger: (range: { from: string; to: string }, extra?: { category?: string }) => void;
}

export function Loader({ section, filters, owner, children }: { section: SectionId; filters: Filters; owner: boolean; children: (d: Json) => ReactNode }) {
  const { t } = useI18n();
  const q = useAnalytics(section, filters, owner);
  if (!filtersValid(filters)) return <Empty text={t("an.f.invalid")} />;
  if (q.isLoading) return <SectionSkeleton />;
  if (q.error || !q.data) {
    const status = axios.isAxiosError(q.error) ? q.error.response?.status : undefined;
    return <SectionError forbidden={status === 403 || status === 404} onRetry={() => void q.refetch()} />;
  }
  return <div className={q.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"} data-testid={`an-section-${section}`} data-fetching={q.isFetching ? "1" : "0"}>{children(q.data)}</div>;
}
