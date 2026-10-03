"use client";
import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { errMsg } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { DentitionType } from "@/lib/dental/fdi";
import { SURFACES, SURFACE_LABELS, type SurfaceId } from "@/lib/dental/taxonomy";
import { CUSTOM_NAME_MAX, MAX_PHASE, OTHER_PROCEDURE_CODE, PRIORITIES, PROCEDURES, cleanCustomName, findProcedure, procLabel, targetError, type Priority, type TargetType } from "@/lib/dental/procedures";
import { useCreateTreatment, useDentalRecord, useUpdateTreatment, type TreatmentInput } from "@/lib/dental/hooks";
import type { TreatmentItem } from "@/lib/dental/types";
import { TargetText } from "./shared";
import ToothPicker from "../picker/ToothPicker";

/** Where the editor was opened from (selected tooth / a diagnosis). These are only DEFAULTS — the doctor can change them. */
export interface EditorPrefill {
  fdi?: string;
  surfaces?: SurfaceId[];
  diagnosisId?: string;
  diagnosisLabel?: string;
}

const chip = (on: boolean, disabled = false) =>
  `rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${on ? "border-teal bg-teal/15 text-teal" : "border-edge bg-card2 text-ink hover:border-sky"} ${disabled ? "pointer-events-none opacity-50" : ""}`;

export default function TreatmentEditor(p: {
  patientId: string;
  dentition: DentitionType;
  item?: TreatmentItem; // editing
  prefill?: EditorPrefill;
  phases: { number: number; name?: string }[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const create = useCreateTreatment(p.patientId);
  const update = useUpdateTreatment(p.patientId);
  const lock = useRef(false); // double-click guard on top of the disabled button
  const it = p.item;
  const locked = it?.status === "in_progress"; // procedure + target frozen once sessions exist

  const [code, setCode] = useState(it?.procedureCode ?? "");
  const [customName, setCustomName] = useState(it?.customName ?? ""); // only used when the procedure is "Other"
  const [target, setTarget] = useState<TargetType>(it?.targetType ?? "tooth");
  const [teeth, setTeeth] = useState<string[]>(it?.toothNumbers ?? (p.prefill?.fdi ? [p.prefill.fdi] : []));
  const [surfaces, setSurfaces] = useState<SurfaceId[]>(it?.surfaces ?? p.prefill?.surfaces ?? []);
  const [priority, setPriority] = useState<Priority>(it?.priority ?? "normal");
  const [phase, setPhase] = useState(it?.phase ?? 1);
  const [price, setPrice] = useState(it?.estimatedPrice != null ? String(it.estimatedPrice) : "");
  const [notes, setNotes] = useState(it?.notes ?? "");
  const [error, setError] = useState("");

  const def = findProcedure(code);
  const isOther = code === OTHER_PROCEDURE_CODE;
  // Mixed dentition: the picker shows exactly the teeth currently charted for this patient (same record the 3D chart uses).
  const rec = useDentalRecord(p.patientId);
  const currentTeeth = rec.data?.record.currentTeeth ?? null;
  const busy = create.isPending || update.isPending;
  const seedTooth = p.prefill?.fdi;

  const applyTarget = (next: TargetType, currentTeeth: string[]) => {
    setTarget(next);
    if (next === "general") { setTeeth([]); setSurfaces([]); return; }
    if (next === "tooth") { setTeeth(currentTeeth.length ? [currentTeeth[0]] : seedTooth ? [seedTooth] : []); setSurfaces([]); return; }
    if (next === "surface") { setTeeth(currentTeeth.length ? [currentTeeth[0]] : seedTooth ? [seedTooth] : []); setSurfaces((s) => (s.length ? s : p.prefill?.surfaces ?? [])); return; }
    setTeeth(currentTeeth.length ? currentTeeth : seedTooth ? [seedTooth] : []); setSurfaces([]); // multi_tooth
  };
  // The DOCTOR chooses the procedure — this only adapts the form to its shape.
  const pick = (c: string) => { setCode(c); setError(""); const d = findProcedure(c)!; applyTarget(d.defaultTarget, teeth); };

  const priceNum = price.trim() === "" ? null : Number(price.replace(",", "."));
  const priceBad = priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0);
  const tErr = locked ? null : targetError({ procedureCode: code, targetType: target, teeth, surfaces, customName }, p.dentition);
  const canSave = !busy && !priceBad && !tErr;

  const save = async () => {
    if (!canSave || lock.current) return;
    lock.current = true; setError("");
    try {
      if (it) {
        const body: Partial<TreatmentInput> = { priority, phase, notes, estimatedPrice: priceNum };
        if (!locked) Object.assign(body, { procedureCode: code, targetType: target, toothNumbers: teeth, surfaces, ...(isOther ? { customName: cleanCustomName(customName) } : {}) });
        await update.mutateAsync({ id: it._id, body });
      } else {
        await create.mutateAsync({
          procedureCode: code, targetType: target, toothNumbers: teeth, surfaces, priority, phase,
          ...(isOther ? { customName: cleanCustomName(customName) } : {}),
          ...(priceNum !== null ? { estimatedPrice: priceNum } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(p.prefill?.diagnosisId ? { sourceDiagnosisIds: [p.prefill.diagnosisId] } : {}),
        });
      }
      toast.success(t("dn.saved"));
      p.onClose();
    } catch (e) {
      setError(errMsg(e, t("dn.err.save"))); // shown inline — nothing is presented as saved
    } finally { lock.current = false; }
  };

  const phaseOptions = Array.from(new Set([...p.phases.map((x) => x.number), phase, 1, 2, 3])).filter((n) => n <= MAX_PHASE).sort((a, b) => a - b);

  return (
    <Modal title={it ? t("dn.edit") : t("dn.plan.add")} size="lg" onClose={p.onClose}>
      <div className="space-y-3.5">
        {p.prefill?.diagnosisLabel && !it && (
          <div className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-[11px] text-mute">
            {t("dn.sourceDx")}: <span className="text-ink">{p.prefill.diagnosisLabel}</span>
            {p.prefill.surfaces?.length ? <span dir="ltr" className="font-mono text-sky"> · {p.prefill.surfaces.map((s) => SURFACE_LABELS[s]).join(",")}</span> : null}
          </div>
        )}

        {/* procedure */}
        <div>
          <label className="lbl">{t("dn.procedure")}</label>
          {locked && it ? (
            <div className="rounded-lg border border-edge bg-card2 px-2.5 py-2 text-[12px] text-ink">
              {procLabel(t, it)} — <TargetText targetType={it.targetType} toothNumbers={it.toothNumbers} surfaces={it.surfaces} />
              <p className="mt-1 text-[10px] text-mute">{t("dn.locked")}</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {PROCEDURES.map((d) => (
                <button key={d.code} type="button" aria-pressed={code === d.code} className={chip(code === d.code)} onClick={() => pick(d.code)}>{t(`dn.p.${d.code}`)}</button>
              ))}
            </div>
          )}
          {def?.multiSession && !locked && <p className="mt-1 text-[10px] text-mute">{t("dn.multiHint")}</p>}
          {isOther && !locked && (
            <div className="dn-fade-in mt-2">
              <label className="lbl" htmlFor="dn-custom-name">{t("dn.customName")}</label>
              <input
                id="dn-custom-name" dir="auto" className={`inp ${cleanCustomName(customName).length === 1 ? "!border-amber-400" : ""}`} maxLength={CUSTOM_NAME_MAX}
                placeholder={t("dn.customNamePh")} value={customName} onChange={(e) => { setCustomName(e.target.value); setError(""); }} autoFocus
              />
            </div>
          )}
        </div>

        {/* target — driven by the catalog metadata */}
        {def && !locked && (
          <div className="space-y-2">
            <label className="lbl">{t("dn.target")}</label>
            {def.targets.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {def.targets.map((tg) => (
                  <button key={tg} type="button" aria-pressed={target === tg} className={chip(target === tg)} onClick={() => applyTarget(tg, teeth)}>{t(`dn.tg.${tg}`)}</button>
                ))}
              </div>
            )}
            {(target === "tooth" || target === "surface") && (
              <ToothPicker mode="single" value={teeth} onChange={(next) => setTeeth(next.slice(0, 1))} dentition={p.dentition} current={currentTeeth} />
            )}
            {target === "surface" && (
              <div className="flex flex-wrap gap-1.5" dir="ltr">
                {SURFACES.map((s) => (
                  <button key={s} type="button" title={t(`dn.s.${s}`)} aria-pressed={surfaces.includes(s)} className={chip(surfaces.includes(s))}
                    onClick={() => setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}>{SURFACE_LABELS[s]}</button>
                ))}
              </div>
            )}
            {target === "multi_tooth" && (
              <ToothPicker mode="multi" value={teeth} onChange={setTeeth} dentition={p.dentition} current={currentTeeth} />
            )}
            {target === "general" && <p className="text-[11px] text-mute">{t("dn.tg.general")}</p>}
          </div>
        )}

        {/* priority + phase + price */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="lbl">{t("dn.pr.label")}</label>
            <div className="flex gap-1">{PRIORITIES.map((x) => <button key={x} type="button" aria-pressed={priority === x} className={chip(priority === x)} onClick={() => setPriority(x)}>{t(`dn.pr.${x}`)}</button>)}</div>
          </div>
          <div>
            <label className="lbl">{t("dn.phase")}</label>
            <select className="inp" value={phase} onChange={(e) => setPhase(Number(e.target.value))}>
              {phaseOptions.map((n) => <option key={n} value={n}>{t("dn.phase")} {n}{p.phases.find((x) => x.number === n)?.name ? ` — ${p.phases.find((x) => x.number === n)!.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">{t("dn.price")} (JD)</label>
            <input dir="ltr" inputMode="decimal" className={`inp ${priceBad ? "!border-red-400" : ""}`} placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={priceBad} />
          </div>
        </div>

        <div>
          <label className="lbl">{t("dn.notes")}</label>
          <textarea dir="auto" className="inp min-h-16" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {(tErr || priceBad) && code && <p className="text-[11px] text-amber-400">{priceBad ? t("dn.err.price") : t(tErr!)}</p>}
        {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">{error}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={p.onClose} disabled={busy}>{t("dn.cancel")}</button>
          <button type="button" className="btn-teal text-xs disabled:opacity-50" onClick={save} disabled={!canSave || !code}>{t("dn.save")}</button>
        </div>
      </div>
    </Modal>
  );
}
