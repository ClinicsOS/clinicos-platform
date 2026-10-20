"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconAlertTriangle, IconArrowUpRight, IconCalendarEvent, IconClipboardList, IconDental, IconMap2, IconNotes, IconPencil, IconSearch, IconX,
} from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { fmtCalendarDate, fmtTime12, todayLocal } from "@/lib/dates";
import { procLabel } from "@/lib/dental/procedures";
import { regionLabel } from "@/lib/derm/regions";
import { useClinicalHistory } from "@/lib/history/hooks";
import { groupByDay } from "@/lib/history/grouping";
import { buildHistoryHref } from "@/lib/history/deeplink";
import type { ClinicalTimelineItem, HistoryFilter, HistorySource } from "@/lib/history/types";

const ICON: Record<HistorySource, typeof IconNotes> = {
  appointment: IconCalendarEvent,
  treatment_plan: IconClipboardList,
  dental_chart: IconDental,
  clinical_map: IconMap2,
  clinical_note: IconNotes,
};

/** One restrained accent: the source is told by icon + label, never by a rainbow of colours. */
const BADGE = "border-sky/30 bg-sky/10 text-sky";

const interpolate = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

/**
 * Patient Profile → History: ONE chronological list of every clinical note the patient has, read from the records that own them
 * (appointments, treatment plan, dental chart, clinical map). Nothing is copied: editing a note at its source updates this list.
 * Each entry is a real link (stable ids in the URL) to the exact original record.
 */
export default function ClinicalHistory({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");

  // debounce the search so a query is sent when typing pauses (not on every keystroke)
  useEffect(() => {
    const h = window.setTimeout(() => setQ(input.trim()), 300);
    return () => window.clearTimeout(h);
  }, [input]);

  const query = useClinicalHistory(patientId, filter, q);
  const items = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.items), [query.data]);
  const sources = query.data?.pages[0]?.sources ?? [];
  const today = todayLocal();
  const groups = useMemo(() => groupByDay(items, today), [items, today]);
  const filters: HistoryFilter[] = ["all", ...sources];
  const searching = q.length > 0;

  return (
    <section className="card relative overflow-hidden p-4" aria-label={t("ch.title")} data-testid="clinical-history">
      <div aria-hidden className="pointer-events-none absolute -top-16 end-0 h-40 w-64 rounded-full bg-sky/5 blur-3xl" />
      <div className="relative">
        <div className="mb-3">
          <h2 className="text-xs font-medium text-ink">{t("ch.title")}</h2>
          <p className="text-[11px] text-mute">{t("ch.subtitle")}</p>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("ch.filter")}>
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                data-testid={`history-filter-${f}`}
                onClick={() => setFilter(f)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ${
                  filter === f ? "border-teal bg-teal/15 text-teal" : "border-edge bg-card2 text-ink hover:border-sky"
                }`}
              >
                {t(`ch.f.${f}`)}
              </button>
            ))}
          </div>
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">{t("ch.search")}</span>
            <IconSearch size={13} aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              type="search"
              value={input}
              maxLength={80}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("ch.search")}
              data-testid="history-search"
              className="inp !py-1.5 !ps-8 !pe-7 !text-[12px]"
            />
            {input && (
              <button type="button" aria-label={t("ch.search.clear")} onClick={() => setInput("")} className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-mute hover:text-ink">
                <IconX size={12} />
              </button>
            )}
          </label>
        </div>

        {query.isLoading && (
          <div className="space-y-2" aria-busy="true" aria-label={t("ch.loading")}>
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-edge bg-card2" />)}
          </div>
        )}

        {query.isError && !query.isLoading && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/40 p-3 text-[12px] text-red-400">
            <IconAlertTriangle size={15} /> {t("ch.err.load")}
            <button type="button" className="btn-ghost ms-auto !px-2.5 !py-1 text-[11px]" onClick={() => void query.refetch()}>{t("ch.retry")}</button>
          </div>
        )}

        {!query.isLoading && !query.isError && items.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center" data-testid="history-empty">
            <IconNotes size={22} className="text-mute" />
            <div className="text-[13px] font-medium text-ink">{searching ? t("ch.empty.search") : filter === "all" ? t("ch.empty") : t("ch.empty.filter")}</div>
            {!searching && filter === "all" && <div className="max-w-xs text-[11px] text-mute">{t("ch.empty.hint")}</div>}
          </div>
        )}

        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.kind === "date" ? g.ymd : t(`ch.${g.kind}`)} data-testid="history-group" data-group={g.key}>
              <h3 className="mb-1.5 text-[10px] font-medium tracking-wide text-mute">
                {g.kind === "date" && g.ymd
                  ? fmtCalendarDate(g.ymd, lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()
                  : t(`ch.${g.kind}`).toUpperCase()}
              </h3>
              <ol className="relative space-y-2 ps-5">
                <span aria-hidden className="absolute inset-y-1 start-1.5 border-s border-dashed border-edge" />
                {g.items.map((it) => <Entry key={it.id} it={it} patientId={patientId} />)}
              </ol>
            </div>
          ))}
        </div>

        {query.hasNextPage && (
          <div className="flex justify-center pt-3">
            <button type="button" data-testid="history-more" className="btn-ghost !px-4 !py-1.5 text-xs disabled:opacity-50" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {query.isFetchingNextPage ? t("ch.loading") : t("ch.more")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Entry({ it, patientId }: { it: ClinicalTimelineItem; patientId: string }) {
  const { t, lang } = useI18n();
  const Icon = ICON[it.sourceType] ?? IconNotes;
  const href = it.sourceMissing ? null : buildHistoryHref(patientId, it.deepLink);
  const teeth = it.toothNumbers?.length ? it.toothNumbers : it.toothNumber ? [it.toothNumber] : [];
  const surfaces = it.surfaces?.length ? it.surfaces : it.surface ? [it.surface] : [];
  const treatment = it.treatment?.code ? procLabel(t, { procedureCode: it.treatment.code, customName: it.treatment.customName }) : it.treatment?.name || it.treatment?.customName;
  const regions = (it.regions ?? []).map((r) => regionLabel(r.id, lang));

  const body = (
    <>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`pill ${BADGE} inline-flex items-center gap-1`}>
          <Icon size={11} aria-hidden /> {t(`ch.badge.${it.sourceType}`)}
        </span>
        {teeth.length > 0 && <span className="pill border border-edge bg-soft text-ink">{teeth.length === 1 ? interpolate(t("ch.tooth"), { tooth: teeth[0] }) : teeth.join(", ")}{surfaces.length > 0 && <span className="ms-1 text-mute">· {surfaces.join("")}</span>}</span>}
        {treatment && <span className="text-[11px] text-ink">{treatment}{it.treatment?.sessionNumber ? <span className="text-mute"> · {interpolate(t("ch.session"), { n: it.treatment.sessionNumber })}</span> : null}</span>}
        {regions.length > 0 && <span className="text-[11px] text-mute">{regions.slice(0, 3).join(" · ")}{regions.length > 3 ? ` +${regions.length - 3}` : ""}</span>}
        {it.status === "entered_in_error" && <span className="pill bg-amber-500/15 text-amber-400">{t("ch.enteredInError")}</span>}
        <span className="ms-auto text-[10px] text-mute" dir="ltr">{fmtTime12(it.at)}</span>
      </header>
      <p dir="auto" className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink">{it.text}</p>
      <footer className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-mute">
        {it.doctorName && <span>{interpolate(t("ch.by"), { name: it.doctorName })}</span>}
        {it.edited && (
          <span className="inline-flex items-center gap-1 italic"><IconPencil size={10} aria-hidden /> {t("ch.edited")}</span>
        )}
        {it.sourceMissing ? (
          <span className="ms-auto inline-flex items-center gap-1 text-amber-400" data-testid="history-missing">
            <IconAlertTriangle size={11} aria-hidden /> {t("ch.missing")}
          </span>
        ) : href ? (
          <span className="ms-auto inline-flex items-center gap-1 text-sky"><IconArrowUpRight size={11} aria-hidden className="rtl:-scale-x-100" /> {t("ch.open")}</span>
        ) : null}
      </footer>
    </>
  );

  return (
    <li className="ch-in relative" data-testid="history-entry" data-source={it.sourceType} data-note-id={it.noteId} data-id={it.id}>
      <span aria-hidden className="absolute -start-5 top-3 h-3 w-3 rounded-full border border-sky/60 bg-sky/20" />
      {href ? (
        <Link href={href} className="ch-card block rounded-xl border border-edge bg-card2 px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-sky" aria-label={`${t(`ch.badge.${it.sourceType}`)} — ${t("ch.open")}`}>
          {body}
        </Link>
      ) : (
        <div className="rounded-xl border border-edge bg-card2 px-3 py-2.5">{body}</div>
      )}
    </li>
  );
}
