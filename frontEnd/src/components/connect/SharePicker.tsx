"use client";
// CLINICOS CONNECT (C4) — "Share → Appointment / Patient". A modal (a bottom sheet on phones) that lists ONLY what the server's picker
// endpoints return for the signed-in user (permission-scoped, 20 per page, searchable — never the whole table), then lets the sender add
// an optional note and send. The chosen record is sent as { type, id }; the server re-validates it, so nothing here is trusted.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconArrowLeft, IconSearch, IconX } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useAppointmentPicker, usePatientPicker } from "@/lib/connect/hooks";
import { fmtClock, fmtDay } from "@/lib/connect/time";
import { MESSAGE_MAX_CHARS } from "@/lib/connect/text";
import type { ApptGroup, AppointmentCardData, CardView, PatientCardData, RefInput, RefType } from "@/lib/connect/types";
import { ReferenceCard } from "./ReferenceCard";
import { cx } from "./ui";
import s from "./connect.module.css";

const GROUPS: ApptGroup[] = ["today", "upcoming", "recent"];

export function SharePicker({
  type,
  onClose,
  onSend,
}: {
  type: RefType;
  onClose: () => void;
  onSend: (ref: RefInput, note: string, card: CardView) => { ok: true } | { ok: false; reason: "tooLong" };
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<ApptGroup>("today");
  const [chosen, setChosen] = useState<CardView | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const dlg = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  const patients = usePatientPicker(q, type === "patient" && !chosen);
  const appts = useAppointmentPicker(group, q, type === "appointment" && !chosen);
  const list = type === "patient" ? patients : appts;

  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const choosePatient = (p: PatientCardData) => setChosen({ messageId: "preview", contentType: "patient_reference", state: "ok", patient: p });
  const chooseAppt = (a: AppointmentCardData) => setChosen({ messageId: "preview", contentType: "appointment_reference", state: "ok", appointment: a });

  const send = () => {
    if (!chosen || chosen.state !== "ok") return;
    const id = chosen.contentType === "patient_reference" ? chosen.patient.id : chosen.appointment.id;
    const r = onSend({ type, id }, note, chosen);
    if (r.ok) onClose();
    else setErr(t("share.tooLong"));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      const f = Array.from(dlg.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea") ?? []);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  if (typeof document === "undefined") return null;
  const title = type === "patient" ? t("share.titlePatient") : t("share.titleAppt");
  return createPortal(
    <div className={cx(s.overlay, s.sheetOv)} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKeyDown}>
      <div className={cx(s.dialog, s.sheet)} role="dialog" aria-modal="true" aria-labelledby="sp-title" ref={dlg} data-testid="share-picker" data-type={type}>
        <div className={s.dlgHead}>
          {chosen && (
            <button type="button" className={s.iconBtn} onClick={() => { setChosen(null); setErr(null); }} aria-label={t("share.change")} title={t("share.change")} data-testid="sp-change">
              <IconArrowLeft size={18} stroke={1.8} className="rtl-flip" />
            </button>
          )}
          <h2 id="sp-title">{title}</h2>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label={t("msg.close")} data-testid="sp-close">
            <IconX size={18} stroke={1.8} />
          </button>
        </div>

        {chosen ? (
          <div className={s.spConfirm}>
            <ReferenceCard contentType={chosen.contentType} card={chosen} pending />
            <label className={s.spNote}>
              <span>{t("share.note")}</span>
              <textarea
                value={note}
                maxLength={MESSAGE_MAX_CHARS}
                rows={2}
                dir="auto"
                onChange={(e) => { setNote(e.target.value); setErr(null); }}
                data-testid="sp-note"
              />
            </label>
            <p className={s.spHint}>{t("share.cardNote")}</p>
            {err && <div className={s.dlgErr} role="alert">{err}</div>}
            <div className={s.spActions}>
              <button type="button" className={s.btn} onClick={onClose}>{t("msg.close")}</button>
              <button type="button" className={cx(s.btn, s.btnPrimary)} onClick={send} data-testid="sp-send">{t("share.sendCard")}</button>
            </div>
          </div>
        ) : (
          <>
            {type === "appointment" && (
              <div className={s.seg} role="tablist" aria-label={t("share.appointment")}>
                {GROUPS.map((g) => (
                  <button key={g} type="button" role="tab" aria-selected={group === g} data-active={group === g} data-testid={`sp-tab-${g}`} onClick={() => setGroup(g)}>
                    {t(`share.${g}`)}
                  </button>
                ))}
              </div>
            )}
            <label className={`${s.search} ${s.dlgSearch}`}>
              <span className={s.sr}>{type === "patient" ? t("share.searchPatients") : t("share.searchAppts")}</span>
              <IconSearch size={17} stroke={1.8} aria-hidden="true" />
              <input
                ref={input}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={type === "patient" ? t("share.searchPatients") : t("share.searchAppts")}
                autoComplete="off"
                dir="auto"
                data-testid="sp-search"
              />
            </label>
            {list.error ? (
              <div className={s.dlgMsg} role="alert">
                {t("share.loadErr")}
                <div><button type="button" className={s.btn} onClick={list.refetch}>{t("msg.tryAgain")}</button></div>
              </div>
            ) : list.pending && list.rows.length === 0 ? (
              <div className={s.dlgMsg} aria-busy="true"><span className={s.spin} /></div>
            ) : list.rows.length === 0 ? (
              <div className={s.dlgMsg} data-testid="sp-empty">{type === "patient" ? t("share.noPatients") : t("share.noAppts")}</div>
            ) : (
              <ul className={s.dlgList} aria-label={title}>
                {type === "patient"
                  ? patients.rows.map((p) => (
                      <li key={p.id}>
                        <button type="button" className={s.person} onClick={() => choosePatient(p)} data-testid="sp-row">
                          <span className={s.spIcon} aria-hidden="true">#{p.fileNumber}</span>
                          <span>
                            <b dir="auto">{p.fullName}</b>
                            <small>{t("share.fileNo")} #{p.fileNumber}</small>
                          </span>
                        </button>
                      </li>
                    ))
                  : appts.rows.map((a) => (
                      <li key={a.id}>
                        <button type="button" className={s.person} onClick={() => chooseAppt(a)} data-testid="sp-row">
                          <span className={s.spIcon} aria-hidden="true" dir="ltr">{fmtClock(a.startAt, lang)}</span>
                          <span>
                            <b dir="auto">{a.patientName ?? "—"}</b>
                            <small dir="auto">{fmtDay(a.startAt, lang)} · {a.doctorName ?? t("share.noDoctor")} · {t(`status.${a.status}`)}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                {list.hasMore && (
                  <li className={s.spMore}>
                    <button type="button" className={s.btn} onClick={list.loadMore} disabled={list.loadingMore} data-testid="sp-more">
                      {list.loadingMore ? <span className={s.spin} /> : t("share.loadMore")}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
