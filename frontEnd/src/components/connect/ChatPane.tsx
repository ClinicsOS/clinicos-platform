"use client";
// CLINICOS CONNECT (C2) — the centre pane for one conversation: header, messages, composer and every honest state around them
// (loading, error, "no longer available"). Mark-as-read happens here, and only when the latest message is actually in view.
import { useEffect, useRef, useState } from "react";
import { IconArrowLeft, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useCards, useMarkRead, usePageVisible, useThread } from "@/lib/connect/hooks";
import { latestMessage, seqOf } from "@/lib/connect/messageStore";
import { rtSubscribe, rtUnsubscribe } from "@/lib/connect/realtime/provider";
import { useTypingNames, useTypingSignal } from "@/lib/connect/realtime/typing";
import type { ConnectErrorKind } from "@/lib/connect/errors";
import type { ConversationSummary } from "@/lib/connect/types";
import { MessageStream } from "./MessageStream";
import { Composer } from "./Composer";
import { Avatar, cx, roleLabel, type ShellLayout } from "./ui";
import { convTitle } from "./ConversationList";
import s from "./connect.module.css";

export function ChatPane({
  conversation,
  myId,
  layout,
  drafts,
  onBack,
  onSent,
  onBlocked,
  onGone,
  band,
  bandOpen,
  onToggleBand,
}: {
  conversation: ConversationSummary;
  myId: string;
  layout: ShellLayout;
  drafts: React.MutableRefObject<Map<string, string>>;
  onBack: () => void;
  onSent: (kind?: "appointment" | "patient") => void;
  /** The server refused with a plan / suspension answer: the whole screen switches to the matching state. */
  onBlocked: (kind: ConnectErrorKind) => void;
  onGone: () => void;
  band?: React.ReactNode;
  bandOpen?: boolean;
  onToggleBand?: () => void;
}) {
  const { t } = useI18n();
  const id = conversation.id;
  const th = useThread(id, myId);
  const markRead = useMarkRead();
  const visible = usePageVisible();
  const [near, setNear] = useState(true);
  const baseline = useRef<string | null | undefined>(undefined);

  const isTeam = conversation.type === "clinic_team";
  const typers = useTypingNames(id);
  const typing = useTypingSignal(id, !(!isTeam && conversation.peer?.isActive === false));
  const peerReadSeq = !isTeam && conversation.peerLastReadCursor ? seqOf(conversation.peerLastReadCursor) : null;
  const peerInactive = !isTeam && conversation.peer?.isActive === false;
  const name = convTitle(conversation, t);

  // ask the server to relay typing for this conversation (it verifies membership); a no-op when there is no realtime connection
  useEffect(() => {
    rtSubscribe(id);
    return () => rtUnsubscribe(id);
  }, [id]);

  // escalate answers that change the whole screen
  useEffect(() => {
    if (th.blocked === "plan" || th.blocked === "suspended") onBlocked(th.blocked);
  }, [th.blocked, onBlocked]);

  const latest = th.thread ? latestMessage(th.thread) : undefined;
  if (th.thread && baseline.current === undefined) baseline.current = latest?.id ?? null;

  // Mark read only when the conversation is really being looked at: tab visible, scrolled to the newest message, and there is
  // something from someone else that is newer than what we opened with (or the server says it is unread).
  useEffect(() => {
    if (!th.thread || !latest || !visible || !near) return;
    if (latest.senderId === myId) return; // sending already moves my own read position
    const arrivedWhileOpen = latest.id !== baseline.current;
    if (!arrivedWhileOpen && conversation.unreadCount === 0) return;
    const timer = window.setTimeout(() => void markRead(id, latest.id), 250);
    return () => window.clearTimeout(timer);
  }, [th.thread, latest?.id, latest?.senderId, visible, near, conversation.unreadCount, id, myId, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  const { cards, failed: cardsFailed, retry: retryCards } = useCards(id, th.thread?.messages ?? []);

  const shareCard: React.ComponentProps<typeof Composer>["onShare"] = (ref, note, card) => {
    const r = th.sendReference(ref, note, card);
    if (r.ok) onSent(ref.type);
    return r;
  };

  const send = (text: string) => {
    const r = th.send(text);
    if (r.ok) onSent();
    return r;
  };

  const header = (
    <header className={s.chatHead}>
      <button type="button" className={cx(s.iconBtn, s.backBtn)} onClick={onBack} aria-label={t("msg.back")} data-testid="chat-back">
        <IconArrowLeft size={20} stroke={1.8} className="rtl-flip" />
      </button>
      <Avatar team={isTeam} name={name} role={conversation.peer?.role} />
      <div className={s.chWho}>
        <h2 className={s.chName} dir="auto" data-testid="chat-title">{name}</h2>
        <div className={s.chSub}>
          {isTeam ? (
            <span>{typeof conversation.memberCount === "number" ? `${conversation.memberCount} ${t("msg.members")}` : t("msg.secTeam")}</span>
          ) : (
            <>
              <span className={cx(s.role, s.who)} data-role={conversation.peer?.role}>{roleLabel(t, conversation.peer?.role)}</span>
              {peerInactive && (
                <>
                  <i className={s.sep} aria-hidden="true" />
                  <span>{t("msg.inactiveTag")}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {layout === "tablet" && onToggleBand && (
        <button type="button" className={s.iconBtn} onClick={onToggleBand} aria-expanded={bandOpen} aria-label={t("msg.space")} title={t("msg.space")}>
          {bandOpen ? <IconChevronUp size={18} stroke={1.8} /> : <IconChevronDown size={18} stroke={1.8} />}
        </button>
      )}
    </header>
  );

  let body: React.ReactNode;
  if (th.blocked === "gone" || th.blocked === "forbidden") {
    body = (
      <div className={s.center} role="alert" data-testid="conversation-gone">
        <div>
          <div className={s.orb} aria-hidden="true" />
          <h3>{t("msg.goneTitle")}</h3>
          <p>{t("msg.goneSub")}</p>
          <button type="button" className={s.btn} onClick={onGone}>{t("msg.goBack")}</button>
        </div>
      </div>
    );
  } else if (th.blocked === "server" && !th.thread) {
    body = (
      <div className={s.center} role="alert">
        <div>
          <h3>{t("msg.loadErr")}</h3>
          <button type="button" className={s.btn} onClick={th.reload}>{t("msg.tryAgain")}</button>
        </div>
      </div>
    );
  } else if (!th.thread) {
    body = (
      <div className={s.skelBubbles} aria-busy="true" data-testid="thread-skeleton">
        {[60, 40, 70, 45].map((w, i) => (
          <div key={i} className={cx(s.skelBub, s.skel)} style={{ width: `${w}%`, justifySelf: i % 2 ? "end" : "start" }} />
        ))}
      </div>
    );
  } else {
    body = (
      <>
        <MessageStream
          key={id}
          conversationId={id}
          type={conversation.type}
          thread={th.thread}
          myId={myId}
          loadingOlder={th.loadingOlder}
          onLoadOlder={th.loadOlder}
          onNearBottom={setNear}
          onRetry={th.retry}
          onDiscard={th.discard}
          cards={cards}
          cardsFailed={cardsFailed}
          onCardsRetry={retryCards}
          emptyTitle={isTeam ? t("msg.emptyTeam") : t("msg.emptyDm")}
          emptySub={isTeam ? t("msg.emptyTeamSub") : t("msg.emptyDmSub")}
          peerReadSeq={peerReadSeq}
        />
        <div className={s.typing} aria-live="polite" data-testid="typing">
          {typers.length > 0 && (
            <>
              <span className={s.dots} aria-hidden="true"><i /><i /><i /></span>
              <span dir="auto">{typers.length === 1 ? `${typers[0]} ${t("msg.typingOne")}` : t("msg.typingMany")}</span>
            </>
          )}
        </div>
        <Composer
          key={id}
          conversationId={id}
          disabled={peerInactive}
          disabledReason={peerInactive ? t("msg.inactivePeer") : undefined}
          initialDraft={drafts.current.get(id) ?? ""}
          onDraft={(v) => drafts.current.set(id, v)}
          onSend={send}
          onTyping={typing.notify}
          onTypingStop={typing.stop}
          onShare={shareCard}
          autoFocus={layout !== "mobile"}
        />
      </>
    );
  }

  return (
    <section className={s.chat} aria-label={name}>
      <div className={s.chatIn}>
        {header}
        {layout === "tablet" && bandOpen && band}
        {body}
      </div>
    </section>
  );
}
