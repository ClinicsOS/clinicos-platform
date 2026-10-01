"use client";
import { useMemo, useRef, useState } from "react";
import { IconChevronDown, IconChevronUp, IconLock } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { RECORD_TYPES, type RecordType, type RegionGroup } from "@/lib/derm/regions";
import type { DermAssessment, DermRegionRef } from "@/lib/derm/types";
import {
  CATEGORY_LABELS, GENERAL_AREAS, MAX_PHASE, MAX_TARGET_REGIONS, MAX_TREATMENT_TEXT, PRIORITIES, TARGET_TYPES, categoriesFor, getProcedure, proceduresFor,
  type Priority, type TargetType,
} from "@/lib/derm/procedures";
import type { TreatmentItem } from "@/lib/derm/treatmentTypes";
import { newRequestId } from "@/lib/derm/hooks";
import { defaultTargetFor, isTargetValid, needsRegionPick, regionsAfterTargetChange, regionsToSend, toggleTargetRegion } from "@/lib/derm/targets";
import { useCreateTreatment, useUpdateTreatment } from "@/lib/derm/treatmentHooks";
import { RegionChip, TypeGlyph } from "../dermUi";
import RegionList from "../RegionList";
import { treatmentErrorCode, treatmentErrorKey, useProcLabel } from "./shared";

export interface TreatmentPrefill {
  recordType?: RecordType;
  regions: DermRegionRef[];
  /** When the treatment is created FROM an assessment: its record type is fixed and it is stored as the source. */
  assessment?: DermAssessment | null;
}

interface Props {
  patientId: string;
  mode: "create" | "edit";
  item?: TreatmentItem;
  prefill?: TreatmentPrefill;
  onSaved: (item: TreatmentItem) => void;
  onCancel: () => void;
}

const label = "lbl";
const chip = (on: boolean) => `rounded-lg border px-2.5 py-1.5 text-start text-[11px] transition-colors ${on ? "border-teal bg-teal/15 text-ink" : "border-edge bg-soft text-mute hover:text-ink"}`;

/**
 * Treatment editor. It records what the CLINICIAN decided — it never suggests a procedure. Progressive disclosure: the
 * three things that matter (record type, procedure, target) come first; priority / phase / estimate / notes sit under
 * "More". After a treatment has started, its procedure and target are shown locked (correcting = cancel + add a new one).
 */
export default function TreatmentForm({ patientId, mode, item, prefill, onSaved, onCancel }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const procLabel = useProcLabel();
  const create = useCreateTreatment(patientId);
  const update = useUpdateTreatment(patientId);
  const pending = create.isPending || update.isPending;

  const fromAssessment = mode === "create" ? prefill?.assessment ?? null : null;
  const locked = mode === "edit" && item?.status !== "planned";
  const [recordType, setRecordType] = useState<RecordType | "">(item?.recordType ?? fromAssessment?.recordType ?? prefill?.recordType ?? "");
  const [procedureCode, setProcedureCode] = useState(item?.procedureCode ?? "");
  const initialRegions = item?.regions ?? prefill?.regions ?? [];
  const [regions, setRegions] = useState<DermRegionRef[]>(initialRegions);
  const [targetType, setTargetType] = useState<TargetType>(item?.targetType ?? defaultTargetFor(initialRegions.length));
  const [generalArea, setGeneralArea] = useState<RegionGroup | "">(item?.generalArea ?? "");
  const [pickRegions, setPickRegions] = useState(false);
  const [priority, setPriority] = useState<Priority>(item?.priority ?? "normal");
  const [phase, setPhase] = useState<string>(String(item?.phase ?? 1));
  const [price, setPrice] = useState<string>(item?.estimatedPrice != null ? String(item.estimatedPrice) : "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [more, setMore] = useState(mode === "edit");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // idempotency: one id per attempted CONTENT (a retry of the same content can never create two treatments)
  const reqId = useRef(newRequestId());
  const lastSig = useRef("");

  const procedures = useMemo(() => (recordType ? proceduresFor(recordType) : []), [recordType]);
  const cats = recordType ? categoriesFor(recordType) : [];

  const needRegions = targetType === "single_region" ? 1 : targetType === "multi_region" ? 2 : 0;
  const regionsOk = isTargetValid(targetType, regions.length);
  const priceNum = price.trim() === "" ? null : Number(price.replace(",", "."));
  const priceOk = priceNum === null || (Number.isFinite(priceNum) && priceNum >= 0 && priceNum <= 1_000_000);
  const phaseNum = Number(phase);
  const phaseOk = Number.isInteger(phaseNum) && phaseNum >= 1 && phaseNum <= MAX_PHASE;
  const missingProcedure = !procedureCode || !getProcedure(procedureCode) || getProcedure(procedureCode)!.recordType !== recordType;
  const invalid = !recordType || missingProcedure || !regionsOk || !priceOk || !phaseOk;

  const pickType = (rt: RecordType) => {
    if (rt === recordType) return;
    setRecordType(rt);
    setProcedureCode(""); // the two catalogs stay distinct: a procedure of the other record type is never kept
  };
  const chooseTarget = (tt: TargetType) => {
    const next = regionsAfterTargetChange(tt, regions); // single keeps the last picked; the clinician can change it
    setTargetType(tt);
    setRegions(next);
    setPickRegions(needsRegionPick(tt, next.length));
  };
  const toggleRegion = (id: string) => setRegions((cur) => toggleTargetRegion(targetType, cur, id));

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (invalid) return;
    const common = {
      priority, phase: phaseNum, estimatedPrice: priceNum, notes: notes.trim(),
    };
    try {
      if (mode === "create") {
        const body = {
          recordType: recordType as RecordType, procedureCode, targetType,
          regions: targetType === "general" ? undefined : regionsToSend(targetType, regions),
          generalArea: targetType === "general" && generalArea ? generalArea : undefined,
          ...common, sourceAssessmentId: fromAssessment?._id ?? null,
        };
        const sig = JSON.stringify(body);
        if (sig !== lastSig.current) { reqId.current = newRequestId(); lastSig.current = sig; }
        const r = await create.mutateAsync({ clientRequestId: reqId.current, ...body });
        toast.success(t("dt.saved.created"));
        onSaved(r.item);
      } else if (item) {
        const body = locked
          ? common
          : { recordType: recordType as RecordType, procedureCode, targetType, regions: regionsToSend(targetType, regions), generalArea: targetType === "general" && generalArea ? generalArea : null, ...common };
        const it = await update.mutateAsync({ itemId: item._id, ...body });
        toast.success(t("dt.saved.updated"));
        onSaved(it);
      }
    } catch (e) {
      const code = treatmentErrorCode(e);
      setError(t(treatmentErrorKey(e)) + (code === "ITEM_LOCKED" || code === "ITEM_CHANGED" ? "" : ""));
    }
  };

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate aria-label={mode === "edit" ? t("dt.form.editTitle") : t("dt.form.title")}>
      {fromAssessment && (
        <div className="rounded-xl border border-edge bg-soft px-3 py-2 text-[11px]">
          <div className="font-medium text-ink">{t("dt.form.fromAssessment")}</div>
          {(fromAssessment.concern || fromAssessment.findings) && <p className="mt-0.5 line-clamp-2 text-mute">{fromAssessment.concern || fromAssessment.findings}</p>}
          {fromAssessment.diagnosis && <p className="mt-0.5 text-mute">{t("dt.form.diagnosisSnapshot")}: <span className="text-ink">{fromAssessment.diagnosis}</span></p>}
        </div>
      )}
      {mode === "edit" && item?.sourceDiagnosis && (
        <p className="rounded-lg bg-soft px-3 py-1.5 text-[11px] text-mute">{t("dt.form.diagnosisSnapshot")}: <span className="text-ink">{item.sourceDiagnosis}</span></p>
      )}
      {locked && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100"><IconLock size={13} className="mt-px shrink-0" />{t("dt.form.locked")}</p>
      )}

      {/* 1. record type (fixed when it comes from an assessment) */}
      <fieldset disabled={locked || !!fromAssessment}>
        <legend className={label}>{t("dm.form.type")} <span className="text-red-400">*</span></legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("dm.form.type")}>
          {RECORD_TYPES.map((rt) => {
            const on = recordType === rt;
            return (
              <button key={rt} type="button" role="radio" aria-checked={on} onClick={() => pickType(rt)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-start text-xs transition-colors ${on ? "border-teal bg-teal/15 text-ink" : "border-edge bg-soft text-mute hover:text-ink"} ${locked || fromAssessment ? "cursor-not-allowed opacity-70" : ""}`}>
                <TypeGlyph type={rt} size={12} /><span className="font-medium">{t(`dm.type.${rt}`)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 2. procedure — the catalog, grouped by category (never one giant list; never a recommendation) */}
      <fieldset disabled={locked}>
        <legend className={label}>{t("dt.form.procedure")} <span className="text-red-400">*</span></legend>
        {!recordType ? (
          <p className="text-[11px] text-mute">{t("dt.form.pickType")}</p>
        ) : (
          <div className="space-y-2" role="radiogroup" aria-label={t("dt.form.procedure")}>
            {cats.map((c) => (
              <div key={c}>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-mute">{t(`dt.cat.${c}`)}</div>
                <div className="flex flex-wrap gap-1.5">
                  {procedures.filter((p) => p.category === c).map((p) => (
                    <button key={p.code} type="button" role="radio" aria-checked={procedureCode === p.code} onClick={() => setProcedureCode(p.code)} className={`${chip(procedureCode === p.code)} ${locked ? "cursor-not-allowed opacity-70" : ""}`}>
                      {procLabel(p.code)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[10px] text-mute">{t("dt.form.catalogNote")}</p>
        {touched && recordType && missingProcedure && <p className="mt-1 text-[11px] text-red-400" role="alert">{t("dt.form.procedureRequired")}</p>}
        {touched && !recordType && <p className="mt-1 text-[11px] text-red-400" role="alert">{t("dm.form.typeRequired")}</p>}
      </fieldset>

      {/* 3. target: single / multi / general — registry ids only */}
      <fieldset disabled={locked}>
        <legend className={label}>{t("dt.form.target")}</legend>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("dt.form.target")}>
          {TARGET_TYPES.map((tt) => (
            <button key={tt} type="button" role="radio" aria-checked={targetType === tt} onClick={() => chooseTarget(tt)} className={`${chip(targetType === tt)} text-center ${locked ? "cursor-not-allowed opacity-70" : ""}`}>
              {t(`dt.target.${tt}`)}
            </button>
          ))}
        </div>
        {targetType === "general" ? (
          <div className="mt-2">
            <label className="lbl" htmlFor="dt-area">{t("dt.form.generalArea")}</label>
            <select id="dt-area" className="inp" value={generalArea} onChange={(e) => setGeneralArea(e.target.value as RegionGroup | "")}>
              <option value="">{t("dt.form.generalNone")}</option>
              {GENERAL_AREAS.map((g) => <option key={g} value={g}>{t(`dm.group.${g}`)}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-mute">{t("dt.form.generalNote")}</p>
          </div>
        ) : (
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {regions.length === 0 && <span className="text-[11px] text-mute">{t("dt.form.noRegions")}</span>}
              {regions.map((r) => <RegionChip key={r.id} id={r.id} surface={r.surface} onRemove={locked ? undefined : () => toggleRegion(r.id)} />)}
            </div>
            {!locked && (
              <button type="button" className="flex items-center gap-1 text-[11px] font-medium text-blue hover:underline" onClick={() => setPickRegions((p) => !p)} aria-expanded={pickRegions}>
                {pickRegions ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />} {t("dt.form.changeRegions")}
              </button>
            )}
            {pickRegions && !locked && <RegionList selected={regions.map((r) => r.id)} onToggle={toggleRegion} maxReached={targetType === "multi_region" && regions.length >= MAX_TARGET_REGIONS} />}
            {touched && !regionsOk && <p className="text-[11px] text-red-400" role="alert">{t(needRegions === 1 ? "dt.form.needOne" : "dt.form.needMany")}</p>}
          </div>
        )}
      </fieldset>

      <button type="button" className="flex items-center gap-1 text-[11px] font-medium text-blue hover:underline" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />} {t("dt.form.more")}
      </button>
      {more && (
        <div className="space-y-3 dn-fade-in">
          <div>
            <div className={label}>{t("dt.form.priority")}</div>
            <div className="flex gap-1.5" role="radiogroup" aria-label={t("dt.form.priority")}>
              {PRIORITIES.map((p) => <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => setPriority(p)} className={chip(priority === p)}>{t(`dt.priority.${p}`)}</button>)}
            </div>
            <p className="mt-1 text-[10px] text-mute">{t("dt.form.priorityNote")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label} htmlFor="dt-phase">{t("dt.form.phase")}</label>
              <input id="dt-phase" className="inp" inputMode="numeric" value={phase} onChange={(e) => setPhase(e.target.value.replace(/[^\d]/g, ""))} />
              {touched && !phaseOk && <p className="mt-1 text-[11px] text-red-400" role="alert">{t("dt.form.phaseInvalid")}</p>}
            </div>
            <div>
              <label className={label} htmlFor="dt-price">{t("dt.form.estimate")}</label>
              <input id="dt-price" className="inp" inputMode="decimal" placeholder="JD" value={price} onChange={(e) => setPrice(e.target.value)} />
              {touched && !priceOk && <p className="mt-1 text-[11px] text-red-400" role="alert">{t("dt.form.priceInvalid")}</p>}
            </div>
          </div>
          <p className="rounded-lg bg-soft px-3 py-1.5 text-[11px] text-mute">{t("dt.form.estimateNote")}</p>
          <div>
            <div className="flex items-center justify-between"><label className={label} htmlFor="dt-notes">{t("dt.form.notes")}</label><span className="text-[10px] text-mute">{notes.length}/{MAX_TREATMENT_TEXT.notes}</span></div>
            <textarea id="dt-notes" className="inp min-h-[64px]" maxLength={MAX_TREATMENT_TEXT.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      )}

      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={pending}>{t("dm.cancel")}</button>
        <button type="submit" className="btn-teal" disabled={pending}>{pending ? t("dm.saving") : mode === "edit" ? t("dm.save") : t("dt.form.add")}</button>
      </div>
    </form>
  );
}
