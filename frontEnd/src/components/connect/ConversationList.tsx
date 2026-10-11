"use client";
// CLINICOS CONNECT (C2) — the conversation list: Clinic Team first, then direct messages. Only conversations the server returned
// (C1 membership rules) are ever shown; search and the Unread filter work on that list in the browser and never ask for more.
import { useMemo, useRef, useState } from "react";
import { IconLock, IconPencilPlus, IconSearch } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { fmtListTime } from "@/lib/connect/time";
import { previewLabelKey } from "@/lib/connect/cards";
import type { ConversationSummary } from "@/lib/connect/types";
import { Avatar, cx, roleLabel } from "./ui";
import s from "./connect.module.css";

export const convTitle = (c: ConversationSummary, t: (k: string) => string) => (c.type === "clinic_team" ? t("msg.team") : c.peer?.name ?? "—");

const shownCount = (n: number) => (n > 99 ? "99+" : String(n));

export function ConversationList({
  conversations,
  loading,
  activeId,
  totalUnread,
  onSelect,
  onNew,
  error,
  onRetry,
  header,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  activeId: string | null;
  totalUnread: number;
  onSelect: (id: string) => void;
  onNew: () => void;
  error: boolean;
  onRetry: () => void;
  header?: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const listRef = useRef<HTMLUListElement>(null);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === "unread" && c.unreadCount === 0) return false;
      if (!needle) return true;
      const hay = `${convTitle(c, t)} ${c.type === "direct" ? roleLabel(t, c.peer?.role) : ""} ${c.lastMessage?.preview ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [conversations, q, filter, t]);

  const team = visible.filter((c) => c.type === "clinic_team");
  const directs = visible.filter((c) => c.type === "direct");

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-conv]") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  const row = (c: ConversationSummary) => {
    const isTeam = c.type === "clinic_team";
    const name = convTitle(c, t);
    const unread = c.unreadCount > 0;
    // C4: a card message shows a generic label (never the record's name) plus the sender's optional note
    const cardKey = c.lastMessage ? previewLabelKey(c.lastMessage.contentType) : null;
    const prevText = c.lastMessage ? (cardKey ? (c.lastMessage.preview ? `${t(cardKey)} · ${c.lastMessage.preview}` : t(cardKey)) : c.lastMessage.preview) : t("msg.noMessages");
    const prevMine = !!c.lastMessage?.isMine;
    const time = c.lastMessageAt ? fmtListTime(c.lastMessageAt, lang, { yesterday: t("msg.yesterday") }) : "";
    return (
      <li key={c.id}>
        <button
          type="button"
          data-conv={c.id}
          data-testid={isTeam ? "conv-team" : "conv-direct"}
          className={cx(s.conv, unread && s.unread)}
          aria-current={activeId === c.id ? "true" : undefined}
          onClick={() => onSelect(c.id)}
        >
          <Avatar team={isTeam} name={name} role={c.peer?.role} />
          <span className={s.convBody}>
            <span className={s.r1}>
              <span className={s.convName} dir="auto" data-testid="conv-name">{name}</span>
              <span className={s.convTime}>{time}</span>
            </span>
            {!isTeam && c.peer?.role ? (
              <span className={s.convRole}>
                {roleLabel(t, c.peer.role)}
                {c.peer.isActive === false ? ` · ${t("msg.inactiveTag")}` : ""}
              </span>
            ) : isTeam && typeof c.memberCount === "number" ? (
              <span className={s.convRole}>{c.memberCount} {t("msg.members")}</span>
            ) : null}
            <span className={s.r3}>
              <span className={s.convPrev} data-testid="conv-preview">
                {prevMine && <span>{t("msg.you")}: </span>}
                <bdi dir="auto">{prevText}</bdi>
              </span>
              {unread && (
                <>
                  <span className={s.badge} aria-hidden="true" data-testid="conv-badge">{shownCount(c.unreadCount)}</span>
                  <span className={s.sr}>{c.unreadCount} {t("msg.unreadAria")}</span>
                </>
              )}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <aside className={s.side} aria-label={t("msg.listLabel")}>
      <div className={s.sideTop}>
        <div className={s.head}>
          <h2>{t("nav.messages")}</h2>
          {totalUnread > 0 && <span className={s.badge} aria-hidden="true">{shownCount(totalUnread)}</span>}
          <button type="button" className={s.iconBtn} onClick={onNew} aria-label={t("msg.new")} title={t("msg.new")} data-testid="new-message">
            <IconPencilPlus size={20} stroke={1.8} />
          </button>
        </div>
        <label className={s.search}>
          <span className={s.sr}>{t("msg.search")}</span>
          <IconSearch size={17} stroke={1.8} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("msg.search")} autoComplete="off" data-testid="conv-search" />
        </label>
        <div className={s.filters} role="group" aria-label={t("msg.listLabel")}>
          <button type="button" className={s.chip} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("msg.all")}</button>
          <button type="button" className={s.chip} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")} data-testid="filter-unread">
            {t("msg.unread")}
            {totalUnread > 0 && <span className={s.sr}> ({totalUnread})</span>}
          </button>
        </div>
      </div>

      {header}

      {loading ? (
        <div className={s.skelRows} aria-busy="true" data-testid="list-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={s.skelRow}>
              <div className={cx(s.skelAv, s.skel)} />
              <div>
                <div className={cx(s.skelLine, s.skel)} style={{ width: "55%" }} />
                <div className={cx(s.skelLine, s.skel)} style={{ width: "85%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className={s.noRes} role="alert">
          <p>{t("msg.loadErr")}</p>
          <button type="button" className={s.btn} onClick={onRetry}>{t("msg.tryAgain")}</button>
        </div>
      ) : (
        <ul className={s.list} ref={listRef} onKeyDown={onKey}>
          {team.length > 0 && <li className={s.secLabel} role="presentation">{t("msg.secTeam")}</li>}
          {team.map(row)}
          {(directs.length > 0 || (filter === "all" && !q.trim())) && <li className={s.secLabel} role="presentation">{t("msg.secDirect")}</li>}
          {directs.map(row)}
          {visible.length === 0 && (
            <li className={s.noRes}>{filter === "unread" && !q.trim() ? t("msg.noUnread") : t("msg.noResults")}</li>
          )}
          {filter === "all" && !q.trim() && directs.length === 0 && <li className={s.noRes}>{t("msg.noDirect")}</li>}
        </ul>
      )}

      <div className={s.sideFoot}>
        <IconLock size={15} stroke={1.8} aria-hidden="true" />
        <span>{t("msg.privacy")}</span>
      </div>
    </aside>
  );
}
