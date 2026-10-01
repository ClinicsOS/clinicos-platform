"use client";
import { useState } from "react";
import { IconPencil } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { MAX_FOLLOWUP_TEXT } from "@/lib/derm/procedures";
import type { FollowUp, TreatmentSession } from "@/lib/derm/treatmentTypes";
import { sessionGroups, sessionProcedureName } from "@/lib/derm/reportModel";
import { useEditFollowUp, useVoidFollowUp } from "@/lib/derm/treatmentHooks";
import { RecordTypeBadge, RegionChip, fmtDate, fmtDateTime } from "../dermUi";
import { treatmentErrorKey, useProcLabel } from "./shared";

const FIELDS = [["clinicianAssessment", "dt.fu.assessment"], ["progress", "dt.fu.progress"], ["complications", "dt.fu.complications"], ["notes", "dt.fu.notes"], ["nextStep", "dt.fu.nextStep"]] as const;

/** One recorded follow-up (view / edit text + outcome / mark entered in error). Links and regions are immutable. */
export default function FollowUpCard({ f, patientId, canWrite, procedureCode, session, onViewMap }: { f: FollowUp; patientId: string; canWrite: boolean; procedureCode?: string; session?: TreatmentSession; onViewMap?: (ids: string[]) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const procLabel = useProcLabel();
  const edit = useEditFollowUp(patientId);
  const voidMut = useVoidFollowUp(patientId);
  const [mode, setMode] = useState<"view" | "edit" | "void">("view");
  const [draft, setDraft] = useState({ clinicianAssessment: f.clinicianAssessment, progress: f.progress, complications: f.complications, notes: f.notes, nextStep: f.nextStep, outcome: f.outcome ?? "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const voided = f.status === "entered_in_error";

  const save = async () => {
    setError(null);
    try {
      await edit.mutateAsync({ followUpId: f._id, rev: f.rev, ...draft, outcome: (draft.outcome || null) as FollowUp["outcome"] | null });
      toast.success(t("dt.saved.updated")); setMode("view");
    } catch (e) { setError(t(treatmentErrorKey(e))); }
  };
  const doVoid = async () => {
    setError(null);
    try { await voidMut.mutateAsync({ followUpId: f._id, note: note.trim() }); toast.success(t("dt.fu.voidedToast")); setMode("view"); } catch (e) { setError(t(treatmentErrorKey(e))); }
  };

  return (
    <article className={`rounded-xl border border-edge bg-card2 p-3 ${voided ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <RecordTypeBadge type={f.recordType} />
        <span className="rounded-full border border-edge bg-soft px-2 py-0.5 text-[10px] font-medium text-ink">{t("dt.fu.badge")}</span>
        {f.outcome && <span className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-[10px] font-medium text-teal">{t(`dt.fu.o.${f.outcome}`)}</span>}
        {voided && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">{t("dm.voided.tag")}</span>}
        <span className="ms-auto text-[10px] text-mute">{fmtDateTime(f.createdAt, lang)}{f.createdBy ? ` · ${f.createdBy.name}` : ""}{f.edited ? ` · ${t("dt.fu.edited")}` : ""}</span>
      </div>
      {procedureCode && <div className="mt-1 text-[11px] text-mute">{procLabel(procedureCode)}</div>}
      {f.regions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {f.regions.map((r) => <RegionChip key={r.id} id={r.id} surface={r.surface} onClick={onViewMap ? () => onViewMap(f.regions.map((x) => x.id)) : undefined} />)}
        </div>
      )}
      {mode === "edit" ? (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {FIELDS.map(([k, lk]) => (
            <div key={k}>
              <label className="lbl" htmlFor={`e-${f._id}-${k}`}>{t(lk)}</label>
              <textarea id={`e-${f._id}-${k}`} className="inp min-h-[44px]" maxLength={k === "nextStep" ? MAX_FOLLOWUP_TEXT.nextStep : MAX_FOLLOWUP_TEXT.notes} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </div>
          ))}
          {error && <div role="alert" className="text-xs text-red-300">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setMode("view")} disabled={edit.isPending}>{t("dm.cancel")}</button>
            <button type="submit" className="btn-teal" disabled={edit.isPending}>{edit.isPending ? t("dm.saving") : t("dm.save")}</button>
          </div>
        </form>
      ) : (
        <div className="mt-2 space-y-1.5">
          {FIELDS.map(([k, lk]) => f[k] ? (
            <div key={k}><div className="text-[10px] font-medium uppercase tracking-wide text-mute">{t(lk)}</div><p className="whitespace-pre-wrap break-words text-xs text-ink">{f[k]}</p></div>
          ) : null)}
          {session && (() => {
            const groups = sessionGroups(session);
            const bits = groups.flatMap((g) => g.rows.filter((r) => ["name", "brand", "lotNumber", "identifier"].includes(r.key)).map((r) => r.value));
            return (
              <div className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-[11px] text-mute" data-linked-session>
                <span className="font-medium text-ink">{t("dr.fu.linkedSession")}</span>: {sessionProcedureName(session, lang)} · {t("dt.session.no").replace("{n}", String(session.sessionNumber))} · {fmtDate(session.startedAt, lang)}
                {bits.length > 0 && <> · {bits.join(" · ")}</>}
              </div>
            );
          })()}
          {voided && f.resolution && <div className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">{t("dm.voided.by").replace("{name}", f.resolution.by?.name ?? "—")} · {fmtDate(f.resolution.at, lang)}{f.resolution.note ? ` — ${f.resolution.note}` : ""}</div>}
        </div>
      )}
      {mode === "void" && (
        <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          <p className="text-xs text-amber-100">{t("dt.fu.voidExplain")}</p>
          <input className="inp" aria-label={t("dm.void.reason")} placeholder={t("dm.void.reason")} maxLength={MAX_FOLLOWUP_TEXT.voidNote} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <div role="alert" className="text-xs text-red-300">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setMode("view")} disabled={voidMut.isPending}>{t("dm.cancel")}</button>
            <button type="button" className="btn-teal" onClick={() => void doVoid()} disabled={voidMut.isPending}>{t("dm.void.confirm")}</button>
          </div>
        </div>
      )}
      {canWrite && !voided && mode === "view" && (
        <div className="mt-2 flex justify-end gap-3 border-t border-edge pt-2">
          <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-blue hover:underline" onClick={() => { setDraft({ clinicianAssessment: f.clinicianAssessment, progress: f.progress, complications: f.complications, notes: f.notes, nextStep: f.nextStep, outcome: f.outcome ?? "" }); setError(null); setMode("edit"); }}><IconPencil size={12} />{t("dm.edit")}</button>
          <button type="button" className="text-[11px] text-mute hover:text-amber-300" onClick={() => { setError(null); setMode("void"); }}>{t("dm.void")}</button>
        </div>
      )}
    </article>
  );
}
