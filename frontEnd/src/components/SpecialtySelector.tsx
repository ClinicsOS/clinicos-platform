"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SPECIALTIES, SPECIALTY_ICONS, DEFAULT_SPECIALTY_ICON, type SpecialtyId } from "@/lib/specialties";
import { IconChevronDown, IconSearch, IconCheck } from "@tabler/icons-react";

interface SpecialtySelectorProps {
  value: string;
  onChange: (id: SpecialtyId) => void;
}

/**
 * Compact specialty picker for the sign-up form — one field, matching
 * the height/shape/`.inp` look of every other field on this page.
 * Clicking it opens a small searchable popover (same open/close pattern
 * as components/NotificationBell.tsx: outside-click + Escape close).
 *
 * Icons are a TEMPORARY @tabler/icons-react fallback — see
 * lib/specialties.ts for how to swap in the final 3D icon set later
 * without touching this component.
 */
export default function SpecialtySelector({ value, onChange }: SpecialtySelectorProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click — same pattern as NotificationBell.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Reset search + autofocus it whenever the popover opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const id = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qAr = query.trim();
    if (!q) return SPECIALTIES;
    // Matches both languages regardless of the active UI language —
    // simplest robust behavior per the spec, and it costs nothing extra.
    return SPECIALTIES.filter((s) => s.en.toLowerCase().includes(q) || s.ar.includes(qAr));
  }, [query]);

  const selected = SPECIALTIES.find((s) => s.id === value);
  const SelectedIcon = selected ? SPECIALTY_ICONS[selected.id] : DEFAULT_SPECIALTY_ICON;

  const close = () => {
    setOpen(false);
    // Return focus to the trigger so keyboard users don't lose their place.
    triggerRef.current?.focus();
  };

  const selectItem = (id: SpecialtyId) => {
    onChange(id);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      // Critical: this popover lives inside the sign-up <form> — without
      // preventDefault the browser would submit the whole form instead
      // of just picking the highlighted specialty.
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) selectItem(item.id);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="specialty-listbox"
        aria-label={t("su.specialty")}
        className="inp flex items-center justify-between gap-2 text-start"
      >
        <span className="flex min-w-0 items-center gap-2">
          <SelectedIcon size={15} className="shrink-0 text-mute" />
          <span className={`truncate ${selected ? "text-ink" : "text-mute"}`}>
            {selected ? (lang === "ar" ? selected.ar : selected.en) : t("su.specialtyPlaceholder")}
          </span>
        </span>
        <IconChevronDown
          size={14}
          className={`shrink-0 text-mute transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          id="specialty-listbox"
          role="listbox"
          aria-label={t("su.specialty")}
          onKeyDown={onKeyDown}
          className="dropdown-in absolute start-0 top-[calc(100%+6px)] z-50 w-full min-w-[260px] rounded-xl border border-edge bg-card shadow-[0_20px_50px_-20px_rgba(0,0,0,0.4)]"
        >
          <div className="relative border-b border-edge p-2">
            <IconSearch
              size={13}
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-mute ltr:left-4 rtl:right-4"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder={t("su.specialtySearchPlaceholder")}
              aria-label={t("su.specialtySearchPlaceholder")}
              className="w-full rounded-lg border border-edge bg-card2 py-1.5 text-xs text-ink outline-none placeholder:text-mute focus:border-sky ltr:pl-8 ltr:pr-2 rtl:pr-8 rtl:pl-2"
            />
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-mute">
                {t("su.specialtyNoResults")}
              </p>
            ) : (
              filtered.map((s, i) => {
                const Icon = SPECIALTY_ICONS[s.id];
                const isSelected = s.id === value;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => selectItem(s.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-xs hover:bg-soft ${
                      i === activeIndex ? "bg-soft" : ""
                    } ${isSelected ? "text-sky" : "text-ink"}`}
                  >
                    <Icon size={17} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{lang === "ar" ? s.ar : s.en}</span>
                    {isSelected && <IconCheck size={14} className="shrink-0 text-teal" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
