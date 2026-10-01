"use client";
import { useMemo, useRef, useState } from "react";
import { IconChevronDown, IconChevronUp, IconCrosshair, IconX } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { RECORD_TYPES, type RecordType } from "@/lib/derm/regions";
import { DERM_MAX_TEXT, type DermAssessment, type DermMarker, type DermRegionRef } from "@/lib/derm/types";
import { dermErrorCode, newRequestId, useCreateAssessment } from "@/lib/derm/hooks";
import { RegionChip, TypeGlyph, fmtDateTime, useRegionText } from "./dermUi";

export interface VisitOption { _id: string; startAt: string; status: string; type?: string; visitType?: string }

interface Props {
  patientId: string;
  regions: DermRegionRef[];
  visits: VisitOption[];
  defaultVisitId?: string | null;
  markers: DermMarker[];
  placingRegion: string | null;
  onPlaceMarker: (regionId: string | null) => void;
  onRemoveMarker: (regionId: string) => void;
  onSaved: (a: DermAssessment) => void;
  onCancel: () => void;
}

const ERROR_KEYS: Record<string, string> = {
  EMPTY_ASSESSMENT: "dm.err.empty",
  INVALID_REGION: "dm.err.region",
  INVALID_MARKER: "dm.err.marker",
  VISIT_NOT_ACTIVE: "dm.err.visit",
  FORBIDDEN: "dm.err.forbidden",
  SPECIALTY_FORBIDDEN: "dm.err.forbidden",
  NETWORK: "dm.err.network",
  DUPLICATE_REQUEST: "dm.err.duplicate",
};

function Counter({ value, max }: { value: string; max: number }) {
  const near = value.length > max * 0.9;
  return <span className={`text-[10px] ${near ? "text-amber-400" : "text-mute"}`}>{value.length}/{max}</span>;
}

export default function AssessmentForm({
  patientId, regions, visits, defaultVisitId, markers, placingRegion, onPlaceMarker, onRemoveMarker, onSaved, onCancel,
}: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const regionText = useRegionText();
  // Reuses the app-wide appointment status labels; an unknown status falls back to the raw value (never a blank label).
  const statusText = (s: string) => (t(`status.${s}`) === `status.${s}` ? s : t(`status.${s}`));
  const create = useCreateAssessment(patientId);
  // One id per opened form: a retry after a network error re-sends the SAME id, so the server can never save it twice.
  const requestId = useRef(newRequestId());

  const [recordType, setRecordType] = useState<RecordType | null>(null);
  const [concern, setConcern] = useState("");
  const [findings, setFindings] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [more, setMore] = useState(false);
  const [visitId, setVisitId] = useState<string>(defaultVisitId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const usable = useMemo(
    () => visits.filter((v) => v.type !== "blocked" && v.status !== "cancelled" && v.status !== "no_show")
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()),
    [visits]
  );
  const regionIds = new Set(regions.map((r) => r.id));
  const markerByRegion = new Map(markers.filter((m) => regionIds.has(m.regionId)).map((m) => [m.regionId, m]));

  const missingType = recordType === null;
  const missingText = !concern.trim() && !findings.trim();
  const blocked = missingType || missingText;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (blocked) return;
    try {
      const res = await create.mutateAsync({
        clientRequestId: requestId.current,
        recordType: recordType!,
        regions,
        markers: Array.from(markerByRegion.values()),
        concern: concern.trim() || undefined,
        findings: findings.trim() || undefined,
        diagnosis: diagnosis.trim() || undefined,
        notes: notes.trim() || undefined,
        appointmentId: visitId || null,
      });
      toast.success(t("dm.saved"));
      onSaved(res.assessment);
    } catch (e) {
      // Everything the clinician typed is kept — only the error is shown.
      const code = dermErrorCode(e);
      setError(t((code && ERROR_KEYS[code]) || "dm.err.generic"));
    }
  };

  const label = "lbl";
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      noValidate
      aria-label={t("dm.form.title")}
    >
      <div>
        <div className="lbl">{t("dm.form.regions")}</div>
        <div className="flex flex-wrap gap-1.5">
          {regions.map((r) => <RegionChip key={r.id + (r.surface ?? "")} id={r.id} surface={r.surface} />)}
        </div>
        <p className="mt-1 text-[11px] text-mute">{regions.length > 1 ? t("dm.form.oneRecordMany") : t("dm.form.oneRecord")}</p>
      </div>

      <fieldset>
        <legend className={label}>{t("dm.form.type")} <span className="text-red-400">*</span></legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("dm.form.type")}>
          {RECORD_TYPES.map((rt) => {
            const on = recordType === rt;
            return (
              <button
                key={rt}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setRecordType(rt)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-start text-xs transition-colors ${on ? "border-teal bg-teal/15 text-ink" : "border-edge bg-soft text-mute hover:text-ink"}`}
              >
                <TypeGlyph type={rt} size={12} />
                <span className="font-medium">{t(`dm.type.${rt}`)}</span>
              </button>
            );
          })}
        </div>
        {touched && missingType && <p className="mt-1 text-[11px] text-red-400" role="alert">{t("dm.form.typeRequired")}</p>}
      </fieldset>

      <div>
        <div className="flex items-center justify-between"><label className={label} htmlFor="dm-concern">{t("dm.form.concern")}</label><Counter value={concern} max={DERM_MAX_TEXT.concern} /></div>
        <textarea id="dm-concern" className="inp min-h-[56px]" maxLength={DERM_MAX_TEXT.concern} value={concern} onChange={(e) => setConcern(e.target.value)} placeholder={t("dm.form.concernHint")} />
      </div>
      <div>
        <div className="flex items-center justify-between"><label className={label} htmlFor="dm-findings">{t("dm.form.findings")}</label><Counter value={findings} max={DERM_MAX_TEXT.findings} /></div>
        <textarea id="dm-findings" className="inp min-h-[84px]" maxLength={DERM_MAX_TEXT.findings} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder={t("dm.form.findingsHint")} />
        {touched && missingText && <p className="mt-1 text-[11px] text-red-400" role="alert">{t("dm.err.empty")}</p>}
      </div>

      <button type="button" className="flex items-center gap-1 text-[11px] font-medium text-blue hover:underline" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />} {t("dm.form.more")}
      </button>

      {more && (
        <div className="space-y-3 dn-fade-in">
          <div>
            <div className="flex items-center justify-between"><label className={label} htmlFor="dm-diagnosis">{t("dm.form.diagnosis")}</label><Counter value={diagnosis} max={DERM_MAX_TEXT.diagnosis} /></div>
            <input id="dm-diagnosis" className="inp" maxLength={DERM_MAX_TEXT.diagnosis} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
            <p className="mt-1 text-[11px] text-mute">{t("dm.form.diagnosisNote")}</p>
          </div>
          <div>
            <div className="flex items-center justify-between"><label className={label} htmlFor="dm-notes">{t("dm.form.notes")}</label><Counter value={notes} max={DERM_MAX_TEXT.notes} /></div>
            <textarea id="dm-notes" className="inp min-h-[64px]" maxLength={DERM_MAX_TEXT.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="dm-visit">{t("dm.form.visit")}</label>
            <select id="dm-visit" className="inp" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
              <option value="">{t("dm.form.noVisit")}</option>
              {usable.map((v) => (
                <option key={v._id} value={v._id}>{fmtDateTime(v.startAt, lang)} · {statusText(v.status)}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-mute">{t("dm.form.visitNote")}</p>
          </div>
          <div>
            <div className={label}>{t("dm.form.marker")}</div>
            <p className="mb-1.5 text-[11px] text-mute">{t("dm.form.markerNote")}</p>
            <ul className="space-y-1.5">
              {regions.map((r) => {
                const has = markerByRegion.has(r.id);
                const placing = placingRegion === r.id;
                return (
                  <li key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-ink">{regionText(r.id, r.surface)}</span>
                    {has && (
                      <button type="button" onClick={() => onRemoveMarker(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-edge px-2 py-1 text-[11px] text-mute hover:text-ink" aria-label={`${t("dm.form.markerRemove")}: ${regionText(r.id, r.surface)}`}>
                        <IconX size={12} /> {t("dm.form.markerRemove")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onPlaceMarker(placing ? null : r.id)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${placing ? "border-teal bg-teal/15 text-teal" : "border-edge text-ink hover:border-sky/60"}`}
                      aria-pressed={placing}
                    >
                      <IconCrosshair size={12} /> {placing ? t("dm.form.markerDone") : has ? t("dm.form.markerMove") : t("dm.form.markerAdd")}
                    </button>
                  </li>
                );
              })}
            </ul>
            {placingRegion && <p className="mt-1 text-[11px] text-teal" role="status">{t("dm.form.markerHint")}</p>}
          </div>
        </div>
      )}

      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={create.isPending}>{t("dm.cancel")}</button>
        <button type="submit" className="btn-teal" disabled={create.isPending} aria-disabled={blocked}>
          {create.isPending ? t("dm.saving") : t("dm.save")}
        </button>
      </div>
    </form>
  );
}
