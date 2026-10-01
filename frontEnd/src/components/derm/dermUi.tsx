"use client";
import { IconX } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { regionLabel, type RecordType, type SurfaceId } from "@/lib/derm/regions";

/** Circle = dermatology, diamond = aesthetic — the same neutral shapes the 3D badges use (never a severity colour). */
export function TypeGlyph({ type, size = 10 }: { type: RecordType; size?: number }) {
  return type === "aesthetic" ? (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .6 9.4 5 5 9.4.6 5z" fill="currentColor" /></svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4.2" fill="currentColor" /></svg>
  );
}

export function RecordTypeBadge({ type }: { type: RecordType }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-soft px-2 py-0.5 text-[10px] font-medium text-ink">
      <TypeGlyph type={type} />
      {t(type === "aesthetic" ? "dm.type.aesthetic" : "dm.type.dermatology")}
    </span>
  );
}

/** Region label in the UI language + optional surface qualifier ("Left Forearm · posterior surface"). */
export function useRegionText() {
  const { lang, t } = useI18n();
  return (id: string, surface?: SurfaceId | null) => {
    const base = regionLabel(id, lang);
    return surface ? `${base} · ${t(`dm.surface.${surface}`)}` : base;
  };
}

export function RegionChip({
  id, surface, onRemove, onClick, active,
}: { id: string; surface?: SurfaceId | null; onRemove?: () => void; onClick?: () => void; active?: boolean }) {
  const { t } = useI18n();
  const text = useRegionText()(id, surface);
  const cls = `inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${active ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-ink"}`;
  return (
    <span className={cls}>
      {onClick ? (
        <button type="button" onClick={onClick} className="truncate text-start hover:underline">{text}</button>
      ) : (
        <span className="truncate">{text}</span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`${t("dm.remove")}: ${text}`} className="shrink-0 rounded-full p-0.5 text-mute hover:text-ink">
          <IconX size={12} />
        </button>
      )}
    </span>
  );
}

export const fmtDate = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB", { year: "numeric", month: "short", day: "numeric" });
export const fmtDateTime = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang === "ar" ? "ar-JO" : "en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
