"use client";
// CLINICOS CONNECT (C2) — the Team Space: a 3D scene (progressive enhancement) over a polished CSS/SVG fallback that is always
// rendered first. The 3D engine is loaded on demand; if WebGL is missing, the context is lost, the user prefers less data, or the
// import fails, the fallback simply stays. The scene shows who is on the team — never any conversation content.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconShieldLock } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { fallbackPositions, orderPeople, type FrameKind, type TeamPerson } from "@/lib/connect/team3d/layout";
import type { PulseKind, TeamSpaceEngine } from "@/lib/connect/team3d/engine";
import { Avatar, cx, roleLabel } from "./ui";
import s from "./connect.module.css";

const ROLE_GRAD: Record<string, [string, string]> = {
  owner: ["#E6CB8B", "#B98A3C"],
  doctor: ["#6FBDF5", "#2379CC"],
  receptionist: ["#6FDCCB", "#1E9C95"],
};

export function TeamSpace({
  variant,
  mode,
  me,
  others,
  peerId,
  pulseKey,
  pulseKind = "text",
  incomingKey = 0,
  incomingKind = "text",
  incomingFrom = null,
  memberCount,
}: {
  variant: "panel" | "band";
  mode: "team" | "dm";
  me: TeamPerson;
  others: TeamPerson[];
  peerId: string | null;
  pulseKey: number;
  /** C4: kind of the message I just sent (generic shapes only — no record identity ever reaches the scene). */
  pulseKind?: PulseKind;
  incomingKind?: PulseKind;
  /** C3: bumps when somebody else's message arrives live; `incomingFrom` = who sent it. */
  incomingKey?: number;
  incomingFrom?: string | null;
  memberCount?: number;
}) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const dark = theme !== "light";
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TeamSpaceEngine | null>(null);
  const [glReady, setGlReady] = useState(false);

  const { shown, hidden } = useMemo(() => orderPeople(me, others, mode === "dm" ? peerId : null), [me, others, peerId, mode]);
  const kind: FrameKind = variant;
  const fb = useMemo(() => fallbackPositions(shown.length, kind), [shown.length, kind]);
  const peer = mode === "dm" ? shown.find((p) => p.id === peerId) : undefined;

  // keep the latest values reachable from the async engine start-up
  const latest = useRef({ shown, hidden, mode, peerId, dark, lang });
  latest.current = { shown, hidden, mode, peerId, dark, lang };

  const nodeInputs = () =>
    latest.current.shown.map((p) => ({ ...p, isMe: p.id === me.id, roleText: roleLabel(t, p.role), label: p.id === me.id ? t("msg.spaceMe") : p.name }));

  // start / stop the 3D engine
  useEffect(() => {
    let cancelled = false;
    let engine: TeamSpaceEngine | null = null;
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    const saveData = (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    (async () => {
      try {
        const mod = await import("@/lib/connect/team3d/engine");
        if (cancelled || !mod.webglAvailable()) return;
        engine = new mod.TeamSpaceEngine({
          host,
          labels,
          dark: latest.current.dark,
          reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
          variant,
          classes: { label: s.nlabel, role: s.nr, name: s.nn },
          onLost: () => {
            engine?.dispose();
            engineRef.current = null;
            engine = null;
            setGlReady(false);
          },
        });
        if (cancelled) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        engine.setPeople(nodeInputs(), latest.current.hidden);
        engine.setMode(latest.current.mode, latest.current.peerId);
        setGlReady(true);
      } catch {
        engineRef.current = null;
        setGlReady(false); // the fallback stays; nothing else to do
      }
    })();
    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
      setGlReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  useEffect(() => {
    engineRef.current?.setPeople(nodeInputs(), hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, hidden, lang, glReady]);
  useEffect(() => { engineRef.current?.setMode(mode, peerId); }, [mode, peerId, glReady]);
  useEffect(() => { engineRef.current?.setTheme(dark); }, [dark, glReady]);
  const firstPulse = useRef(pulseKey);
  useEffect(() => {
    if (pulseKey !== firstPulse.current) engineRef.current?.pulse(pulseKind);
  }, [pulseKey]);

  const firstIncoming = useRef(incomingKey);
  useEffect(() => {
    if (incomingKey !== firstIncoming.current) engineRef.current?.incoming(incomingFrom, incomingKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingKey]);

  const stage = (
    <div ref={hostRef} className={s.scene} data-gl={glReady ? "on" : "off"} data-testid="team-scene" data-variant={variant}>
      {/* CSS/SVG fallback — also what you see before the 3D scene has loaded */}
      <div className={s.fb} aria-hidden="true">
        <svg className={s.fbLines} viewBox="0 0 100 100" preserveAspectRatio="none">
          {fb.nodes.map((p, i) => (
            <line key={shown[i]?.id ?? i} x1={fb.core[0]} y1={fb.core[1]} x2={p[0]} y2={p[1]} style={{ strokeOpacity: mode === "dm" && shown[i]?.id !== peerId && shown[i]?.id !== me.id ? 0.12 : 0.5 }} />
          ))}
        </svg>
        <div className={s.fbCore} style={{ left: `${fb.core[0]}%`, top: `${fb.core[1]}%` }} />
        {shown.map((p, i) => {
          const [c1, c2] = ROLE_GRAD[p.role] ?? ["#A3ACF5", "#5B67D6"];
          const sel = mode === "dm" && p.id === peerId;
          const dim = mode === "dm" && p.id !== peerId && p.id !== me.id;
          return (
            <div key={p.id} className={s.fbNode} data-sel={sel ? 1 : 0} data-dim={dim ? 1 : 0} style={{ left: `${fb.nodes[i][0]}%`, top: `${fb.nodes[i][1]}%`, ["--c1" as string]: c1, ["--c2" as string]: c2 }}>
              {Array.from(p.name.trim())[0]?.toUpperCase()}
              <span className={s.fbLabel}>{p.id === me.id ? t("msg.spaceMe") : p.name.split(" ")[0]}</span>
            </div>
          );
        })}
      </div>
      <div ref={labelsRef} className={s.labels} />
    </div>
  );

  // screen readers get the team as a list; the scene itself is decorative
  const sr = (
    <ul className={s.sr} aria-label={t("msg.space")}>
      {shown.map((p) => (
        <li key={p.id}>{p.name} — {roleLabel(t, p.role)}</li>
      ))}
    </ul>
  );

  if (variant === "band") {
    return (
      <div className={cx(s.bandSlot, s.band)} data-testid="team-space-band">
        {stage}
        {sr}
      </div>
    );
  }

  return (
    <aside className={s.team} aria-label={t("msg.space")} data-testid="team-space">
      <div className={s.teamHead}>
        <h3>{t("msg.space")}</h3>
        {typeof memberCount === "number" && <span className={s.live}><i aria-hidden="true" />{memberCount} {t("msg.members")}</span>}
      </div>
      <div className={s.stageSlot}>{stage}</div>
      <div className={s.teamCard}>
        {mode === "dm" && peer ? (
          <div key={`dm-${peer.id}`}>
            <div className={s.tcWho}>
              <Avatar name={peer.name} role={peer.role} />
              <div>
                <b dir="auto">{peer.name}</b>
                <small>{roleLabel(t, peer.role)}</small>
              </div>
            </div>
            <div className={s.tcPriv}>
              <IconShieldLock size={15} stroke={1.8} aria-hidden="true" />
              <span>{t("msg.privacy")}</span>
            </div>
          </div>
        ) : (
          <div key="team">
            <div className={s.tcTitle}>
              {t("msg.connected1")}
              <span>{t("msg.connected2")}</span>
            </div>
            <div className={s.tcPriv}>
              <IconShieldLock size={15} stroke={1.8} aria-hidden="true" />
              <span>{t("msg.spacePriv")}</span>
            </div>
          </div>
        )}
      </div>
      {sr}
    </aside>
  );
}
