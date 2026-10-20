"use client";
import { useEffect, useState } from "react";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";

/** Shown when a deep link names a record that no longer exists / was never part of this patient. Never crashes, never silently ignores. */
export default function FocusMissing({ run }: { run: string }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(false), [run]);
  if (hidden) return null;
  return (
    <div role="status" data-testid="focus-missing" className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
      <IconAlertTriangle size={14} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1">{t("ch.missing")}</span>
      <button type="button" aria-label={t("ch.focus.dismiss")} onClick={() => setHidden(true)} className="rounded p-1 hover:bg-amber-500/20"><IconX size={12} /></button>
    </div>
  );
}
