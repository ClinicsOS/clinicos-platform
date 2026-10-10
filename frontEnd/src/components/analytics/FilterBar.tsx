"use client";
import { IconDownload, IconPrinter, IconCalendarEvent, IconLoader2 } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { filtersValid, type Filters, type Meta, type Preset } from "@/lib/analytics";

export const PRESET_ORDER: Preset[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_30", "this_year", "custom"];

export default function FilterBar({ filters, onChange, meta, owner, doctors, canFilterDoctor, rangeText, compareText, onExport, exporting, onPrint, exportable }: {
  filters: Filters;
  onChange: (f: Filters) => void;
  meta: Meta;
  owner: boolean;
  doctors: { _id: string; name: string }[];
  canFilterDoctor: boolean;
  rangeText: string;
  compareText: string;
  onExport: () => void;
  exporting: boolean;
  onPrint: () => void;
  exportable: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const valid = filtersValid(filters);
  return (
    <div className="an-noprint card mb-4 p-3" data-testid="an-filters">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t("an.f.period")}>
        {PRESET_ORDER.filter((p) => meta.presets.includes(p)).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={filters.preset === p} data-testid={`preset-${p}`}
            onClick={() => set(p === "custom" ? { preset: "custom", from: filters.from || meta.range.from, to: filters.to || meta.range.to } : { preset: p })}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${filters.preset === p ? "bg-teal text-navy" : "border border-edge bg-card2 text-mute hover:text-ink"}`}>
            {t(`an.preset.${p}`)}
          </button>
        ))}
      </div>

      {filters.preset === "custom" && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label className="lbl" htmlFor="an-from">{t("an.f.from")}</label><input id="an-from" data-testid="an-from" type="date" className="inp !w-auto !py-1.5 text-xs" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} /></div>
          <div><label className="lbl" htmlFor="an-to">{t("an.f.to")}</label><input id="an-to" data-testid="an-to" type="date" className="inp !w-auto !py-1.5 text-xs" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} /></div>
          {!valid && <p className="pb-1.5 text-[11px] text-amber-400" data-testid="an-range-invalid">{t("an.f.invalid")}</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {canFilterDoctor && doctors.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wide text-mute" htmlFor="an-doc">{t("md.filter.doctor")}</label>
            <select id="an-doc" data-testid="an-doctor" className="inp !w-auto !py-1.5 text-xs" value={filters.doctorId} onChange={(e) => set({ doctorId: e.target.value })}>
              <option value="">{t("md.filter.all")}</option>
              {doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-mute">
          <input type="checkbox" data-testid="an-compare" className="accent-teal" checked={filters.compare} onChange={(e) => set({ compare: e.target.checked })} />
          {t("an.f.compare")}
        </label>
        {!owner && <span className="text-[10px] text-mute" data-testid="an-self-note">{t("md.reports.scopeSelf")}</span>}

        <div className="ms-auto flex items-center gap-2">
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onExport} disabled={!exportable || exporting || !valid} data-testid="an-export">
            {exporting ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />}{t("an.export")}
          </button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onPrint} disabled={!valid} data-testid="an-print"><IconPrinter size={13} />{t("an.print")}</button>
        </div>
      </div>

      {valid && rangeText && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-2 text-[10px] text-mute" data-testid="an-range">
          <span className="inline-flex items-center gap-1"><IconCalendarEvent size={12} /><b className="text-ink" dir="ltr">{rangeText}</b></span>
          {compareText && <span data-testid="an-compare-text">{compareText}</span>}
          <span>{meta.timeZone}</span>
        </div>
      )}
    </div>
  );
}
