"use client";
// PHASE 2 — the three dialogs of the invoice deletion lifecycle. ONE implementation shared by every screen that shows an invoice:
//   DeleteInvoiceDialog      "Delete Invoice?"            -> moves it to Deleted Invoices (recoverable), optional reason
//   RestoreInvoiceDialog     "Restore Invoice INV-0012?"  -> back to Active Invoices, the same invoice
//   PermanentDeleteDialog    "Permanently Delete Invoice?" -> irreversible; the invoice number must be typed back
// Existing design language only (card / pill / btn-* tokens, glass over the page, 150–250 ms motion that respects reduced-motion).
// RTL/LTR: logical utilities only (ms-/me-/start-/end-), numbers and invoice ids are always LTR.
import { ReactNode, useEffect, useRef, useState } from "react";
import { IconArchive, IconRestore, IconTrash, IconAlertTriangle } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { paidOf, type Invoice } from "@/lib/types";
import { invoiceNo, lifecycleError, parseInvoiceNo, useRestoreInvoice, usePermanentDeleteInvoice, useSoftDeleteInvoice } from "@/lib/invoices/lifecycle";

const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((a, [k, v]) => a.split(`{${k}}`).join(v), s);
const jd = (n: number) => `${n.toFixed(2)} JD`;
const patientNameOf = (inv: Invoice) => (inv.patientId && typeof inv.patientId === "object" ? inv.patientId.fullName : "") || "—";

function Shell({ title, icon, tone, busy, onClose, children }: { title: string; icon: ReactNode; tone: "amber" | "teal" | "red"; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ring = { amber: "bg-amber-500/15 text-amber-400 ring-amber-400/25", teal: "bg-teal/15 text-teal ring-teal/25", red: "bg-red-500/15 text-red-400 ring-red-400/30" }[tone];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="invd-fade fixed inset-0 z-dialog flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="invd-pop card w-full max-w-md overflow-hidden shadow-[0_28px_70px_-24px_rgba(0,0,0,0.75)]"
      >
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${ring}`}>{icon}</span>
          <h3 className="min-w-0 flex-1 pt-2 text-sm font-medium text-ink">{title}</h3>
        </div>
        <div className="px-5 pb-5 pt-2">{children}</div>
      </div>
    </div>
  );
}

/** The invoice in one glance: number · patient · amount (and what has been paid). Shown in all three dialogs so the user can't misread which invoice it is. */
function Summary({ inv }: { inv: Invoice }) {
  const { t } = useI18n();
  const paid = paidOf(inv);
  return (
    <div className="mb-3 rounded-lg border border-edge bg-soft px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-medium text-blue" dir="ltr">{invoiceNo(inv.invoiceNumber)}</span>
        <span className="font-mono text-[11px] text-ink" dir="ltr">{jd(inv.total)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-mute">
        <span className="min-w-0 truncate">{t("invd.del.patient")}: <span className="text-ink">{patientNameOf(inv)}</span></span>
        {paid > 0 && <span className="shrink-0 font-mono" dir="ltr">{jd(paid)} / {jd(inv.total)}</span>}
      </div>
    </div>
  );
}

const Actions = ({ children }: { children: ReactNode }) => <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
const ghostBtn = "btn-ghost !px-4 !py-2 text-[11px] transition-colors duration-150";

/* ------------------------------------------------------------------ move to Deleted Invoices */
export function DeleteInvoiceDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const del = useSoftDeleteInvoice();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const paid = paidOf(invoice);
  const no = invoiceNo(invoice.invoiceNumber);
  const submit = () =>
    del.mutate(
      { id: invoice._id, reason },
      {
        onSuccess: () => {
          toast.success(t("invd.del.done"), fill(t("invd.del.doneBody"), { no }));
          onDone?.();
          onClose();
        },
        onError: (e) => setError(lifecycleError(e, t)),
      }
    );
  return (
    <Shell title={t("invd.del.title")} icon={<IconArchive size={20} />} tone="amber" busy={del.isPending} onClose={onClose}>
      <p className="mb-3 text-[11px] leading-relaxed text-mute">{t("invd.del.body")}</p>
      <Summary inv={invoice} />
      {paid > 0 && (
        <p className="mb-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-300">
          {fill(t("invd.del.paidWarn"), { amount: paid.toFixed(2) })}
        </p>
      )}
      <label className="lbl" htmlFor="invd-reason">{t("invd.del.reason")}</label>
      <input
        id="invd-reason"
        dir="auto"
        className="inp"
        placeholder={t("invd.del.reasonPh")}
        value={reason}
        maxLength={300}
        autoFocus
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !del.isPending) submit(); }}
      />
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      <Actions>
        <button className={ghostBtn} onClick={onClose} disabled={del.isPending}>{t("common.cancel")}</button>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-[11px] font-medium text-navy transition duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={submit}
          disabled={del.isPending}
        >
          <IconArchive size={14} /> {del.isPending ? t("common.loading") : t("invd.del.confirm")}
        </button>
      </Actions>
    </Shell>
  );
}

/* ------------------------------------------------------------------ restore */
export function RestoreInvoiceDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const restore = useRestoreInvoice();
  const [error, setError] = useState("");
  const no = invoiceNo(invoice.invoiceNumber);
  return (
    <Shell title={fill(t("invd.res.title"), { no })} icon={<IconRestore size={20} />} tone="teal" busy={restore.isPending} onClose={onClose}>
      <p className="mb-3 text-[11px] leading-relaxed text-mute">{t("invd.res.body")}</p>
      <Summary inv={invoice} />
      {error && <p className="mb-1 text-[11px] text-red-400">{error}</p>}
      <Actions>
        <button className={ghostBtn} onClick={onClose} disabled={restore.isPending}>{t("common.cancel")}</button>
        <button
          className="btn-teal !px-4 !py-2 text-[11px] transition duration-150 active:scale-[0.98]"
          autoFocus
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate(
              { id: invoice._id },
              {
                onSuccess: () => {
                  toast.success(t("invd.res.done"), fill(t("invd.res.doneBody"), { no }));
                  onDone?.();
                  onClose();
                },
                onError: (e) => setError(lifecycleError(e, t)),
              }
            )
          }
        >
          <IconRestore size={14} /> {restore.isPending ? t("common.loading") : t("invd.res.confirm")}
        </button>
      </Actions>
    </Shell>
  );
}

/* ------------------------------------------------------------------ permanent delete */
export function PermanentDeleteDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const purge = usePermanentDeleteInvoice();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const no = invoiceNo(invoice.invoiceNumber);
  useEffect(() => { input.current?.focus(); }, []);
  // deliberate: only the exact invoice number unlocks the button (INV-0012 / inv12 / 12 all mean the same invoice — the server re-checks it)
  const matches = parseInvoiceNo(typed) === invoice.invoiceNumber;
  const submit = () => {
    if (!matches || purge.isPending) return;
    purge.mutate(
      { id: invoice._id, confirm: no },
      {
        onSuccess: () => {
          toast.success(t("invd.purge.done"), fill(t("invd.purge.doneBody"), { no }));
          onDone?.();
          onClose();
        },
        onError: (e) => setError(lifecycleError(e, t)),
      }
    );
  };
  return (
    <Shell title={t("invd.purge.title")} icon={<IconAlertTriangle size={20} />} tone="red" busy={purge.isPending} onClose={onClose}>
      <p className="mb-3 text-[11px] leading-relaxed text-ink">{fill(t("invd.purge.body"), { no })}</p>
      <Summary inv={invoice} />
      <label className="lbl" htmlFor="invd-confirm">
        {t("invd.purge.type")} <span className="font-mono text-ink" dir="ltr">{no}</span>
      </label>
      <input
        id="invd-confirm"
        ref={input}
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        className={`inp font-mono transition-colors duration-150 ${matches ? "!border-red-400/70" : ""}`}
        placeholder={no}
        value={typed}
        onChange={(e) => { setTyped(e.target.value); setError(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      <Actions>
        <button className={ghostBtn} onClick={onClose} disabled={purge.isPending}>{t("common.cancel")}</button>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-[11px] font-medium text-white transition duration-150 hover:bg-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!matches || purge.isPending}
          onClick={submit}
        >
          <IconTrash size={14} /> {purge.isPending ? t("common.loading") : t("invd.purge.confirm")}
        </button>
      </Actions>
    </Shell>
  );
}
