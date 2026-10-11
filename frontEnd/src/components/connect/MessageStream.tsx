"use client";
// CLINICOS CONNECT (C2) — the message list of one conversation: grouping, day separators, honest states (sending / not sent),
// cursor pagination that keeps your place, and the scroll rules (open at the latest; follow only if you are already near the bottom).
// Message text is always rendered as a plain text node — never as HTML.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconArrowDown, IconAlertCircle } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { NEAR_BOTTOM_PX } from "@/lib/connect/config";
import { seqOf } from "@/lib/connect/messageStore";
import { dayKey, dayKind, fmtClock, fmtDay } from "@/lib/connect/time";
import { isRefContent } from "@/lib/connect/cards";
import type { CardMap, ContentType, ConversationType, MessageDto, PendingMessage, Person, RefContentType, ThreadState } from "@/lib/connect/types";
import { ReferenceCard } from "./ReferenceCard";
import { Avatar, cx } from "./ui";
import s from "./connect.module.css";

interface Entry {
  key: string;
  senderId: string;
  sender: Person | null;
  text: string;
  /** C4: set for a card message (server-confirmed or pending). */
  refType?: RefContentType;
  createdAt: string;
  mine: boolean;
  pending?: PendingMessage;
  seq: number;
}
const refTypeOf = (c: ContentType | undefined): RefContentType | undefined => (isRefContent(c) ? c : undefined);

const GROUP_GAP_MS = 5 * 60_000;

export function MessageStream({
  conversationId,
  type,
  thread,
  myId,
  loadingOlder,
  onLoadOlder,
  onNearBottom,
  onRetry,
  onDiscard,
  cards,
  cardsFailed,
  onCardsRetry,
  emptyTitle,
  emptySub,
  peerReadSeq,
}: {
  conversationId: string;
  type: ConversationType;
  thread: ThreadState;
  myId: string;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<number>;
  onNearBottom: (near: boolean) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  /** C4: the cards resolved for THIS viewer (message id → card). A missing entry = still loading. */
  cards: CardMap;
  cardsFailed: Record<string, true>;
  onCardsRetry: () => void;
  emptyTitle: string;
  emptySub: string;
  /** DM only: the position the other person has read up to (from the server). Drives "Seen" — nothing else does. */
  peerReadSeq?: number | null;
}) {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const nearRef = useRef(true);
  const anchor = useRef<{ h: number; top: number } | null>(null);
  // C5 — the row at the top of the viewport and how far below the top edge it sits. Content ABOVE the viewport can still change height after
  // it was laid out (a card resolving: skeleton → card, an image, a font); without this the reader's place jumps by the difference.
  const keep = useRef<{ el: HTMLElement; off: number } | null>(null);
  // set when WE move the scroll position: the scroll event that follows may be delivered only after late content growth, and must not
  // overwrite the place that was just recorded with the shifted geometry (it is consumed by exactly that event)
  const skipRemember = useRef(false);
  const followUntil = useRef(0);
  // scrollTop at the moment `keep` was recorded: if the scroll position has changed since (a jump whose scroll event has not been delivered yet),
  // `keep` describes a place the reader has already left and must NOT be restored
  const keepTop = useRef(0);
  const lastTop = useRef(0);
  const moveTo = (el: HTMLElement, top: number) => {
    const before = el.scrollTop;
    el.scrollTop = top;
    keepTop.current = el.scrollTop;
    if (el.scrollTop !== before) skipRemember.current = true;
  };
  const started = useRef(false);
  const lastKey = useRef<string | null>(null);
  const freshAfter = useRef<number | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [announce, setAnnounce] = useState("");

  const entries: Entry[] = useMemo(() => {
    const fromServer = thread.messages.map((m: MessageDto): Entry => ({
      key: m.id, senderId: m.senderId, sender: m.sender, text: m.text, refType: refTypeOf(m.contentType), createdAt: m.createdAt, mine: m.senderId === myId, seq: seqOf(m.cursor),
    }));
    const fromPending = thread.pending.map((p): Entry => ({
      key: p.clientId, senderId: myId, sender: null, text: p.text, refType: p.reference ? (p.reference.type === "patient" ? "patient_reference" : "appointment_reference") : undefined, createdAt: p.createdAt, mine: true, pending: p, seq: Number.MAX_SAFE_INTEGER,
    }));
    return [...fromServer, ...fromPending];
  }, [thread.messages, thread.pending, myId]);

  // "Seen" sits under MY newest confirmed message, and only when the other person's real read position has reached it
  let seenKey: string | null = null;
  if (type === "direct" && peerReadSeq) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].mine && !entries[i].pending) {
        if (entries[i].seq <= peerReadSeq) seenKey = entries[i].key;
        break;
      }
    }
  }

  if (freshAfter.current === null) freshAfter.current = thread.messages.length ? seqOf(thread.messages[thread.messages.length - 1].cursor) : 0;

  const toBottom = useCallback((smooth = false) => {
    const el = ref.current;
    if (!el) return;
    // a smooth scroll is cancelled by ANY later scrollTop assignment: holdPlace must stay out of its way while it runs
    if (smooth) followUntil.current = Date.now() + 1500;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (smooth && !reduce && el.scrollTo) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  const remember = useCallback(() => {
    const box = ref.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    keepTop.current = box.scrollTop;
    const list = box.querySelectorAll<HTMLElement>("[data-msg-row]");
    // rows are in document order, so their tops increase: binary-search the first row that is fully inside the viewport (O(log n) layout reads per
    // scroll event). A row cut by the top edge may itself be one that grows, which would not move its own top — so prefer the fully visible one.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].getBoundingClientRect().top >= top - 0.5) hi = mid;
      else lo = mid + 1;
    }
    if (lo < list.length) {
      keep.current = { el: list[lo], off: list[lo].getBoundingClientRect().top - top };
      return;
    }
    const last = list[list.length - 1];
    if (last && last.getBoundingClientRect().bottom > top + 1) {
      keep.current = { el: last, off: last.getBoundingClientRect().top - top };
      return;
    }
    keep.current = null;
  }, []);

  const setNear = useCallback((near: boolean) => {
    if (near !== nearRef.current) {
      nearRef.current = near;
      onNearBottom(near);
    }
    if (near) setNewCount(0);
  }, [onNearBottom]);

  // first paint of this conversation: open at the latest message
  useLayoutEffect(() => {
    toBottom();
    started.current = true;
    lastKey.current = entries.length ? entries[entries.length - 1].key : null;
    onNearBottom(true);
    nearRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // an older page was added on top: keep the reader exactly where they were
  const firstId = thread.messages[0]?.id;
  // C5 — hold the reader's place when something above the viewport changes size after layout (never while following the bottom).
  // Two triggers, same correction: right after a React commit (a card resolved → deterministic, before paint) and a ResizeObserver
  // (anything else that resizes: fonts, images, wrapping). Returns false when there was no usable anchor row.
  const holdPlace = useCallback((): boolean => {
    const box = ref.current;
    const k = keep.current;
    if (!box || !k || nearRef.current || !k.el.isConnected || Date.now() < followUntil.current) return false;
    if (Math.abs(box.scrollTop - keepTop.current) >= 1) return false;
    const delta = k.el.getBoundingClientRect().top - box.getBoundingClientRect().top - k.off;
    if (Math.abs(delta) >= 1) moveTo(box, box.scrollTop + delta);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor.current) return;
    // Prefer the anchor ROW: the "loading older" row above the list also changes the geometry (it appears, then is replaced by the page), and
    // the scrollHeight formula below cannot know the extra offset holdPlace applied meanwhile. The formula is the fallback (no scrolling reader).
    if (!holdPlace()) moveTo(el, anchor.current.top + (el.scrollHeight - anchor.current.h));
    anchor.current = null;
    remember();
  }, [firstId, remember, holdPlace]);

  useLayoutEffect(() => {
    holdPlace();
  });
  useEffect(() => {
    const box = ref.current;
    const inner = box?.firstElementChild as HTMLElement | null | undefined;
    if (!box || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => holdPlace());
    ro.observe(inner);
    return () => ro.disconnect();
  }, [holdPlace]);

  // something arrived / was sent at the bottom
  const tail = entries[entries.length - 1];
  useLayoutEffect(() => {
    if (!started.current) return;
    const prevKey = lastKey.current;
    const curKey = tail?.key ?? null;
    if (curKey === prevKey) return;
    lastKey.current = curKey;
    if (!tail) return;
    // a pending → confirmed swap of my own last message keeps the same position: nothing to do
    if (tail.mine) {
      toBottom(true);
      return;
    }
    if (nearRef.current) {
      toBottom(true);
    } else {
      const at = entries.findIndex((e) => e.key === prevKey);
      const added = at >= 0 ? entries.slice(at + 1).filter((e) => !e.mine).length : 1;
      setNewCount((c) => c + Math.max(1, added));
    }
    if (!tail.mine) setAnnounce(`${t("msg.srNewFrom")} ${tail.sender?.name ?? ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail?.key]);

  const loadOlder = useCallback(async () => {
    const el = ref.current;
    if (!el || loadingOlder || !thread.hasMoreOlder) return;
    anchor.current = { h: el.scrollHeight, top: el.scrollTop };
    const n = await onLoadOlder();
    if (n === 0) anchor.current = null;
  }, [loadingOlder, thread.hasMoreOlder, onLoadOlder]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setNear(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
    // the reader moved UP (a smooth scroll to the bottom only ever moves down): they are no longer following, so place-holding applies again
    if (el.scrollTop < lastTop.current - 1) followUntil.current = 0;
    lastTop.current = el.scrollTop;
    if (skipRemember.current) skipRemember.current = false;
    else remember();
    if (el.scrollTop < 120) void loadOlder();
  };

  // a tall panel can show every loaded message without a scrollbar: keep loading older pages until it fills or the history ends
  useEffect(() => {
    const el = ref.current;
    if (el && thread.hasMoreOlder && !loadingOlder && el.scrollHeight <= el.clientHeight + 4) void loadOlder();
  }, [thread.messages.length, thread.hasMoreOlder, loadingOlder, loadOlder]);

  const now = new Date();
  const rows: React.ReactNode[] = [];
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    const next = entries[i + 1];
    const day = dayKey(e.createdAt);
    if (!prev || dayKey(prev.createdAt) !== day) {
      const kind = dayKind(e.createdAt, now);
      rows.push(
        <div key={`d-${day}`} className={s.day} role="separator">
          {kind === "today" ? t("msg.today") : kind === "yesterday" ? t("msg.yesterday") : fmtDay(e.createdAt, lang, now)}
        </div>,
      );
    }
    const linked = (a: Entry, b: Entry | undefined) =>
      !!b && a.senderId === b.senderId && dayKey(a.createdAt) === dayKey(b.createdAt) && Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_GAP_MS;
    const first = !(prev && linked(prev, e));
    const last = !(next && linked(e, next));
    const showName = type === "clinic_team" && !e.mine && first;
    const showAvatar = type === "clinic_team" && !e.mine;
    const p = e.pending;
    rows.push(
      <div
        key={e.key}
        className={cx(s.row, e.mine && s.mine, first && s.gstart, !e.mine && e.seq > (freshAfter.current ?? 0) && s.fresh)}
        data-testid={p ? `msg-pending-${p.status}` : "msg"}
        data-msg-row=""
      >
        {showAvatar && <span className={s.avSlot}>{last ? <Avatar small name={e.sender?.name} role={e.sender?.role} /> : null}</span>}
        <div className={s.col}>
          {showName && <span className={cx(s.sender, s.who)} data-role={e.sender?.role} dir="auto">{e.sender?.name ?? "—"}</span>}
          {e.text !== "" || !e.refType ? (
            <div className={cx(s.bub, !first && s.jTop, !last && s.jBot, p?.status === "sending" && s.pend, p?.status === "failed" && s.fail)} dir="auto" data-testid="bubble">
              {e.text}
            </div>
          ) : null}
          {e.refType && (
            <ReferenceCard
              contentType={e.refType}
              card={p ? p.card : cards[e.key]}
              failed={!p && !!cardsFailed[e.key]}
              onRetry={onCardsRetry}
              pending={!!p}
            />
          )}
          {(last || p) && (
            <div className={s.meta}>
              {p ? (
                p.status === "sending" ? (
                  <span>{t("msg.sending")}</span>
                ) : (
                  <span className={s.failNote} role="alert">
                    <IconAlertCircle size={14} stroke={2} aria-hidden="true" />
                    {p.code === "OFFLINE" ? t("msg.failedOffline") : p.code === "RATE_LIMITED" ? t("msg.errRate") : p.code === "PARTICIPANT_INACTIVE" ? t("msg.inactivePeer") : p.uncertain ? t("msg.failedMaybe") : t("msg.failed")}
                    <button type="button" className={s.linkBtn} onClick={() => onRetry(p.clientId)} data-testid="retry-send">{t("msg.retry")}</button>
                    <button type="button" className={s.linkBtn} onClick={() => onDiscard(p.clientId)}>{t("msg.discard")}</button>
                  </span>
                )
              ) : (
                <>
                  <time dateTime={e.createdAt}>{fmtClock(e.createdAt, lang)}</time>
                  {e.key === seenKey && <span className={s.seen} data-testid="seen">{t("msg.seen")}</span>}
                </>
              )}
            </div>
          )}
        </div>
      </div>,
    );
  });

  return (
    <div className={s.pillWrap}>
      <div
        ref={ref}
        className={s.stream}
        onScroll={onScroll}
        role="log"
        aria-live="off"
        aria-label={t("msg.streamLabel")}
        tabIndex={0}
        data-testid="stream"
        data-conversation={conversationId}
      >
        <div className={s.streamIn}>
          {thread.hasMoreOlder ? (
            <div className={s.olderRow} aria-live="polite" data-testid="older-loading">
              {loadingOlder ? (
                <>
                  <span className={cx(s.skelOlder)} aria-hidden="true" />
                  <span className={s.sr}>{t("msg.loadingOlder")}</span>
                </>
              ) : null}
            </div>
          ) : entries.length > 0 ? (
            <div className={s.olderRow} data-testid="start-of-conversation">{t("msg.startOfConv")}</div>
          ) : null}
          {entries.length === 0 ? (
            <div className={s.center}>
              <div>
                <div className={s.orb} aria-hidden="true" />
                <h3>{emptyTitle}</h3>
                <p>{emptySub}</p>
              </div>
            </div>
          ) : (
            rows
          )}
        </div>
      </div>
      {newCount > 0 && (
        <button type="button" className={s.newPill} onClick={() => { toBottom(false); setNear(true); }} data-testid="new-messages-pill">
          <IconArrowDown size={15} stroke={2.2} aria-hidden="true" />
          {t("msg.newMessages")} · {newCount}
        </button>
      )}
      <div className={s.sr} role="status" aria-live="polite">{announce}</div>
    </div>
  );
}
