"use client";
// CLINICOS CONNECT (C2) — text composer. Enter sends, Shift+Enter inserts a new line (and never while an IME is composing).
// C4 adds ONE control: "Share" → Appointment / Patient (a ClinicOS record sent as a card). There are no generic attachments.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconCalendarEvent, IconPlus, IconSend2, IconUserCircle } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { MESSAGE_MAX_CHARS, codePointLength } from "@/lib/connect/text";
import type { CardView, RefInput, RefType } from "@/lib/connect/types";
import { SharePicker } from "./SharePicker";
import { cx } from "./ui";
import s from "./connect.module.css";

export function Composer({
  conversationId,
  disabled,
  disabledReason,
  initialDraft,
  onDraft,
  onSend,
  autoFocus,
  onTyping,
  onTypingStop,
  onShare,
}: {
  conversationId: string;
  disabled?: boolean;
  disabledReason?: string;
  initialDraft: string;
  onDraft: (v: string) => void;
  onSend: (text: string) => { ok: true } | { ok: false; reason: "empty" | "tooLong" };
  autoFocus?: boolean;
  /** Optional realtime typing hint (C3): called with the current text on every change. */
  onTyping?: (text: string) => void;
  onTypingStop?: () => void;
  /** C4: send a card. Omitted = no Share control. */
  onShare?: (ref: RefInput, note: string, card: CardView) => { ok: true } | { ok: false; reason: "tooLong" };
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialDraft);
  const [err, setErr] = useState<"empty" | "tooLong" | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState<RefType | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastSubmit = useRef(0); // guards against a double Enter reaching us before React has cleared the box

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus && !disabled) ta.current?.focus({ preventScroll: true });
  }, [autoFocus, disabled, conversationId]);

  // the Share menu closes on Escape and on any click outside it
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const chars = value.length > 3000 ? codePointLength(value) : value.length;
  const over = chars > MESSAGE_MAX_CHARS;

  const submit = () => {
    const now = Date.now();
    if (disabled || over || now - lastSubmit.current < 350) return;
    lastSubmit.current = now;
    const r = onSend(value);
    if (r.ok) {
      onTypingStop?.();
      setValue("");
      onDraft("");
      setErr(null);
      ta.current?.focus({ preventScroll: true });
    } else {
      setErr(r.reason);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const note = disabled && disabledReason ? disabledReason : err === "empty" ? t("msg.errEmpty") : err === "tooLong" || over ? t("msg.errTooLong") : "";

  return (
    <div className={s.composer}>
      <div className={s.cbox}>
        {onShare && (
          <div className={s.shareWrap} ref={menuRef}>
            <button
              type="button"
              className={s.iconBtn}
              disabled={disabled}
              onClick={() => setMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={t("share.btn")}
              title={t("share.btn")}
              data-testid="share-btn"
            >
              <IconPlus size={20} stroke={2} />
            </button>
            {menu && (
              <div className={s.shareMenu} role="menu" aria-label={t("share.menu")} data-testid="share-menu">
                <button type="button" role="menuitem" className={s.shareItem} onClick={() => { setMenu(false); setPicker("appointment"); }} data-testid="share-appointment">
                  <IconCalendarEvent size={19} stroke={1.8} aria-hidden="true" />
                  {t("share.appointment")}
                </button>
                <button type="button" role="menuitem" className={s.shareItem} onClick={() => { setMenu(false); setPicker("patient"); }} data-testid="share-patient">
                  <IconUserCircle size={19} stroke={1.8} aria-hidden="true" />
                  {t("share.patient")}
                </button>
              </div>
            )}
          </div>
        )}
        <textarea
          ref={ta}
          value={value}
          rows={1}
          disabled={disabled}
          placeholder={t("msg.placeholder")}
          aria-label={t("msg.composerLabel")}
          aria-describedby="connect-composer-note"
          aria-invalid={over || err === "tooLong" ? true : undefined}
          onChange={(e) => {
            lastSubmit.current = 0; // typing again re-arms Enter
            setValue(e.target.value);
            onDraft(e.target.value);
            onTyping?.(e.target.value);
            if (err) setErr(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => onTypingStop?.()}
          dir="auto"
          data-testid="composer"
        />
        <button type="button" className={s.send} onClick={submit} disabled={disabled || over || value.trim().length === 0} aria-label={t("msg.send")} title={t("msg.send")} data-testid="send">
          <IconSend2 size={20} stroke={2} className="rtl-flip" />
        </button>
      </div>
      {picker && onShare && <SharePicker type={picker} onClose={() => setPicker(null)} onSend={onShare} />}
      <div className={s.composerNote} id="connect-composer-note" aria-live="polite">
        <span className={cx((over || err === "tooLong" || (disabled && disabledReason)) && s.over)}>{note}</span>
        {chars > 3500 && <span className={cx(over && s.over)}>{chars} / {MESSAGE_MAX_CHARS}</span>}
      </div>
    </div>
  );
}
