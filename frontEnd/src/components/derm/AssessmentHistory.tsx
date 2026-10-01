"use client";
import { useState } from "react";
import { IconAlertTriangle, IconPencil, IconRefresh } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { SkeletonList } from "@/components/Skeleton";
import type { RecordType, SurfaceId } from "@/lib/derm/regions";
import { DERM_MAX_TEXT, type DermAssessment } from "@/lib/derm/types";
import { dermErrorCode, flattenAssessments, useDermAssessments, useEditAssessment, useVoidAssessment } from "@/lib/derm/hooks";
import { RecordTypeBadge, RegionChip, fmtDate, fmtDateTime } from "./dermUi";

const FIELD_KEYS = [
  ["concern", "dm.field.concern"],
  ["findings", "dm.field.findings"],
  ["diagnosis", "dm.field.diagnosis"],
  ["notes", "dm.field.notes"],
] as const;

const EDIT_ERRORS: Record<string, string> = {
  STALE: "dm.err.stale",
  ENTERED_IN_ERROR: "dm.err.voided",
  EMPTY_ASSESSMENT: "dm.err.empty",
  FORBIDDEN: "dm.err.forbidden",
  NETWORK: "dm.err.network",
};

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-mute">{label}</div>
      <p className="whitespace-pre-wrap break-words text-xs text-ink">{value}</p>
    </div>
  );
}

interface CardProps {
  a: DermAssessment;
  patientId: string;
  canWrite: boolean;
  onSelectRegion?: (id: string, surface?: SurfaceId) => void;
  highlightRegionId?: string | null;
  /** Phase 2: "Add treatment" from this assessment (regions / record type / diagnosis carry over). */
  onAddTreatment?: (a: DermAssessment) => void;
}

export function AssessmentCard({ a, patientId, canWrite, onSelectRegion, highlightRegionId, onAddTreatment }: CardProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const edit = useEditAssessment(patientId);
  const voidMut = useVoidAssessment(patientId);
  const [mode, setMode] = useState<"view" | "edit" | "void">("view");
  const [draft, setDraft] = useState({ concern: a.concern, findings: a.findings, diagnosis: a.diagnosis, notes: a.notes });
  const [voidNote, setVoidNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const voided = a.status === "entered_in_error";

  const startEdit = () => { setDraft({ concern: a.concern, findings: a.findings, diagnosis: a.diagnosis, notes: a.notes }); setError(null); setMode("edit"); };

  const saveEdit = async () => {
    setError(null);
    if (!draft.concern.trim() && !draft.findings.trim()) { setError(t("dm.err.empty")); return; }
    try {
      await edit.mutateAsync({
        assessmentId: a._id, rev: a.rev,
        concern: draft.concern.trim(), findings: draft.findings.trim(), diagnosis: draft.diagnosis.trim(), notes: draft.notes.trim(),
      });
      toast.success(t("dm.edited"));
      setMode("view");
    } catch (e) {
      const code = dermErrorCode(e);
      // typed text stays in the draft; STALE also refetches the list (the hook does) so the newer version is visible
      setError(t((code && EDIT_ERRORS[code]) || "dm.err.generic"));
    }
  };

  const doVoid = async () => {
    setError(null);
    try {
      await voidMut.mutateAsync({ assessmentId: a._id, note: voidNote.trim() });
      toast.success(t("dm.voided"));
      setMode("view");
    } catch (e) {
      const code = dermErrorCode(e);
      setError(t((code && EDIT_ERRORS[code]) || "dm.err.generic"));
    }
  };

  const visitText = a.visit ? fmtDateTime(a.visit.startAt, lang) : a.appointmentId ? t("dm.visitLinked") : null;

  return (
    <article className={`rounded-xl border border-edge bg-card2 p-3 ${voided ? "opacity-60" : ""}`} aria-label={`${t(`dm.type.${a.recordType}`)} · ${fmtDate(a.createdAt, lang)}`}>
      <header className="flex flex-wrap items-center gap-2">
        <RecordTypeBadge type={a.recordType} />
        <span className="text-[11px] text-mute">{fmtDateTime(a.createdAt, lang)}</span>
        {a.edited && <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] text-mute" title={a.lastEditedAt ? fmtDateTime(a.lastEditedAt, lang) : undefined}>{t("dm.edited.tag")}</span>}
        {voided && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"><IconAlertTriangle size={11} />{t("dm.voided.tag")}</span>}
        {a.createdBy?.name && <span className="ms-auto text-[11px] text-mute">{a.createdBy.name}</span>}
      </header>

      <div className="mt-2 flex flex-wrap gap-1">
        {a.regions.map((r) => (
          <RegionChip key={r.id + (r.surface ?? "")} id={r.id} surface={r.surface} active={highlightRegionId === r.id} onClick={onSelectRegion ? () => onSelectRegion(r.id, r.surface) : undefined} />
        ))}
      </div>
      {(a.markers.length > 0 || visitText) && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-mute">
          {a.markers.length > 0 && <span>{t("dm.markedSpots").replace("{n}", String(a.markers.length))}</span>}
          {visitText && <span>{t("dm.visitPrefix")}: {visitText}</span>}
        </div>
      )}

      {mode === "edit" ? (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
          {FIELD_KEYS.map(([k, lk]) => (
            <div key={k}>
              <label className="lbl" htmlFor={`e-${a._id}-${k}`}>{t(lk)}</label>
              {k === "concern" || k === "diagnosis" ? (
                <input id={`e-${a._id}-${k}`} className="inp" maxLength={DERM_MAX_TEXT[k]} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              ) : (
                <textarea id={`e-${a._id}-${k}`} className="inp min-h-[64px]" maxLength={DERM_MAX_TEXT[k]} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              )}
            </div>
          ))}
          <p className="text-[11px] text-mute">{t("dm.edit.note")}</p>
          {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setMode("view")} disabled={edit.isPending}>{t("dm.cancel")}</button>
            <button type="submit" className="btn-teal" disabled={edit.isPending}>{edit.isPending ? t("dm.saving") : t("dm.save")}</button>
          </div>
        </form>
      ) : (
        <div className="mt-2 space-y-1.5">
          {FIELD_KEYS.map(([k, lk]) => <Field key={k} label={t(lk)} value={a[k]} />)}
          {voided && a.resolution && (
            <div className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
              {t("dm.voided.by").replace("{name}", a.resolution.by?.name ?? "—")} · {fmtDate(a.resolution.at, lang)}
              {a.resolution.note ? ` — ${a.resolution.note}` : ""}
            </div>
          )}
        </div>
      )}

      {mode === "void" && (
        <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          <p className="text-xs text-amber-100">{t("dm.void.explain")}</p>
          <label className="lbl" htmlFor={`v-${a._id}`}>{t("dm.void.reason")}</label>
          <input id={`v-${a._id}`} className="inp" maxLength={DERM_MAX_TEXT.voidNote} value={voidNote} onChange={(e) => setVoidNote(e.target.value)} />
          {error && <div role="alert" className="text-xs text-red-300">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setMode("view")} disabled={voidMut.isPending}>{t("dm.cancel")}</button>
            <button type="button" className="btn-teal" onClick={() => void doVoid()} disabled={voidMut.isPending}>{voidMut.isPending ? t("dm.saving") : t("dm.void.confirm")}</button>
          </div>
        </div>
      )}

      {canWrite && !voided && mode === "view" && (
        <div className="mt-2 flex flex-wrap justify-end gap-3 border-t border-edge pt-2">
          {onAddTreatment && <button type="button" className="me-auto inline-flex items-center gap-1 rounded-lg border border-teal/50 bg-teal/10 px-2.5 py-1 text-[11px] font-medium text-teal hover:bg-teal/20" onClick={() => onAddTreatment(a)}>{t("dt.addFromAssessment")}</button>}
          <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-blue hover:underline" onClick={startEdit}><IconPencil size={12} />{t("dm.edit")}</button>
          <button type="button" className="text-[11px] text-mute hover:text-amber-300" onClick={() => { setError(null); setMode("void"); }}>{t("dm.void")}</button>
        </div>
      )}
    </article>
  );
}

function ListState({ q, empty }: { q: ReturnType<typeof useDermAssessments>; empty: string }) {
  const { t } = useI18n();
  if (q.isLoading) return <SkeletonList rows={3} />;
  if (q.isError) {
    return (
      <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
        {t("dm.err.load")}
        <button type="button" className="ms-2 inline-flex items-center gap-1 underline" onClick={() => void q.refetch()}><IconRefresh size={12} />{t("dm.retry")}</button>
      </div>
    );
  }
  const n = flattenAssessments(q.data?.pages).length;
  if (n === 0) return <p className="rounded-xl border border-dashed border-edge p-4 text-center text-xs text-mute">{empty}</p>;
  return null;
}

function LoadMore({ q }: { q: ReturnType<typeof useDermAssessments> }) {
  const { t } = useI18n();
  if (!q.hasNextPage) return null;
  return (
    <button type="button" className="btn-ghost w-full" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
      {q.isFetchingNextPage ? t("common.loading") : t("dm.loadMore")}
    </button>
  );
}

/** Area History: every assessment linked to `regionId` — a multi-region record shows up under EACH of its regions. */
export function AreaHistory({
  patientId, regionId, canWrite, onSelectRegion,
}: { patientId: string; regionId: string; canWrite: boolean; onSelectRegion?: (id: string, surface?: SurfaceId) => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<RecordType | "all">("all");
  const [voided, setVoided] = useState(false);
  const q = useDermAssessments(patientId, { regionId, recordType: type === "all" ? undefined : type, includeVoided: voided });
  const items = flattenAssessments(q.data?.pages);
  return (
    <section aria-label={t("dm.area.title")} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "dermatology", "aesthetic"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${type === k ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-mute hover:text-ink"}`}>
            {k === "all" ? t("dm.filter.all") : t(`dm.type.${k}`)}
          </button>
        ))}
        <label className="ms-auto flex items-center gap-1.5 text-[11px] text-mute">
          <input type="checkbox" className="accent-teal" checked={voided} onChange={(e) => setVoided(e.target.checked)} />{t("dm.showVoided")}
        </label>
      </div>
      <ListState q={q} empty={t("dm.area.empty")} />
      <div className="space-y-2">
        {items.map((a) => <AssessmentCard key={a._id} a={a} patientId={patientId} canWrite={canWrite} onSelectRegion={onSelectRegion} highlightRegionId={regionId} />)}
      </div>
      <LoadMore q={q} />
    </section>
  );
}

/** Patient-level timeline: everything, newest first, across all regions — one entry per record (never one per region). */
export function PatientTimeline({
  patientId, canWrite, onSelectRegion,
}: { patientId: string; canWrite: boolean; onSelectRegion?: (id: string, surface?: SurfaceId) => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<RecordType | "all">("all");
  const q = useDermAssessments(patientId, { recordType: type === "all" ? undefined : type });
  const items = flattenAssessments(q.data?.pages);
  return (
    <section aria-label={t("dm.timeline.title")} className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(["all", "dermatology", "aesthetic"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${type === k ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-mute hover:text-ink"}`}>
            {k === "all" ? t("dm.filter.all") : t(`dm.type.${k}`)}
          </button>
        ))}
      </div>
      <ListState q={q} empty={t("dm.timeline.empty")} />
      <div className="space-y-2">
        {items.map((a) => <AssessmentCard key={a._id} a={a} patientId={patientId} canWrite={canWrite} onSelectRegion={onSelectRegion} />)}
      </div>
      <LoadMore q={q} />
    </section>
  );
}
