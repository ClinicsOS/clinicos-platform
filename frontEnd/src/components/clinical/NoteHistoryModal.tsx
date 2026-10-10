"use client";
import Modal from "@/components/Modal";
import { useI18n } from "@/lib/i18n";
import { fmtDate, fmtTime12 } from "@/lib/dates";
import { useNoteRevisions } from "@/lib/clinical/hooks";
import type { PersonRef } from "@/lib/clinical/types";

const stamp = (iso: string, lang: "en" | "ar") => `${fmtDate(iso, lang, { day: "numeric", month: "short", year: "numeric" })} · ${fmtTime12(iso)}`;

/**
 * "View edit history": the CURRENT text first, then every earlier version, newest edit first — each with who replaced it and
 * when. Read-only. No ids or technical fields are shown. Loaded on demand (the timeline never carries revisions).
 */
export default function NoteHistoryModal({ patientId, noteId, current, onClose }: { patientId: string; noteId: string; current: { text: string; at?: string; by?: PersonRef | null }; onClose: () => void }) {
  const { t, lang } = useI18n();
  const q = useNoteRevisions(patientId, noteId, true);
  return (
    <Modal title={t("cr.history.title")} size="lg" onClose={onClose}>
      <div className="space-y-3 px-5 py-4">
        <section className="rounded-lg border border-teal/40 bg-teal/5 p-3">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[10px] text-mute">
            <span className="rounded-full border border-teal/40 px-1.5 py-0.5 font-medium text-teal">{t("cr.history.current")}</span>
            {current.at && <span dir="ltr">{stamp(current.at, lang)}</span>}
            {current.by && <span>{t("cr.history.by")} {current.by.name}</span>}
          </div>
          <p dir="auto" className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink">{current.text}</p>
        </section>

        <h3 className="pt-1 text-[11px] font-medium tracking-wide text-mute">{t("cr.history.previous").toUpperCase()}</h3>
        {q.isLoading && <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-card2" />)}</div>}
        {q.isError && (
          <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
            {t("cr.history.err")} <button type="button" className="ms-2 underline" onClick={() => void q.refetch()}>{t("cr.retry")}</button>
          </div>
        )}
        {q.data && q.data.length === 0 && <p className="text-[11px] text-mute">{t("cr.history.none")}</p>}
        <ol className="space-y-2">
          {(q.data ?? []).map((r, i) => (
            <li key={`${r.editedAt}-${i}`} className="rounded-lg border border-edge bg-card2 p-3">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[10px] text-mute">
                <span>{t("cr.history.editedBy")} <span className="text-ink">{r.editedBy?.name ?? "—"}</span></span>
                <span dir="ltr">{stamp(r.editedAt, lang)}</span>
              </div>
              <p dir="auto" className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink/90">{r.text}</p>
              <div className="mt-1 text-[9px] text-mute" dir="ltr">{t("cr.history.version")}: {stamp(r.versionAt, lang)}</div>
            </li>
          ))}
        </ol>
        <div className="flex justify-end pt-1"><button type="button" className="btn-ghost text-xs" onClick={onClose}>{t("cr.close")}</button></div>
      </div>
    </Modal>
  );
}
