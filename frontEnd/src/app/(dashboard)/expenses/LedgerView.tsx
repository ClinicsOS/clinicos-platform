"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useClinicDoctors } from "@/lib/access";
import { Skeleton } from "@/components/Skeleton";
import type { ExpenseKind, ExpenseSummary, LedgerPage, LedgerRow } from "@/lib/types";
import { EXPENSE_CATEGORIES, categoryIcon, jd, shortDate } from "@/lib/expenses";
import { IconChevronLeft, IconChevronRight, IconFilterOff, IconPencil, IconRepeat, IconSearch, IconTrash, IconBuildingCommunity, IconStethoscope, IconUser } from "@tabler/icons-react";

/**
 * PHASE 5 — "All expenses": filters + totals + a paginated ledger.
 *
 *  - owner  : whole clinic (clinic-shared, doctor-attributed and — shown separately — personal); can edit / delete.
 *  - doctor : read-only, ONLY the expenses attributed to them. The server enforces this (the doctor's scope is their own id, any
 *             doctorId we send is ignored/refused); this component simply doesn't offer controls that would not apply.
 *
 * All numbers come from the server (/expenses/summary, /expenses/ledger). Nothing is summed in the browser.
 */

/** PHASE 6 — optional starting filters (the Analytics Center links here). */
export type LedgerInitial = { from?: string; to?: string; category?: string; doctorId?: string };

type Props = {
  mode: "owner" | "doctor";
  initial?: LedgerInitial;
  onEdit?: (row: LedgerRow) => void;
  onDelete?: (row: LedgerRow) => void;
};

const PAGE_SIZE = 25;

const kindMeta: Record<ExpenseKind, { Icon: typeof IconUser; cls: string }> = {
  clinic: { Icon: IconBuildingCommunity, cls: "bg-teal/15 text-teal" },
  doctor: { Icon: IconStethoscope, cls: "bg-sky/15 text-sky" },
  personal: { Icon: IconUser, cls: "bg-blue/15 text-sky" },
};

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function LedgerView({ mode, initial, onEdit, onDelete }: Props) {
  const { t, lang } = useI18n();
  const owner = mode === "owner";
  const { doctors } = useClinicDoctors(owner);

  const [from, setFrom] = useState(initial?.from ?? "");
  const [to, setTo] = useState(initial?.to ?? "");
  const [doctorId, setDoctorId] = useState(owner ? initial?.doctorId ?? "" : ""); // "" = all, "unassigned" = shared clinic only, else a doctor id (owner only)
  const [category, setCategory] = useState(initial?.category ?? "");
  const [kind, setKind] = useState<"all" | ExpenseKind>("all");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(searchText.trim());

  // Any filter change goes back to page 1.
  useEffect(() => setPage(1), [from, to, doctorId, category, kind, search]);

  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (category) p.set("category", category);
    if (search) p.set("search", search);
    if (owner) {
      if (doctorId) p.set("doctorId", doctorId);
      if (kind !== "all") p.set("kind", kind);
    }
    return p.toString();
  }, [from, to, category, search, owner, doctorId, kind]);

  const rangeInvalid = !!from && !!to && from > to;

  const list = useQuery({
    queryKey: ["expenses", "ledger", mode, filterQs, page],
    queryFn: async () => (await api.get<LedgerPage>(`/expenses/ledger?${filterQs}${filterQs ? "&" : ""}page=${page}&limit=${PAGE_SIZE}`)).data,
    enabled: !rangeInvalid,
    placeholderData: (prev) => prev,
  });
  const sum = useQuery({
    queryKey: ["expenses", "summary", mode, filterQs],
    queryFn: async () => (await api.get<ExpenseSummary>(`/expenses/summary?${filterQs}`)).data,
    enabled: !rangeInvalid,
    placeholderData: (prev) => prev,
  });

  const filtered = !!(from || to || doctorId || category || search || kind !== "all");
  const clear = () => {
    setFrom(""); setTo(""); setDoctorId(""); setCategory(""); setKind("all"); setSearchText("");
  };

  const data = list.data;
  const s = sum.data;

  return (
    // pb-24: the floating assistant bubble sits bottom-corner on every page — keep the pagination clear of it.
    <div className="pb-24">
      {/* ===== Filters ===== */}
      <div className="card mb-3 p-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="lbl">{t("ex.f.from")}</label>
            <input type="date" aria-label={t("ex.f.from")} className="inp" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="lbl">{t("ex.f.to")}</label>
            <input type="date" aria-label={t("ex.f.to")} className="inp" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="lbl">{t("ex.f.category")}</label>
            <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t("ex.f.allCategories")}</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{t(`ex.cat.${c.id}`)}</option>
              ))}
            </select>
          </div>
          {owner && (
            <div>
              <label className="lbl">{t("ex.f.doctor")}</label>
              <select className="inp" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">{t("ex.f.allDoctors")}</option>
                <option value="unassigned">{t("ex.f.sharedOnly")}</option>
                {doctors.map((d) => (
                  <option key={d._id} value={d._id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
          {owner && (
            <div>
              <label className="lbl">{t("ex.f.type")}</label>
              <select className="inp" value={kind} onChange={(e) => setKind(e.target.value as "all" | ExpenseKind)}>
                {(["all", "clinic", "doctor", "personal"] as const).map((k) => (
                  <option key={k} value={k}>{t(`ex.kind.${k}`)}</option>
                ))}
              </select>
            </div>
          )}
          <div className={owner ? "" : "lg:col-span-3"}>
            <label className="lbl">{t("ex.f.search")}</label>
            <div className="relative">
              <IconSearch size={13} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-mute" />
              <input className="inp !ps-8" value={searchText} maxLength={60} placeholder={t("ex.f.searchPh")} onChange={(e) => setSearchText(e.target.value)} />
            </div>
          </div>
        </div>
        {filtered && (
          <button onClick={clear} className="btn-ghost mt-2.5 !px-2.5 !py-1 text-[10px]">
            <IconFilterOff size={12} /> {t("ex.f.clear")}
          </button>
        )}
        {rangeInvalid && <p className="mt-2 text-[11px] text-red-400">{t("ex.f.from")} &gt; {t("ex.f.to")}</p>}
      </div>

      {/* ===== Summary (server-computed) ===== */}
      {s ? (
        <div className="mb-3">
          <div className={`grid gap-2.5 ${owner ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
            <Stat label={owner ? t("ex.sum.total") : t("ex.sum.mine")} sub={owner ? t("ex.sum.totalSub") : undefined} value={s.totals.business} strong />
            {owner ? (
              <>
                <Stat label={t("ex.sum.clinic")} value={s.totals.clinic} />
                <Stat label={t("ex.sum.doctor")} value={s.totals.doctor} />
                <Stat label={t("ex.sum.personal")} sub={t("ex.sum.personalSub")} value={s.totals.personal} muted />
              </>
            ) : (
              <Stat label={t("ex.sum.pending")} value={s.pending} muted />
            )}
          </div>
          <div className="mt-2.5 grid gap-2.5 lg:grid-cols-2">
            <div className="card p-3.5">
              <h3 className="mb-2.5 text-[11px] font-medium text-ink">{t("ex.byCategory")}</h3>
              {s.byCategory.length === 0 && <p className="text-[11px] text-mute">{t("ex.noMatch")}</p>}
              {s.byCategory.slice(0, 8).map((c) => {
                const Icon = categoryIcon(c.category);
                const max = s.byCategory[0]?.total || 1;
                return (
                  <div key={c.category} className="mb-2 last:mb-0">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                      <Icon size={13} className="text-mute" />
                      <span className="text-ink">{t(`ex.cat.${c.category}`)}</span>
                      <span className="ms-auto font-mono text-ink" dir="ltr">{jd(c.total)} JD</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-soft" style={{ width: `${Math.max(6, (c.total / max) * 100)}%` }}>
                      <span className="block h-full bg-teal" />
                    </div>
                  </div>
                );
              })}
            </div>
            {owner && (
              <div className="card p-3.5">
                <h3 className="mb-2.5 text-[11px] font-medium text-ink">{t("ex.sum.byDoctor")}</h3>
                {s.byDoctor.length === 0 && <p className="text-[11px] text-mute">—</p>}
                {s.byDoctor.map((d) => (
                  <div key={d.doctorId} className="mb-1.5 flex items-center gap-1.5 text-[11px] last:mb-0">
                    <IconStethoscope size={13} className="text-mute" />
                    <span dir="auto" className="truncate text-ink">{d.name}</span>
                    <span className="ms-auto font-mono text-ink" dir="ltr">{jd(d.total)} JD</span>
                  </div>
                ))}
                <p className="mt-3 border-t border-edge pt-2 text-[10px] leading-relaxed text-mute">{t("ex.sum.noAlloc")}</p>
              </div>
            )}
          </div>
          <p className="mt-2 text-[10px] text-mute">
            {t("ex.sum.rangeNote")}
            {owner && s.pending > 0 ? ` · ${t("ex.sum.pending")}: ${jd(s.pending)} JD` : ""}
          </p>
        </div>
      ) : sum.isError ? (
        <p className="mb-3 text-[11px] text-red-400">{errMsg(sum.error, t("ex.loadError"))}</p>
      ) : (
        <Skeleton className="mb-3 h-24" />
      )}

      {/* ===== Ledger ===== */}
      <div className="card overflow-hidden">
        {list.isError && <p className="px-4 py-8 text-center text-[11px] text-red-400">{errMsg(list.error, t("ex.loadError"))}</p>}
        {!data && !list.isError && <Skeleton className="m-3 h-56" />}
        {data && data.items.length === 0 && (
          <p className="px-4 py-10 text-center text-[11px] text-mute">{filtered ? t("ex.noMatch") : t("ex.ledgerEmpty")}</p>
        )}
        {data && data.items.length > 0 && (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-start text-[11px]">
                <thead>
                  <tr className="border-b border-edge text-[10px] uppercase tracking-wide text-mute">
                    <th className="px-4 py-2.5 text-start font-medium">{t("ex.col.date")}</th>
                    <th className="px-2 py-2.5 text-start font-medium">{t("ex.col.category")}</th>
                    <th className="px-2 py-2.5 text-start font-medium">{t("ex.col.desc")}</th>
                    <th className="px-2 py-2.5 text-start font-medium">{t("ex.col.attr")}</th>
                    <th className="px-2 py-2.5 text-end font-medium">{t("ex.col.amount")}</th>
                    {owner && <th className="px-2 py-2.5 text-start font-medium">{t("ex.col.by")}</th>}
                    {owner && <th className="px-4 py-2.5 text-end font-medium">{t("ex.col.actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r._id} data-testid="ledger-row" className="border-b border-edge last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-mute">{shortDate(r.date, lang)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-ink">{t(`ex.cat.${r.category}`)}</td>
                      <td className="max-w-[260px] px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span dir="auto" className="truncate font-medium text-ink">{r.title}</span>
                          {r.recurringId && <IconRepeat size={11} className="shrink-0 text-mute" />}
                          {r.status === "pending" && <span className="pill !py-0 bg-amber-500/15 text-amber-400">{t("ex.pendingTag")}</span>}
                        </div>
                        {(r.vendor || r.reference) && (
                          <div dir="auto" className="truncate text-[10px] text-mute">{[r.vendor, r.reference].filter(Boolean).join(" · ")}</div>
                        )}
                      </td>
                      <td className="px-2 py-2.5"><KindPill row={r} /></td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-end font-mono font-medium text-ink" dir="ltr">{jd(r.amount)} JD</td>
                      {owner && <td dir="auto" className="max-w-[140px] truncate px-2 py-2.5 text-mute">{r.createdBy?.name || "—"}</td>}
                      {owner && (
                        <td className="px-4 py-2.5">
                          <span className="flex justify-end gap-1">
                            <RowBtn label={t("ex.edit")} onClick={() => onEdit?.(r)}><IconPencil size={13} /></RowBtn>
                            <RowBtn label={t("ex.delete")} danger onClick={() => onDelete?.(r)}><IconTrash size={13} /></RowBtn>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* mobile list */}
            <div className="md:hidden">
              {data.items.map((r) => (
                <div key={r._id} data-testid="ledger-row-m" className="border-b border-edge px-4 py-3 last:border-0">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div dir="auto" className="truncate text-xs font-medium text-ink">{r.title}</div>
                      <div className="mt-0.5 text-[10px] text-mute">{shortDate(r.date, lang)} · {t(`ex.cat.${r.category}`)}</div>
                    </div>
                    <span className="font-mono text-xs font-medium text-ink" dir="ltr">{jd(r.amount)} JD</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <KindPill row={r} />
                    {r.status === "pending" && <span className="pill !py-0 bg-amber-500/15 text-amber-400">{t("ex.pendingTag")}</span>}
                    {owner && (
                      <span className="ms-auto flex gap-1">
                        <RowBtn label={t("ex.edit")} onClick={() => onEdit?.(r)}><IconPencil size={13} /></RowBtn>
                        <RowBtn label={t("ex.delete")} danger onClick={() => onDelete?.(r)}><IconTrash size={13} /></RowBtn>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* pagination */}
            <div className="flex flex-wrap items-center gap-2 border-t border-edge px-4 py-2.5 text-[10px] text-mute">
              <span>{t("ex.total").replace("{n}", String(data.total))}</span>
              <span className="ms-auto">{t("ex.pageOf").replace("{p}", String(data.page)).replace("{n}", String(data.pages))}</span>
              <button className="btn-ghost !px-2 !py-1 text-[10px]" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} aria-label={t("ex.prev")}>
                <IconChevronLeft size={12} className="rtl-flip" />
              </button>
              <button className="btn-ghost !px-2 !py-1 text-[10px]" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)} aria-label={t("ex.next")}>
                <IconChevronRight size={12} className="rtl-flip" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KindPill({ row }: { row: LedgerRow }) {
  const { t } = useI18n();
  const { Icon, cls } = kindMeta[row.kind];
  const label = row.kind === "doctor" ? row.doctor?.name || t("ex.kind.doctor") : row.kind === "personal" ? t("ex.kind.personal") : t("ex.attr.clinic");
  return (
    <span className={`pill inline-flex max-w-[160px] items-center gap-1 !py-0.5 ${cls}`}>
      <Icon size={11} className="shrink-0" />
      <span dir="auto" className="truncate">{label}</span>
    </span>
  );
}

function Stat({ label, sub, value, strong, muted }: { label: string; sub?: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`card px-3.5 py-3 ${muted ? "opacity-80" : ""}`}>
      <div className="text-[10px] text-mute">{label}</div>
      <div className={`mt-0.5 font-mono ${strong ? "text-lg text-ink" : "text-base text-ink"}`} dir="ltr">{jd(value)} <span className="text-[10px] text-mute">JD</span></div>
      {sub && <div className="mt-0.5 text-[10px] leading-snug text-mute">{sub}</div>}
    </div>
  );
}

function RowBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`rounded-md p-1.5 text-mute transition-colors ${danger ? "hover:bg-red-500/10 hover:text-red-400" : "hover:bg-soft hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
