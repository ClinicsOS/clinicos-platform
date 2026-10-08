"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconClockHour4, IconHandStop, IconInfoCircle, IconLink, IconNfc, IconQrcode, IconUserCheck, IconX } from "@tabler/icons-react";
import { apiError, fmtNum, pointsWord, useCheckInsPending, useCheckInsRecent, useLT, useResolveCheckIn, type CheckInRow, type CheckInStatus } from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import { Avatar, ErrorBox, Pager, Skeleton, useFlash } from "./parts";
import { LoyaltyEmptyState, LoyaltyPanel, StatusOrb, SuccessBurst, type OrbStatus } from "./ui/LoyaltyUI";
import type { LoyaltyTab } from "./OverviewTab";

/**
 * Reception's check-in desk (Phase 5).
 * Patients tap "I'm here" on their Loyalty page → a PENDING request appears here. Reception confirms (the patient is
 * really here) or rejects. Confirming only records the arrival: it never awards points and never changes the
 * appointment (an appointment can optionally be linked for reference). Everything shown comes from the server; the
 * list refreshes by itself every few seconds while the tab is open.
 */

/** Re-render every `ms` so "waiting N min" stays honest without refetching. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export default function CheckInTab({ onGo, canConfigure }: { onGo: (tab: LoyaltyTab) => void; canConfigure: boolean }) {
  const { t } = useLT();
  const flash = useFlash();
  const pending = useCheckInsPending();
  const page = useLoyaltyUi((s) => s.checkInPage);
  const setPage = useLoyaltyUi((s) => s.setCheckInPage);
  const recent = useCheckInsRecent(page);
  const resolve = useResolveCheckIn();
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = useNow();
  // Cards the SERVER has just resolved stay on screen for a moment in their "done" state (the success animation only ever starts after the server answered).
  const [ghosts, setGhosts] = useState<{ row: CheckInRow; outcome: "confirmed" | "rejected"; at: number }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const rowsRef = useRef<CheckInRow[]>([]);

  const act = (row: CheckInRow, action: "confirm" | "reject", appointmentId?: string | null) => {
    setBusyId(row.id);
    resolve.mutate(
      { id: row.id, action, appointmentId },
      {
        onSuccess: () => {
          const at = Math.max(0, rowsRef.current.findIndex((r) => r.id === row.id));
          setGhosts((g) => [...g.filter((x) => x.row.id !== row.id), { row, outcome: action === "confirm" ? "confirmed" : "rejected", at }]);
          timers.current.push(setTimeout(() => setGhosts((g) => g.filter((x) => x.row.id !== row.id)), action === "confirm" ? 1900 : 1300));
          flash.show("ok", action === "confirm" ? t(`${row.patient?.fullName ?? "Patient"} checked in`, `تم تسجيل وصول ${row.patient?.fullName ?? "المريض"}`) : t("Request rejected", "تم رفض الطلب"));
        },
        onError: (e) => {
          const er = apiError(e, t("Couldn't update the request", "تعذّر تحديث الطلب"));
          const msg =
            er.code === "CHECKIN_NOT_PENDING"
              ? t("Someone else already handled this request.", "تمت معالجة هذا الطلب من قبل شخص آخر.")
              : er.code === "CHECKIN_EXPIRED"
              ? t("This request expired — the patient can check in again.", "انتهت صلاحية هذا الطلب — يمكن للمريض تسجيل الوصول مجددًا.")
              : er.message;
          flash.show("err", msg);
        },
        onSettled: () => setBusyId(null),
      }
    );
  };

  if (pending.isError) return <ErrorBox message={apiError(pending.error, t("Couldn't load check-in requests", "تعذّر تحميل طلبات تسجيل الوصول")).message} onRetry={() => pending.refetch()} />;
  if (pending.isLoading || !pending.data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  const d = pending.data;
  rowsRef.current = d.checkIns;
  const list: { row: CheckInRow; ghost?: "confirmed" | "rejected" }[] = d.checkIns.map((row) => ({ row }));
  [...ghosts]
    .sort((a, b) => a.at - b.at)
    .forEach((g) => {
      if (!list.some((x) => x.row.id === g.row.id)) list.splice(Math.min(g.at, list.length), 0, { row: g.row, ghost: g.outcome });
      else list.find((x) => x.row.id === g.row.id)!.ghost = g.outcome;
    });
  const waitingNow = d.checkIns.length;

  return (
    <div className="space-y-3">
      {flash.node}

      {!d.enabled && (
        <div className="flex flex-wrap items-start gap-2 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-xs text-amber-200">
          <IconInfoCircle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{t("Patient check-in is switched off, so patients can't send new requests. Requests already waiting can still be answered.", "تسجيل وصول المرضى متوقف، لذلك لا يستطيع المرضى إرسال طلبات جديدة. يمكنك الرد على الطلبات المنتظرة حاليًا.")}</span>
          {canConfigure && (
            <button className="shrink-0 underline underline-offset-2 hover:text-white" onClick={() => onGo("settings")}>
              {t("Open settings", "فتح الإعدادات")}
            </button>
          )}
        </div>
      )}

      {/* ===== waiting now ===== */}
      <LoyaltyPanel
        title={t("Waiting for confirmation", "بانتظار التأكيد")}
        icon={<IconUserCheck size={16} />}
        tone={waitingNow > 0 ? "gold" : undefined}
        testId="ck-waiting"
        action={
          <span className="flex items-center gap-3">
            <span className="lyx-live" aria-live="polite">
              {t("LIVE", "مباشر")}
            </span>
            <span className="lyx-num text-xl font-semibold tabular-nums text-ink" data-testid="ck-count">
              {fmtNum(d.total)}
            </span>
          </span>
        }
      >
        {list.length === 0 ? (
          <LoyaltyEmptyState
            kind="checkins"
            icon={<IconHandStop size={30} stroke={1.5} />}
            title={t("No one is waiting.", "لا يوجد أحد بالانتظار.")}
            text={t("When a patient taps “I'm here” on their Loyalty page, the request appears here instantly so you can confirm their arrival.", "عندما يضغط المريض «وصلت» في صفحة الولاء الخاصة به، يظهر طلبه هنا لتؤكد وصوله.")}
          />
        ) : (
          <ul className="lyx-ck-list space-y-3">
            {list.map(({ row, ghost }, i) => (
              <PendingCard key={row.id} row={row} index={i} now={now} busy={busyId === row.id} disabled={busyId !== null || !!ghost} ghost={ghost} onAct={act} />
            ))}
          </ul>
        )}

        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-mute">
          <IconInfoCircle size={13} className="mt-0.5 shrink-0" />
          {t("Confirming only records that the patient has arrived. It doesn't award points and doesn't change the appointment — visit points are still given when the appointment is marked completed.", "التأكيد يسجّل وصول المريض فقط. لا يمنح نقاطًا ولا يغيّر الموعد — تُمنح نقاط الزيارة عند تحويل الموعد إلى «مكتمل».")}
        </p>
      </LoyaltyPanel>

      {/* ===== history ===== */}
      <LoyaltyPanel title={t("Recent check-ins", "آخر عمليات تسجيل الوصول")} icon={<IconClockHour4 size={16} />} testId="ck-history">
        {recent.isError ? (
          <ErrorBox message={apiError(recent.error, t("Couldn't load history", "تعذّر تحميل السجل")).message} onRetry={() => recent.refetch()} />
        ) : recent.isLoading || !recent.data ? (
          <Skeleton className="h-32" />
        ) : recent.data.checkIns.length === 0 ? (
          <p className="py-6 text-center text-xs text-mute">{t("Nothing here yet.", "لا يوجد شيء بعد.")}</p>
        ) : (
          <>
            <ul className="lyx-tl">
              {recent.data.checkIns.map((row) => (
                <HistoryRow key={row.id} row={row} />
              ))}
            </ul>
            <Pager page={page} pages={recent.data.pages} onPage={setPage} />
          </>
        )}
      </LoyaltyPanel>
    </div>
  );
}

/* ---------- pieces ---------- */

const viaMeta = {
  qr: { icon: IconQrcode, en: "QR code", ar: "رمز QR" },
  nfc: { icon: IconNfc, en: "NFC tag", ar: "وسم NFC" },
  link: { icon: IconLink, en: "Link", ar: "رابط" },
} as const;

function ViaBadge({ via }: { via: CheckInRow["via"] }) {
  const { t } = useLT();
  const m = viaMeta[via] ?? viaMeta.link;
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--lyx-line)] bg-soft px-2 py-0.5 text-[10px] text-mute">
      <Icon size={11} /> {t(m.en, m.ar)}
    </span>
  );
}

function PendingCard({ row, index, now, busy, disabled, ghost, onAct }: { row: CheckInRow; index: number; now: number; busy: boolean; disabled: boolean; ghost?: "confirmed" | "rejected"; onAct: (r: CheckInRow, a: "confirm" | "reject", appointmentId?: string | null) => void }) {
  const { t, lang } = useLT();
  const only = row.appointments.length === 1 ? row.appointments[0].id : null;
  const [appt, setAppt] = useState<string | null>(only);
  const [askReject, setAskReject] = useState(false);
  // If the candidate list changes (new appointment appears / one disappears) keep a valid selection.
  useEffect(() => {
    setAppt((cur) => (cur && row.appointments.some((a) => a.id === cur) ? cur : row.appointments.length === 1 ? row.appointments[0].id : null));
  }, [row.appointments]);

  const mins = Math.max(0, Math.floor((now - new Date(row.requestedAt).getTime()) / 60_000));
  const waited = mins < 1 ? t("just now", "الآن") : t(`${mins} min ago`, `قبل ${mins} دقيقة`);
  const urgent = mins >= 10;
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  const name = row.patient?.fullName ?? t("Unknown patient", "مريض غير معروف");

  return (
    <li className="lyx-ck" data-out={ghost} style={{ ["--i" as string]: index } as React.CSSProperties} data-testid="ck-row">
      <div className="flex flex-wrap items-start gap-3">
        <span className="lyx-ck-av">
          <Avatar name={name} />
          {!ghost && <i aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1 basis-44">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words text-sm font-semibold text-ink">{name}</span>
            <ViaBadge via={row.via} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-mute">
            {row.patient && <span dir="ltr">#{row.patient.fileNumber}</span>}
            {row.patient && <span dir="ltr">{row.patient.phone}</span>}
            {row.balance != null && <span className="tabular-nums">{pointsWord(row.balance, lang)}</span>}
          </div>
        </div>
        <span title={timeOf(row.requestedAt)}>
          <StatusOrb status={urgent ? "rejected" : "pending"} pulse={!ghost && !urgent} label={`${urgent ? t("Waiting long · ", "ينتظر طويلًا · ") : ""}${waited}`} />
        </span>
      </div>

      {ghost ? (
        <div className="lyx-ck-done" role="status" data-testid={`ck-done-${ghost}`}>
          {ghost === "confirmed" ? (
            <>
              <span className="lyx-mini-burst">
                <SuccessBurst tone="mint" />
              </span>
              <span className="text-sm font-semibold text-[color:var(--lyx-mint)]">{t("Arrival confirmed", "تم تأكيد الوصول")}</span>
            </>
          ) : (
            <>
              <StatusOrb status="rejected" pulse={false} label={t("Request rejected", "تم رفض الطلب")} />
            </>
          )}
        </div>
      ) : (
        <>
          {row.appointments.length > 0 && (
            <fieldset className="lyx-surface mt-3 !rounded-2xl !p-2.5" data-solid="true">
              <legend className="px-1 text-[10px] uppercase tracking-wider text-mute">{t("Link an appointment (optional)", "ربط موعد (اختياري)")}</legend>
              <div className="space-y-1">
                {row.appointments.map((a) => (
                  <label key={a.id} className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-ink hover:bg-soft">
                    <input type="radio" name={`ap-${row.id}`} checked={appt === a.id} onChange={() => setAppt(a.id)} disabled={disabled} className="accent-amber-400" />
                    <span className="tabular-nums" dir="ltr">
                      {timeOf(a.startAt)}
                    </span>
                    <span className="min-w-0 truncate text-mute">{[a.doctorName, a.visitType === "procedure" ? t("Procedure", "إجراء") : a.visitType === "consultation" ? t("Consultation", "استشارة") : null].filter(Boolean).join(" · ")}</span>
                  </label>
                ))}
                <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-mute hover:bg-soft">
                  <input type="radio" name={`ap-${row.id}`} checked={appt === null} onChange={() => setAppt(null)} disabled={disabled} className="accent-amber-400" />
                  {t("Don't link an appointment", "بدون ربط موعد")}
                </label>
              </div>
            </fieldset>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {askReject ? (
              <div className="lyc-pop flex flex-wrap items-center justify-end gap-2" role="group" aria-label={t("Confirm rejecting", "تأكيد الرفض")}>
                <span className="text-[11px] text-red-300">{t("Reject this request?", "رفض هذا الطلب؟")}</span>
                <button className="btn-ghost text-xs" disabled={disabled} onClick={() => setAskReject(false)}>
                  {t("Keep", "إبقاء")}
                </button>
                <button className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-red-400/50 bg-red-500/15 px-3 text-xs font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50" disabled={disabled} onClick={() => onAct(row, "reject")} data-testid="ck-reject-yes">
                  {busy && <span className="lyc-spinner" aria-hidden="true" />}
                  {t("Yes, reject", "نعم، ارفض")}
                </button>
              </div>
            ) : (
              <>
                <button className="btn-ghost inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs" disabled={disabled} onClick={() => setAskReject(true)} data-testid="ck-reject">
                  <IconX size={14} /> {t("Reject", "رفض")}
                </button>
                <button className="btn-teal inline-flex min-h-[40px] items-center gap-1.5 px-4 text-sm" disabled={disabled} onClick={() => onAct(row, "confirm", appt)} data-testid="ck-confirm">
                  {busy ? <span className="lyc-spinner" aria-hidden="true" /> : <IconCheck size={15} />}
                  {t("Confirm arrival", "تأكيد الوصول")}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function HistoryRow({ row }: { row: CheckInRow }) {
  const { t, date } = useLT();
  const label: Record<CheckInStatus, string> = {
    confirmed: t("Confirmed", "تم التأكيد"),
    rejected: t("Rejected", "مرفوض"),
    cancelled: t("Cancelled by patient", "ألغاه المريض"),
    expired: t("Expired", "منتهي"),
    pending: t("Pending", "قيد الانتظار"),
  };
  const name = useMemo(() => row.patient?.fullName ?? "—", [row.patient]);
  return (
    <li className="lyx-act" data-k={row.status === "confirmed" ? "checkin_confirmed" : "points_reversed"} data-testid="ck-history-row">
      <span className="lyx-act-g" aria-hidden="true">
        <IconHandStop size={17} stroke={1.7} />
      </span>
      <span className="lyx-act-b">
        <b>{name}</b>
        <span>
          {date(row.requestedAt, true)}
          {row.resolvedBy?.name ? ` · ${row.resolvedBy.name}` : ""}
        </span>
      </span>
      <ViaBadge via={row.via} />
      <StatusOrb status={row.status as OrbStatus} pulse={false} label={label[row.status]} />
    </li>
  );
}
