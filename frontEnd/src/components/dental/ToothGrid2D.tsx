"use client";
import { useI18n } from "@/lib/i18n";
import { getToothMeta, jawRowFdis, toothName, type DentitionType } from "@/lib/dental/fdi";
import type { ToothClinicalState } from "@/lib/dental/toothStates";
import type { ToothVisualState } from "@/lib/dental/types";

type PlanMap = Record<string, Pick<ToothVisualState, "plan" | "treated">>;

/**
 * 2D tooth chart. Used (a) as the fallback when WebGL is unavailable and (b) for primary / mixed
 * dentition, which has no 3D model yet. It drives the SAME selection + panel + API as the 3D view.
 * Rows are in clinical view order (viewer-left -> viewer-right): 18…11 | 21…28 and 48…41 | 31…38.
 */
function Tooth({ fdi, st, pv, selected, onSelect }: { fdi: string; st?: ToothClinicalState; pv?: PlanMap[string]; selected: boolean; onSelect: (f: string) => void }) {
  const { t } = useI18n();
  const meta = getToothMeta(fdi)!;
  const hasDx = !!st?.diagnoses.length;
  const restored = st?.existing.some((e) => ["existing_crown", "existing_bridge", "existing_implant"].includes(e.code));
  const filled = st?.existing.some((e) => e.code === "existing_filling");
  const rct = st?.existing.some((e) => e.code === "root_canal_treated");
  return (
    <button
      type="button"
      onClick={() => onSelect(fdi)}
      aria-pressed={selected}
      title={`${fdi} — ${toothName(meta, t)}`}
      className={`relative flex h-11 w-8 shrink-0 flex-col items-center justify-center rounded-md border text-[10px] font-mono transition-colors sm:w-9 ${
        selected ? "border-teal bg-teal/20 text-teal" : "border-edge bg-card2 text-ink hover:border-sky"
      } ${st?.missing ? "border-dashed opacity-50 line-through" : ""} ${restored ? "!border-slate-300/70" : ""}`}
    >
      <span>{fdi}</span>
      <span className="mt-0.5 flex h-2 items-center gap-0.5">
        {hasDx && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
        {filled && <span className="h-1.5 w-1.5 rounded-sm bg-slate-400" />}
        {rct && <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />}
        {restored && <span className="h-1.5 w-2 rounded-t-sm bg-slate-200" />}
      </span>
      {(pv?.plan || pv?.treated) && (
        <span aria-hidden className="absolute -top-1 end-0 flex text-[8px] leading-none">
          {pv.plan === "planned" && <span className="text-[#6CB6E8]">○</span>}
          {pv.plan === "in_progress" && <span className="text-[#B49BFF]">◆</span>}
          {pv.treated && <span className="text-[#62D39A]">✓</span>}
        </span>
      )}
    </button>
  );
}

function ArchRow({ fdis, states, plan, selected, onSelect }: { fdis: string[]; states: Record<string, ToothClinicalState>; plan?: PlanMap; selected: string | null; onSelect: (f: string) => void }) {
  const half = fdis.length / 2;
  return (
    <div className="flex items-center justify-center gap-1" dir="ltr">
      {fdis.map((f, i) => (
        <span key={f} className={`flex ${i === half ? "ms-2 border-s border-edge ps-2" : ""}`}>
          <Tooth fdi={f} st={states[f]} pv={plan?.[f]} selected={selected === f} onSelect={onSelect} />
        </span>
      ))}
    </div>
  );
}

export default function ToothGrid2D({ dentition, states, plan, selected, onSelect }: { dentition: DentitionType; states: Record<string, ToothClinicalState>; plan?: PlanMap; selected: string | null; onSelect: (fdi: string) => void }) {
  const { t } = useI18n();
  const sets: Array<{ key: "permanent" | "primary"; label: string }> = [];
  if (dentition !== "primary") sets.push({ key: "permanent", label: t("dn.permanentTeeth") });
  if (dentition !== "permanent") sets.push({ key: "primary", label: t("dn.primaryTeeth") });
  return (
    <div className="space-y-4 overflow-x-auto py-1">
      {sets.map((s) => (
        <div key={s.key} className="min-w-max space-y-1.5">
          {sets.length > 1 && <div className="text-center text-[10px] font-medium tracking-wide text-mute">{s.label}</div>}
          <ArchRow fdis={jawRowFdis("upper", s.key)} states={states} plan={plan} selected={selected} onSelect={onSelect} />
          <ArchRow fdis={jawRowFdis("lower", s.key)} states={states} plan={plan} selected={selected} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
