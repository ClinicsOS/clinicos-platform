"use client";
// PHASE 2 — the ONE client-side home of the invoice deletion lifecycle. Every screen (Invoices page, Deleted Invoices, any future place that shows an
// invoice) uses these hooks and the shared dialogs in components/invoices/InvoiceLifecycleDialogs.tsx; nobody calls the endpoints directly.
//
//   softDelete   DELETE /invoices/:id             -> Deleted Invoices            (never removes the invoice)
//   restore      PATCH  /invoices/:id/restore     -> Active Invoices             (the same invoice)
//   purge        DELETE /invoices/:id/permanent   -> gone for good               (only an already-deleted invoice; invoice number typed back)
//   deleted list GET    /invoices/deleted
// The server enforces who may do what (owner: any invoice · doctor: own invoices · receptionist: none) — this file never decides security.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useAccess } from "@/lib/access";
import type { Invoice } from "@/lib/types";

export const invoiceNo = (n: number) => `INV-${String(n).padStart(4, "0")}`;

/** "INV-0012", "inv12", "#12", "0012", "12" -> 12 (null if it is none of those). Same rule as the server's confirmation check. */
export const parseInvoiceNo = (v: string): number | null => {
  const m = v.trim().match(/^(?:inv[-\s]?)?#?0*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
};

/** A user-facing message for a failed lifecycle call: "gone / not yours" (404) gets the friendly one, anything else the server's own message. */
export const lifecycleError = (e: unknown, t: (k: string) => string) =>
  axios.isAxiosError(e) && e.response?.status === 404 ? t("invd.gone") : errMsg(e, t("common.error"));

/** Deleting / restoring / purging moves money figures everywhere: bring every screen that shows invoices or invoice-derived numbers up to date. */
export function refreshInvoiceMoney(qc: QueryClient) {
  const keys = new Set(["invoices", "stats", "analytics", "clinical-timeline"]);
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === "string" && (keys.has(k) || k.startsWith("dental-") || k.startsWith("derm-"));
    },
  });
}

export function useDeletedInvoices(params: { search?: string; doctorId?: string } = {}, enabled = true) {
  const token = useAuth((s) => s.token);
  const search = (params.search ?? "").trim();
  const doctorId = params.doctorId && params.doctorId !== "all" ? params.doctorId : "";
  return useQuery({
    queryKey: ["invoices", "deleted", search, doctorId],
    enabled: enabled && !!token,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (doctorId) qs.set("doctorId", doctorId);
      return (await api.get<Invoice[]>(`/invoices/deleted${qs.toString() ? `?${qs}` : ""}`)).data;
    },
  });
}

export function useSoftDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; reason?: string }) =>
      (await api.delete<Invoice>(`/invoices/${v.id}`, { data: v.reason?.trim() ? { reason: v.reason.trim() } : {} })).data,
    onSettled: () => void refreshInvoiceMoney(qc), // success -> it moved; failure (already gone / not yours) -> the list was stale
  });
}

export function useRestoreInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string }) => (await api.patch<Invoice>(`/invoices/${v.id}/restore`)).data,
    onSettled: () => void refreshInvoiceMoney(qc),
  });
}

export function usePermanentDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; confirm: string }) =>
      (await api.delete<{ deleted: true; invoiceNumber: number }>(`/invoices/${v.id}/permanent`, { data: { confirm: v.confirm } })).data,
    onSettled: () => void refreshInvoiceMoney(qc),
  });
}

/** What this user may do with the lifecycle (presentation only — the server re-checks every call). */
export function useInvoiceLifecycleAccess() {
  const access = useAccess();
  return { canDelete: access.can("invoicesDelete"), canPurge: access.can("invoicesPurge") };
}
