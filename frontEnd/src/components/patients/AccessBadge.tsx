"use client";
import { useI18n } from "@/lib/i18n";
import type { PatientAccessInfo } from "@/lib/types";
import { IconShieldCheck, IconUserShield, IconUserQuestion } from "@tabler/icons-react";

/**
 * PHASE 1 — "why can I see this patient?" chip(s). Presentation only (the server decides access and computes `access`):
 *   doctor, own        → "My patient"
 *   doctor, delegated  → "Covering Dr Mahmoud · until 24/10/2026"  (or "until revoked")
 *   owner / front desk → the doctor(s) the patient belongs to, or "Unassigned"
 */
export default function AccessBadge({ access, compact = false }: { access?: PatientAccessInfo; compact?: boolean }) {
  const { t, lang } = useI18n();
  if (!access) return null;
  const size = compact ? "!px-1.5 !py-0 !text-[9px]" : "";
  const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((a, [k, v]) => a.replace(`{${k}}`, v), s);
  const glass = "backdrop-blur-sm border";

  if (access.kind === "own") {
    return (
      <span className={`pill ${size} ${glass} items-center gap-1 border-emerald-400/30 bg-emerald-500/10 text-emerald-300`}>
        <IconShieldCheck size={compact ? 9 : 11} /> {t("pa.badge.mine")}
      </span>
    );
  }
  if (access.kind === "delegated") {
    const names = access.covering.map((c) => c.name).join(", ");
    const until = access.until
      ? fill(t("pa.badge.until"), { date: new Date(access.until).toLocaleDateString(lang === "ar" ? "ar-JO-u-nu-latn" : undefined) })
      : t("pa.badge.untilRevoked");
    return (
      <span className={`pill ${size} ${glass} items-center gap-1 border-violet-400/30 bg-violet-500/10 text-violet-200`}>
        <IconUserShield size={compact ? 9 : 11} /> {fill(t("pa.badge.covering"), { name: names || "—" })}
        <span className="opacity-70">· {until}</span>
      </span>
    );
  }
  if (!access.doctors.length) {
    return (
      <span className={`pill ${size} ${glass} items-center gap-1 border-amber-400/30 bg-amber-500/10 text-amber-300`}>
        <IconUserQuestion size={compact ? 9 : 11} /> {t("pa.badge.unassigned")}
      </span>
    );
  }
  return (
    <span className={`pill ${size} ${glass} items-center gap-1 border-sky/30 bg-sky/10 text-[#B8D4EA]`}>
      <IconUserShield size={compact ? 9 : 11} /> {access.doctors.map((d) => d.name).join(", ")}
    </span>
  );
}
