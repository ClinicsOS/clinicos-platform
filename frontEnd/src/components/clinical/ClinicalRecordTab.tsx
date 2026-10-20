"use client";
import { useEffect, useMemo, useState } from "react";
import { IconNotes, IconPlus, IconPencil, IconHistory, IconStethoscope, IconCalendarEvent, IconAlertTriangle } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { fmtDate, fmtTime12, ymd } from "@/lib/dates";
import { useClinicalTimeline } from "@/lib/clinical/hooks";
import type { NoteContext, TimelineEvent, TimelineFilter } from "@/lib/clinical/types";
import { procLabel } from "@/lib/dental/procedures";
import { TargetText } from "@/components/dental/treatment/shared";
import NoteEditorModal, { type EditingNote } from "./NoteEditorModal";
import NoteHistoryModal from "./NoteHistoryModal";
import FocusMissing from "@/components/history/FocusMissing";
import { useFocusTarget } from "@/lib/history/focus";

const FILTERS: TimelineFilter[] = ["all", "visit", "treatment", "note"];

const KIND_STYLE: Record<TimelineEvent["kind"], { dot: string; pill: string }> = {
  visit: { dot: "border-blue bg-blue/20", pill: "bg-blue/15 text-sky" },
  treatment: { dot: "border-teal bg-teal/20", pill: "bg-teal/15 text-teal" },
  note: { dot: "border-amber-400 bg-amber-500/20", pill: "bg-amber-500/15 text-amber-400" },
};
const VISIT_PILL: Record<string, string> = {
  confirmed: "bg-teal/15 text-teal", completed: "bg-teal/15 text-teal", scheduled: "bg-blue/15 text-sky", cancelled: "bg-red-500/15 text-red-400", no_show: "bg-amber-500/15 text-amber-400",
};

type NoteModal = { editing?: EditingNote; context?: NoteContext } | null;
type HistoryModal = { noteId: string; current: { text: string; at?: string; by?: { _id: string; name: string } | null } } | null;

/**
 * Patient File -> Clinical Record: ONE chronological timeline of what happened to the patient (visits, dental treatment
 * milestones, clinical notes). Everything shown is derived by the server from the record that owns it, so an event is
 * listed once, however many screens also show it. Newest first, loaded 20 at a time.
 */
export default function ClinicalRecordTab({ patientId, canWrite, focusNote, focusRun = "" }: { patientId: string; canWrite: boolean; focusNote?: string | null; focusRun?: string }) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [noteModal, setNoteModal] = useState<NoteModal>(null);
  const [history, setHistory] = useState<HistoryModal>(null);
  const q = useClinicalTimeline(patientId, filter);

  const events = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.events), [q.data]);
  // PHASE 3 deep link to a note: keep loading older pages (a bounded number) until the linked note is on screen — by id, never by position.
  const linkedFound = !!focusNote && events.some((e) => e.noteId === focusNote);
  const pagesLoaded = q.data?.pages.length ?? 0;
  useEffect(() => {
    if (focusNote && filter === "all" && !linkedFound && q.hasNextPage && !q.isFetchingNextPage && pagesLoaded < 25) void q.fetchNextPage();
  }, [focusNote, filter, linkedFound, q.hasNextPage, q.isFetchingNextPage, pagesLoaded, q]);
  const linkedMissing = !!focusNote && !q.isLoading && !q.isError && filter === "all" && !linkedFound && !q.hasNextPage;
  // group by the CLINIC's calendar day (Phase 1 rule: never the browser's zone)
  const days = useMemo(() => {
    const out: { day: string; at: string; items: TimelineEvent[] }[] = [];
    for (const e of events) {
      const d = ymd(e.at);
      const last = out[out.length - 1];
      if (last && last.day === d) last.items.push(e);
      else out.push({ day: d, at: e.at, items: [e] });
    }
    return out;
  }, [events]);

  const visitContext = (e: TimelineEvent): NoteContext => ({
    sourceType: "appointment", sourceId: e.appointmentId,
    label: `${t("cr.type.visit")} · ${fmtDate(e.at, lang, { day: "numeric", month: "short", year: "numeric" })} ${fmtTime12(e.at)}`,
  });

  return (
    <div className="space-y-3">
      {linkedMissing && <FocusMissing run={focusRun} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-ink">{t("cr.title")}</h2>
          <p className="text-[11px] text-mute">{t("cr.subtitle")}</p>
        </div>
        {canWrite && (
          <button type="button" className="btn-teal !px-3 !py-1.5 text-xs" onClick={() => setNoteModal({})}>
            <IconPlus size={13} /> {t("cr.addNote")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("cr.filter")}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${filter === f ? "border-teal bg-teal/15 text-teal" : "border-edge bg-card2 text-ink hover:border-sky"}`}>
            {t(`cr.f.${f}`)}
          </button>
        ))}
      </div>

      {q.isLoading && (
        <div className="space-y-2" aria-busy="true" aria-label={t("dn.loading")}>
          {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl border border-edge bg-card" />)}
        </div>
      )}

      {q.isError && !q.isLoading && (
        <div role="alert" className="card flex items-center gap-2 border-red-500/40 p-3 text-[12px] text-red-400">
          <IconAlertTriangle size={15} /> {t("cr.err.load")}
          <button type="button" className="btn-ghost ms-auto !px-2.5 !py-1 text-[11px]" onClick={() => void q.refetch()}>{t("cr.retry")}</button>
        </div>
      )}

      {!q.isLoading && !q.isError && events.length === 0 && (
        <div className="card flex flex-col items-center gap-1 px-4 py-10 text-center">
          <IconNotes size={22} className="text-mute" />
          <div className="text-[13px] font-medium text-ink">{filter === "all" ? t("cr.empty") : t("cr.empty.filter")}</div>
          <div className="max-w-xs text-[11px] text-mute">{t("cr.empty.hint")}</div>
          {canWrite && filter !== "visit" && filter !== "treatment" && (
            <button type="button" className="btn-teal mt-2 !px-3 !py-1.5 text-xs" onClick={() => setNoteModal({})}><IconPlus size={13} /> {t("cr.addNote")}</button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {days.map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h3 className="mb-1.5 text-[10px] font-medium tracking-wide text-mute">{fmtDate(g.at, lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()}</h3>
            <ol className="relative space-y-2 ps-5">
              <span aria-hidden className="absolute inset-y-1 start-1.5 border-s border-dashed border-edge" />
              {g.items.map((e) => (
                <Entry key={e.key} e={e} canWrite={canWrite}
                  onAddVisitNote={() => setNoteModal({ context: visitContext(e) })}
                  onEdit={() => e.noteId && setNoteModal({ editing: { id: e.noteId, text: e.content ?? "", editCount: e.editCount ?? 0 } })}
                  onHistory={() => e.noteId && setHistory({ noteId: e.noteId, current: { text: e.content ?? "", at: e.edited?.at, by: e.edited?.by } })} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      {q.hasNextPage && (
        <div className="flex justify-center pt-1">
          <button type="button" className="btn-ghost !px-4 !py-1.5 text-xs disabled:opacity-50" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? t("dn.loading") : t("cr.more")}
          </button>
        </div>
      )}

      {noteModal && <NoteEditorModal patientId={patientId} editing={noteModal.editing} context={noteModal.context} onClose={() => setNoteModal(null)} />}
      {history && <NoteHistoryModal patientId={patientId} noteId={history.noteId} current={history.current} onClose={() => setHistory(null)} />}
    </div>
  );
}

function Entry({ e, canWrite, onAddVisitNote, onEdit, onHistory }: { e: TimelineEvent; canWrite: boolean; onAddVisitNote: () => void; onEdit: () => void; onHistory: () => void }) {
  const { t, lang } = useI18n();
  const style = KIND_STYLE[e.kind];
  const isSessionNote = e.event === "session_note";
  const typeLabel = e.kind === "visit" ? t("cr.type.visit") : e.kind === "treatment" ? t("cr.type.treatment") : isSessionNote ? t("cr.type.sessionNote") : t("cr.type.note");
  const hasTreatment = !!e.context.procedureCode;
  const f = useFocusTarget("note", e.noteId);

  return (
    <li ref={f.ref} {...f.attrs} className={`relative ${f.className}`} data-testid="timeline-entry" data-key={e.key} data-kind={e.kind} data-event={e.event}>
      <span aria-hidden className={`absolute -start-5 top-3 h-3 w-3 rounded-full border ${style.dot}`} />
      <article className="rounded-xl border border-edge bg-card2 px-3 py-2.5">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`pill ${style.pill} inline-flex items-center gap-1`}>
            {e.kind === "visit" ? <IconCalendarEvent size={11} /> : e.kind === "treatment" ? <IconStethoscope size={11} /> : <IconNotes size={11} />}
            {typeLabel}
          </span>
          {e.kind === "visit" && <span className={`pill ${VISIT_PILL[e.event] ?? "bg-soft text-mute"}`}>{t(`status.${e.event}`)}</span>}
          {e.kind === "visit" && e.context.visitType === "procedure" && <span className="pill bg-purple-500/15 text-[8px] text-purple-300">{t("visit.procedureBadge")}</span>}
          {e.kind === "visit" && e.context.visitSource === "walk_in" && <span className="pill bg-sky/15 text-[8px] text-sky">{t("ap.walkInBadge")}</span>}
          {e.kind === "treatment" && <span className="text-[11px] font-medium text-ink">{t(`cr.ev.${e.event}`)}</span>}
          <span className="ms-auto text-[10px] text-mute" dir="ltr">{fmtTime12(e.at)}</span>
        </header>

        {(hasTreatment || (e.kind === "note" && e.context.visitAt)) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {hasTreatment && (
              <>
                <span className="text-ink">{procLabel(t, { procedureCode: e.context.procedureCode!, customName: e.context.customName })}</span>
                <span className="text-mute"><TargetText targetType={e.context.targetType ?? "tooth"} toothNumbers={e.context.toothNumbers ?? []} surfaces={e.context.surfaces ?? []} /></span>
              </>
            )}
            {e.kind === "note" && e.context.visitAt && (
              <span className="text-mute">{t("cr.type.visit")} · <span dir="ltr">{fmtDate(e.context.visitAt, lang, { day: "numeric", month: "short" })} {fmtTime12(e.context.visitAt)}</span></span>
            )}
          </div>
        )}

        {e.content ? (
          <p dir="auto" className={`mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed ${e.kind === "visit" ? "text-mute" : "text-ink"}`}>
            {e.kind === "visit" ? <>&ldquo;{e.content}&rdquo;</> : e.content}
          </p>
        ) : e.kind === "visit" ? (
          <p className="mt-1 text-[10px] italic text-mute/70">{t("pp.noVisitNote")}</p>
        ) : null}
        {e.kind === "visit" && e.event === "cancelled" && e.reason && <p className="mt-0.5 text-[11px] text-red-400">{e.reason}</p>}
        {e.kind === "treatment" && e.event === "cancelled" && e.reason && <p className="mt-0.5 text-[11px] italic text-mute">{e.reason}</p>}

        <footer className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-mute">
          {e.by && <span>{e.by.name}</span>}
          {e.kind === "note" && (e.editCount ?? 0) > 0 && e.edited && (
            <>
              <span className="italic" dir="ltr">{t("cr.edited")} · {fmtDate(e.edited.at, lang, { day: "numeric", month: "short" })} {fmtTime12(e.edited.at)}</span>
              <button type="button" className="inline-flex items-center gap-1 text-sky hover:underline" onClick={onHistory}><IconHistory size={11} /> {t("cr.viewHistory")}</button>
            </>
          )}
          <span className="ms-auto flex items-center gap-2">
            {e.kind === "note" && e.editable && canWrite && (
              <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={onEdit}><IconPencil size={11} /> {t("dn.edit")}</button>
            )}
            {e.kind === "visit" && canWrite && e.appointmentId && (
              <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={onAddVisitNote}><IconPlus size={11} /> {t("cr.addNoteShort")}</button>
            )}
          </span>
        </footer>
      </article>
    </li>
  );
}
