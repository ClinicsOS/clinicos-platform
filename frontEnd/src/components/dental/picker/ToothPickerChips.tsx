"use client";
import { useI18n } from "@/lib/i18n";
import { resolveCurrentTeeth, toothName, type DentitionType, type Jaw, type ToothMeta } from "@/lib/dental/fdi";

/**
 * 2D tooth picker: the keyboard / screen-reader friendly twin of the 3D picker (and its fallback when WebGL is
 * unavailable). Same rows, same order, same selection — upper row on top, lower row below, a divider at the midline.
 */
function row(teeth: readonly ToothMeta[], jaw: Jaw): ToothMeta[] {
  return teeth.filter((m) => m.jaw === jaw).sort((a, b) => a.side * a.position - b.side * b.position);
}

export default function ToothPickerChips({ dentition, current, selected, onToggle, disabled }: {
  dentition: DentitionType; current: string[] | null; selected: string[]; onToggle: (fdi: string) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const teeth = resolveCurrentTeeth(dentition, current);
  const sel = new Set(selected);
  return (
    <div dir="ltr" className="space-y-1.5 overflow-x-auto py-1" role="group" aria-label={t("dn.pick.title")}>
      {(["upper", "lower"] as Jaw[]).map((jaw) => {
        const r = row(teeth, jaw);
        return (
          <div key={jaw} className="flex min-w-max items-center justify-center gap-1">
            {r.map((m, i) => {
              const on = sel.has(m.fdi);
              const midline = i > 0 && r[i - 1].side < 0 && m.side > 0;
              return (
                <span key={m.fdi} className={`flex ${midline ? "ms-2 border-s border-edge ps-2" : ""}`}>
                  <button
                    type="button" disabled={disabled} aria-pressed={on} title={`${m.fdi} — ${toothName(m, t)}`} onClick={() => onToggle(m.fdi)}
                    className={`flex h-9 w-8 shrink-0 items-center justify-center rounded-md border font-mono text-[10px] transition-all duration-150 sm:w-9 ${
                      on ? "-translate-y-0.5 border-teal bg-teal/25 text-teal shadow-[0_2px_10px_rgba(79,195,184,.3)]" : "border-edge bg-card2 text-ink hover:border-sky"
                    } ${disabled ? "pointer-events-none opacity-50" : ""}`}
                  >{m.fdi}</button>
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
