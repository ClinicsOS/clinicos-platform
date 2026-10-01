"use client";
import { useMemo, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { REGION_GROUPS, searchRegions, type RegionGroup } from "@/lib/derm/regions";
import type { DermRegionActivity } from "@/lib/derm/types";

interface Props {
  selected: readonly string[];
  onToggle: (id: string) => void;
  activity?: Record<string, DermRegionActivity>;
  /** Restrict to one group (e.g. the current 3D view). `null` = all groups with tabs. */
  group?: RegionGroup | null;
  maxReached?: boolean;
  className?: string;
}

/**
 * The accessible alternative to clicking the 3D model: a searchable, keyboard-operable checklist of EVERY region in the
 * registry (both languages searchable). It is also the complete fallback when WebGL / the model is unavailable — history
 * stays reachable without any 3D.
 */
export default function RegionList({ selected, onToggle, activity, group = null, maxReached, className = "" }: Props) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<RegionGroup | "all">("all");
  const active = group ?? (tab === "all" ? null : tab);
  const rows = useMemo(() => searchRegions(q).filter((r) => !active || r.group === active), [q, active]);
  const sel = useMemo(() => new Set(selected), [selected]);

  return (
    <div className={className}>
      <div className="relative">
        <IconSearch size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-mute" />
        <input
          className="inp !ps-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("dm.list.search")}
          aria-label={t("dm.list.search")}
          type="search"
        />
      </div>
      {!group && (
        <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label={t("dm.list.groups")}>
          {(["all", ...REGION_GROUPS] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={tab === g}
              onClick={() => setTab(g)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${tab === g ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-mute hover:text-ink"}`}
            >
              {t(`dm.group.${g}`)}
            </button>
          ))}
        </div>
      )}
      <ul className="mt-2 max-h-[46vh] space-y-0.5 overflow-y-auto pe-1" role="listbox" aria-multiselectable="true" aria-label={t("dm.list.title")}>
        {rows.length === 0 && <li className="px-2 py-3 text-xs text-mute">{t("dm.list.none")}</li>}
        {rows.map((r) => {
          const on = sel.has(r.id);
          const a = activity?.[r.id];
          const disabled = !on && !!maxReached;
          return (
            <li key={r.id} role="option" aria-selected={on}>
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${on ? "bg-teal/10 text-ink" : "text-ink hover:bg-soft"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
                <input type="checkbox" className="h-3.5 w-3.5 accent-teal" checked={on} disabled={disabled} onChange={() => onToggle(r.id)} />
                <span className="min-w-0 flex-1 truncate">{r.labels[lang]}</span>
                {a && a.total > 0 && (
                  <span className="shrink-0 rounded-full bg-soft px-1.5 py-0.5 text-[10px] text-mute" title={t("dm.list.hasHistory")}>
                    {a.total}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {maxReached && <p className="mt-1 text-[11px] text-mute">{t("dm.max")}</p>}
    </div>
  );
}
