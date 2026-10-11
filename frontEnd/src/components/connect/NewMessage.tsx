"use client";
// CLINICOS CONNECT (C2) — "New message": a staff picker. You can only choose from the list of active colleagues; there is no
// free-text user id. Choosing someone calls the real C1 open-direct API, which finds the existing private conversation or creates
// it (one per pair — C1 guarantees that, so choosing the same person twice just opens the same chat).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import type { StaffPerson } from "@/lib/connect/types";
import { Avatar, roleLabel } from "./ui";
import s from "./connect.module.css";

export function NewMessage({
  staff,
  loading,
  loadError,
  onRetry,
  onClose,
  onPick,
}: {
  staff: StaffPerson[];
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  onClose: () => void;
  onPick: (person: StaffPerson) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const dlg = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  const people = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? staff.filter((p) => `${p.name} ${roleLabel(t, p.role)}`.toLowerCase().includes(n)) : staff;
  }, [staff, q, t]);

  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => setActive(0), [q]);

  const pick = async (p: StaffPerson) => {
    if (busyId) return;
    setBusyId(p.id);
    setFailed(false);
    const ok = await onPick(p);
    if (!ok) {
      setBusyId(null);
      setFailed(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(people.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && document.activeElement === input.current && people[active]) {
      e.preventDefault();
      void pick(people[active]);
    } else if (e.key === "Tab") {
      // keep focus inside the dialog
      const f = Array.from(dlg.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input") ?? []);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKeyDown}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="nm-title" ref={dlg} data-testid="new-message-dialog">
        <div className={s.dlgHead}>
          <h2 id="nm-title">{t("msg.new")}</h2>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label={t("msg.close")}>
            <IconX size={18} stroke={1.8} />
          </button>
        </div>
        <label className={`${s.search} ${s.dlgSearch}`}>
          <span className={s.sr}>{t("msg.nmSearch")}</span>
          <IconSearch size={17} stroke={1.8} aria-hidden="true" />
          <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("msg.nmSearch")} autoComplete="off" data-testid="nm-search" />
        </label>
        {failed && <div className={s.dlgErr} role="alert">{t("msg.nmOpenErr")}</div>}
        {loading ? (
          <div className={s.dlgMsg} aria-busy="true"><span className={s.spin} /></div>
        ) : loadError ? (
          <div className={s.dlgMsg} role="alert">
            {t("msg.nmErr")}
            <div><button type="button" className={s.btn} onClick={onRetry}>{t("msg.tryAgain")}</button></div>
          </div>
        ) : staff.length === 0 ? (
          <div className={s.dlgMsg}>{t("msg.nmEmpty")}</div>
        ) : people.length === 0 ? (
          <div className={s.dlgMsg}>{t("msg.nmNone")}</div>
        ) : (
          <ul className={s.dlgList} aria-label={t("msg.nmHint")}>
            {people.map((p, i) => (
              <li key={p.id}>
                <button type="button" className={s.person} data-active={i === active} disabled={!!busyId && busyId !== p.id} onClick={() => void pick(p)} onMouseEnter={() => setActive(i)} data-testid="nm-person">
                  <Avatar name={p.name} role={p.role} small />
                  <span>
                    <b dir="auto">{p.name}</b>
                    <small>{roleLabel(t, p.role)}</small>
                  </span>
                  {busyId === p.id && <span className={s.spin} role="status" aria-label="…" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
