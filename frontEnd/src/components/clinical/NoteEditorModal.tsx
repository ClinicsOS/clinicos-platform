"use client";
import { useMemo, useRef, useState } from "react";
import axios from "axios";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/lib/i18n";
import { errMsg } from "@/lib/api";
import { useCreateNote, useUpdateNote, newRequestId } from "@/lib/clinical/hooks";
import type { ClinicalNote, NoteContext } from "@/lib/clinical/types";

export const NOTE_MAX = 5000;

/** What an edit starts from. `editCount` is sent back so an edit made from a stale screen is refused, never silently applied. */
export interface EditingNote { id: string; text: string; editCount: number }

/**
 * Add / edit ONE clinical note. Deliberately tiny: a text box. Patient, clinic, author, time and (when the dialog was
 * opened from a visit or a treatment) the record it belongs to are never asked for — the server derives / verifies them.
 */
export default function NoteEditorModal({ patientId, editing, context, onClose }: { patientId: string; editing?: EditingNote; context?: NoteContext; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const create = useCreateNote(patientId);
  const update = useUpdateNote(patientId);
  const requestId = useMemo(() => newRequestId(), []); // one per dialog: a double click / retry is the SAME note
  const lock = useRef(false); // stops a second click from even being sent (the server also de-duplicates)
  const [base, setBase] = useState<EditingNote | undefined>(editing); // the version the user is editing from
  const [text, setText] = useState(editing?.text ?? "");
  const [error, setError] = useState("");
  const [stale, setStale] = useState<ClinicalNote | null>(null);

  const busy = create.isPending || update.isPending;
  const trimmed = text.trim();
  const unchanged = !!base && trimmed === base.text.trim();
  const canSave = !busy && trimmed.length > 0 && trimmed.length <= NOTE_MAX && !unchanged;

  const save = async () => {
    if (!canSave || lock.current) return;
    lock.current = true;
    setError("");
    try {
      if (base) {
        await update.mutateAsync({ id: base.id, text: trimmed, expectedEditCount: base.editCount });
        toast.success(t("cr.note.updated"));
      } else {
        await create.mutateAsync({ text: trimmed, sourceType: context?.sourceType ?? "patient", ...(context?.sourceId ? { sourceId: context.sourceId } : {}), requestId });
        toast.success(t("cr.note.saved"));
      }
      onClose();
    } catch (e) {
      const data = axios.isAxiosError(e) ? (e.response?.data as { code?: string; note?: ClinicalNote } | undefined) : undefined;
      if (data?.code === "NOTE_CHANGED" && data.note) { setStale(data.note); setError(t("cr.note.changed")); }
      else if (data?.code === "NOTE_REVISION_LIMIT") setError(t("cr.note.limit"));
      else setError(errMsg(e, t("cr.note.err")));
    } finally { lock.current = false; }
  };

  // Someone else edited this note while the dialog was open: take their version as the new starting point (nothing is overwritten).
  const loadLatest = () => {
    if (!stale || !base) return;
    setBase({ id: base.id, text: stale.text, editCount: stale.editCount });
    setText(stale.text);
    setStale(null);
    setError("");
  };

  return (
    <Modal title={base ? t("cr.note.edit") : t("cr.note.new")} onClose={busy ? () => undefined : onClose}>
      <div className="space-y-3">
        {!base && context?.label && (
          <div className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-[11px] text-mute">
            {t("cr.note.about")}: <span className="text-ink" dir="auto">{context.label}</span>
          </div>
        )}
        <div>
          <label htmlFor="cr-note-text" className="lbl">{t("cr.note.label")}</label>
          <textarea
            id="cr-note-text" dir="auto" autoFocus rows={7} maxLength={NOTE_MAX} value={text} placeholder={t("cr.note.placeholder")}
            className="inp min-h-32 resize-y leading-relaxed" aria-invalid={!!error}
            onChange={(e) => { setText(e.target.value); setError(""); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-mute">
            <span>{base ? t("cr.note.editHint") : ""}</span>
            <span dir="ltr" className={text.length > NOTE_MAX - 200 ? "text-amber-400" : ""}>{text.length} / {NOTE_MAX}</span>
          </div>
        </div>
        {error && (
          <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">
            {error}
            {stale && <button type="button" className="ms-2 underline" onClick={loadLatest}>{t("cr.note.loadLatest")}</button>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={busy}>{t("dn.cancel")}</button>
          <button type="button" className="btn-teal text-xs disabled:opacity-50" onClick={save} disabled={!canSave}>
            {busy ? t("cr.note.saving") : base ? t("cr.note.saveEdit") : t("cr.note.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
