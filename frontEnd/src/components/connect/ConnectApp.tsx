"use client";
// CLINICOS CONNECT (C2) — the Messages screen: conversation list | chat | Team Space (3D). Everything shown comes from the real
// C1 API (/api/connect/*). Who may see what is decided by the server on every request; nothing here trusts a role or a clinic id.
import { useCallback, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { useConversations, useEligibleStaff, useOpenDirect } from "@/lib/connect/hooks";
import type { ConnectErrorKind } from "@/lib/connect/errors";
import type { ConversationSummary, StaffPerson } from "@/lib/connect/types";
import type { TeamPerson } from "@/lib/connect/team3d/layout";
import { orderPeople } from "@/lib/connect/team3d/layout";
import { ConversationList } from "./ConversationList";
import { ChatPane } from "./ChatPane";
import { NewMessage } from "./NewMessage";
import { TeamSpace } from "./TeamSpace";
import type { PulseKind } from "@/lib/connect/team3d/engine";
import { ConnectLocked } from "./ConnectLocked";
import { ConnectionStatus } from "./ConnectionStatus";
import { useRt } from "@/lib/connect/realtime/store";
import { Avatar, useShellLayout } from "./ui";
import s from "./connect.module.css";

export function ConnectApp() {
  const { t } = useI18n();
  const user = useAuth((st) => st.user);
  const me: TeamPerson = useMemo(() => ({ id: user?.id ?? "", name: user?.name ?? "", role: user?.role ?? "" }), [user?.id, user?.name, user?.role]);
  const [ref, layout] = useShellLayout<HTMLDivElement>();

  const list = useConversations(true);
  const staffQ = useEligibleStaff(true);
  const openDirect = useOpenDirect();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "chat">("list");
  const [newOpen, setNewOpen] = useState(false);
  const [bandOpen, setBandOpen] = useState(true);
  const [pulseKey, setPulseKey] = useState(0);
  const [pulseKind, setPulseKind] = useState<PulseKind>("text");
  const [blocked, setBlocked] = useState<ConnectErrorKind | null>(null);
  // a subtle pulse in the 3D scene (and its CSS fallback) when somebody else's message arrives live; the engine skips it under reduced motion
  const pulseNonce = useRt((st) => st.pulse?.nonce ?? 0);
  const pulseFrom = useRt((st) => st.pulse?.senderId ?? null);
  const pulseIncomingKind = useRt((st) => st.pulse?.kind ?? "text");
  const drafts = useRef(new Map<string, string>());
  // conversations I opened in this visit: kept in the list while selected even if the server (correctly) does not list them yet
  const opened = useRef(new Map<string, ConversationSummary>());

  const server = list.conversations;
  const conversations = useMemo(() => {
    const sel = selectedId ? opened.current.get(selectedId) : undefined;
    const merged = sel && !server.some((c) => c.id === sel.id) ? [...server, sel] : server;
    // Clinic Team first, then newest activity (the server already sorts; this keeps the team pinned on top)
    return merged.slice().sort((a, b) => (a.type === b.type ? 0 : a.type === "clinic_team" ? -1 : 1));
  }, [server, selectedId]);
  const totalUnread = useMemo(() => conversations.reduce((n, c) => n + c.unreadCount, 0), [conversations]);

  const listKind = list.error?.kind ?? null;
  const lockKind: ConnectErrorKind | null = blocked === "plan" || blocked === "suspended" ? blocked : listKind === "plan" || listKind === "suspended" ? listKind : null;
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const team = conversations.find((c) => c.type === "clinic_team");

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setView("chat");
  }, []);
  const back = useCallback(() => setView("list"), []);
  const gone = useCallback(() => {
    setSelectedId(null);
    setView("list");
    void list.refetch();
  }, [list]);

  const pick = async (p: StaffPerson): Promise<boolean> => {
    try {
      const conv = await openDirect.mutateAsync(p.id);
      opened.current.set(conv.id, conv);
      select(conv.id);
      setNewOpen(false);
      return true;
    } catch {
      return false;
    }
  };

  if (lockKind) return <ConnectLocked reason={lockKind === "plan" ? "plan" : "suspended"} />;

  const mode: "team" | "dm" = selected && selected.type === "direct" ? "dm" : "team";
  const peerId = selected?.type === "direct" ? selected.peer?.id ?? null : null;
  const others: TeamPerson[] = staffQ.staff;
  const space = (variant: "panel" | "band") => (
    <TeamSpace variant={variant} mode={mode} me={me} others={others} peerId={peerId} pulseKey={pulseKey} pulseKind={pulseKind} incomingKey={pulseNonce} incomingKind={pulseIncomingKind} incomingFrom={pulseFrom} memberCount={team?.memberCount} />
  );

  const mobileHeader =
    layout === "mobile" ? (
      <div className={s.miniStrip} data-testid="mobile-team-strip">
        <div className={s.miniFaces} aria-hidden="true">
          {orderPeople(me, others, null, 5).shown.map((p) => (
            <Avatar key={p.id} name={p.name} role={p.role} small />
          ))}
        </div>
        <div className={s.miniText}>
          {t("msg.connected1")}
          <span>{t("msg.connected2")}</span>
        </div>
      </div>
    ) : null;

  const emptyChat = (
    <section className={s.chat} aria-label={t("nav.messages")}>
      <div className={s.chatIn}>
        {layout === "tablet" && bandOpen && space("band")}
        <div className={s.center} data-testid="chat-empty">
          <div>
            <div className={s.orb} aria-hidden="true" />
            <h3>
              {t("msg.connected1")}
              <br />
              {t("msg.connected2")}
            </h3>
            <p>{t("msg.emptySub")}</p>
            {team && (
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => select(team.id)} data-testid="open-team">
                {t("msg.team")}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div ref={ref} className={s.shell} data-layout={layout} data-view={view} data-testid="messages-app">
      <ConnectionStatus />
      <ConversationList
        conversations={conversations}
        loading={list.loading}
        activeId={selectedId}
        totalUnread={totalUnread}
        onSelect={select}
        onNew={() => setNewOpen(true)}
        error={!!list.error && !list.loaded}
        onRetry={() => void list.refetch()}
        header={mobileHeader}
      />
      {selected ? (
        <ChatPane
          key={selected.id}
          conversation={selected}
          myId={me.id}
          layout={layout}
          drafts={drafts}
          onBack={back}
          onSent={(kind) => { setPulseKind(kind ?? "text"); setPulseKey((k) => k + 1); }}
          onBlocked={setBlocked}
          onGone={gone}
          band={layout === "tablet" ? space("band") : undefined}
          bandOpen={bandOpen}
          onToggleBand={() => setBandOpen((v) => !v)}
        />
      ) : selectedId && list.loaded ? (
        // the conversation I had open is no longer in the list the server returns for me
        <section className={s.chat}>
          <div className={s.center} role="alert" data-testid="conversation-gone">
            <div>
              <div className={s.orb} aria-hidden="true" />
              <h3>{t("msg.goneTitle")}</h3>
              <p>{t("msg.goneSub")}</p>
              <button type="button" className={s.btn} onClick={gone}>{t("msg.goBack")}</button>
            </div>
          </div>
        </section>
      ) : (
        emptyChat
      )}
      {layout === "desktop" && space("panel")}
      {newOpen && (
        <NewMessage
          staff={staffQ.staff}
          loading={staffQ.loading}
          loadError={!!staffQ.error}
          onRetry={() => void staffQ.refetch()}
          onClose={() => setNewOpen(false)}
          onPick={pick}
        />
      )}
    </div>
  );
}
