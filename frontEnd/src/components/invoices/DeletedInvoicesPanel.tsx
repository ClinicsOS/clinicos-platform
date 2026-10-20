"use client";
// PHASE 2 — the "Deleted Invoices" tab of the Invoices page: every soft-deleted invoice the signed-in user may manage (owner: the whole clinic;
// doctor: their own), with who deleted it, when and why — and the only two ways out: Restore, or Delete permanently (typed confirmation).
// Money figures elsewhere in the app never include these invoices; the notice below says so.
import { useEffect, useMemo, useState } from "react";
import { IconArchive, IconInfoCircle, IconRestore, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { CLINIC_TIMEZONE } from "@/lib/dates";
import { paidOf, type Invoice } from "@/lib/types";
import { invoiceNo, useDeletedInvoices } from "@/lib/invoices/lifecycle";
import { PermanentDeleteDialog, RestoreInvoiceDialog } from "@/components/invoices/InvoiceLifecycleDialogs";

const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((a, [k, v]) => a.split(`{${k}}`).join(v), s);
const nameOf = (v: Invoice["doctorId"] | Invoice["deletedBy"]) => (v && typeof v === "object" ? v.name : "");

const statusPill: Record<string, string> = {
  paid: "bg-teal/15 text-teal",
  partially_paid: "bg-amber-500/15 text-amber-400",
  unpaid: "bg-red-500/15 text-red-400",
};

export default function DeletedInvoicesPanel({
  canPurge,
  doctors,
  showDoctorFilter,
}: {
  canPurge: boolean;
  doctors: { _id: string; name: string }[];
  showDoctorFilter: boolean;
}) {
  const { t, lang } = useI18n();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [doctorId, setDoctorId] = useState("all");
  const [restoring, setRestoring] = useState<Invoice | null>(null);
  const [purging, setPurging] = useState<Invoice | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const { data, isLoading, isError } = useDeletedInvoices({ search, doctorId });
  const rows = data ?? [];

  const when = useMemo(
    () => (iso?: string | null) =>
      iso
        ? new Date(iso).toLocaleString(lang === "ar" ? "ar-JO-u-nu-latn" : undefined, { timeZone: CLINIC_TIMEZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "",
    [lang]
  );

  return (
    <div>
      {/* what "deleted" means for the numbers */}
      <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-edge bg-soft px-3.5 py-2.5 backdrop-blur-sm">
        <IconInfoCircle size={15} className="mt-0.5 shrink-0 text-sky" />
        <p className="text-[11px] leading-relaxed text-mute">{t("invd.notice")}</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <IconSearch size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="inp !bg-card pe-9 ps-9"
            placeholder={t("inv.searchPh")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t("inv.searchPh")}
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(""); setSearch(""); }} className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-mute hover:text-ink" aria-label={t("inv.clearSearch")}>
              <IconX size={14} />
            </button>
          )}
        </div>
        {showDoctorFilter && (
          <select className="inp !w-auto !py-2 text-[11px]" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label={t("md.filter.doctor")}>
            <option value="all">{t("md.filter.doctor")}: {t("md.filter.all")}</option>
            {doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            <option value="unassigned">{t("md.filter.unassigned")}</option>
          </select>
        )}
        {rows.length > 0 && <span className="ms-auto text-[10px] text-mute">{fill(t("invd.count"), { n: String(rows.length) })}</span>}
      </div>

      {isLoading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="card h-[68px] animate-pulse opacity-60" />)}
        </div>
      )}
      {isError && !data && <p className="py-10 text-center text-xs text-red-400">{t("common.error")}</p>}

      {!isLoading && data && rows.length === 0 && (
        <div className="card py-14 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-soft text-blue">
            {search ? <IconSearch size={24} /> : <IconArchive size={24} />}
          </div>
          <p className="text-sm font-medium text-ink">{search ? fill(t("invd.noMatch"), { q: search }) : t("invd.empty.title")}</p>
          {!search && <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-mute">{t(canPurge ? "invd.empty.body" : "invd.empty.bodyNoPurge")}</p>}
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((inv) => {
          const paid = paidOf(inv);
          const doc = nameOf(inv.doctorId);
          const by = nameOf(inv.deletedBy);
          return (
            <li
              key={inv._id}
              className="group card flex flex-col gap-3 border-s-[3px] !border-s-amber-400/40 bg-card/70 p-3.5 backdrop-blur-sm transition duration-200 hover:border-sky/50 hover:shadow-[0_14px_34px_-20px_rgba(0,0,0,0.65)] motion-safe:hover:-translate-y-px md:flex-row md:items-center"
            >
              {/* identity */}
              <div className="min-w-0 md:flex-[1.3]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-mute" dir="ltr">{invoiceNo(inv.invoiceNumber)}</span>
                  <span className="pill items-center gap-1 border border-edge bg-soft !px-2 !py-0 !text-[9px] text-mute">
                    <IconArchive size={9} /> {t("invd.badge")}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[12px] font-medium text-ink/90">{inv.patientId?.fullName ?? "—"}</div>
                <div className="truncate text-[10px] text-mute">
                  {doc ? doc : t("md.invoice.unassigned")}
                  <span aria-hidden> · </span>
                  <span dir="ltr">{new Date(inv.createdAt).toLocaleDateString(lang === "ar" ? "ar-JO-u-nu-latn" : undefined, { timeZone: CLINIC_TIMEZONE, day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              </div>

              {/* money (its payment status is untouched by deletion) */}
              <div className="md:w-40 md:shrink-0">
                <div className="font-mono text-[11px] text-ink/80" dir="ltr">{paid.toFixed(2)} / {inv.total.toFixed(2)} JD</div>
                <span className={`pill mt-1 !px-2 !py-0 !text-[9px] opacity-80 ${statusPill[inv.status] ?? "bg-soft text-mute"}`}>
                  {inv.status === "paid" ? t("inv.paid") : inv.status === "partially_paid" ? t("inv.partial") : t("inv.unpaid")}
                </span>
              </div>

              {/* who / when / why */}
              <div className="min-w-0 text-[10px] leading-relaxed text-mute md:flex-1">
                <div>
                  {fill(t("invd.deletedOn"), { date: when(inv.deletedAt) })}
                  {by && <> · {fill(t("invd.by"), { name: by })}</>}
                </div>
                <div className="truncate" title={inv.deleteReason ?? undefined}>
                  {inv.deleteReason ? <><span className="text-mute/80">{t("invd.reason")}: </span><span className="text-ink/80">{inv.deleteReason}</span></> : <span className="italic opacity-80">{t("invd.noReason")}</span>}
                </div>
              </div>

              {/* the only two ways out */}
              <div className="flex shrink-0 items-center gap-1.5 md:justify-end">
                <button
                  onClick={() => setRestoring(inv)}
                  className="btn-ghost !border-teal/40 !px-3 !py-1.5 text-[10px] !text-teal transition duration-150 hover:!border-teal active:scale-[0.97]"
                >
                  <IconRestore size={13} /> {t("invd.restore")}
                </button>
                {canPurge && (
                  <button
                    onClick={() => setPurging(inv)}
                    className="btn-ghost !px-3 !py-1.5 text-[10px] !text-mute transition duration-150 hover:!border-red-400/60 hover:!text-red-400 active:scale-[0.97]"
                    aria-label={`${t("invd.purge.btn")} ${invoiceNo(inv.invoiceNumber)}`}
                  >
                    <IconTrash size={13} /> {t("invd.purge.btn")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {restoring && <RestoreInvoiceDialog invoice={restoring} onClose={() => setRestoring(null)} />}
      {purging && <PermanentDeleteDialog invoice={purging} onClose={() => setPurging(null)} />}
    </div>
  );
}
