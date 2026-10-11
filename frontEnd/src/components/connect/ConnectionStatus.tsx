"use client";
// CLINICOS CONNECT (C3) — a subtle connection chip. Silent while connected (and during a short blip); after a moment it says
// "Reconnecting…" or "Offline". It never claims "online" for anybody else: this is only about THIS browser's live connection.
import { useEffect, useState } from "react";
import { IconWifiOff, IconRefresh } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { RT_CLIENT } from "@/lib/connect/realtime/config";
import { useRt } from "@/lib/connect/realtime/store";
import s from "./connect.module.css";

export function ConnectionStatus() {
  const { t } = useI18n();
  const status = useRt((st) => st.status);
  const since = useRt((st) => st.since);
  const [, tick] = useState(0);
  const bad = status === "reconnecting" || status === "offline" || status === "connecting";

  useEffect(() => {
    if (!bad) return;
    const wait = Math.max(0, RT_CLIENT.chipDelayMs - (Date.now() - since));
    const id = window.setTimeout(() => tick((n) => n + 1), wait + 20);
    return () => window.clearTimeout(id);
  }, [bad, since, status]);

  if (!bad || Date.now() - since < RT_CLIENT.chipDelayMs) return null;
  const offline = status === "offline";
  return (
    <div className={s.rtChip} role="status" aria-live="polite" data-testid="rt-status" data-status={status}>
      {offline ? <IconWifiOff size={14} stroke={2} aria-hidden="true" /> : <IconRefresh size={14} stroke={2} aria-hidden="true" className={s.rtSpin} />}
      {offline ? t("msg.rtOffline") : t("msg.rtReconnecting")}
    </div>
  );
}
