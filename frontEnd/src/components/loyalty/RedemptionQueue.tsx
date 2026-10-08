"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { IconAlertTriangle, IconArrowRight, IconCheck, IconClockHour4, IconGift, IconInfoCircle, IconX } from "@tabler/icons-react";
import {
  apiError,
  fmtNum,
  pointsWord,
  useConfirmRedemption,
  useLT,
  useRedemptionsPending,
  useRejectRedemption,
  type RedemptionOutcome,
  type RedemptionRow,
} from "@/lib/loyalty";
import { Avatar, useFlash } from "./parts";
import Dialog from "./Dialog";
import PointsMove from "./ui/PointsMove";
import { LoyaltyEmptyState, LoyaltyErrorState, LoyaltyLoader, LoyaltyPanel, ProgressRail, SuccessBurst } from "./ui/LoyaltyUI";

/**
 * Pending redemption queue (Phase 6, redesigned in Phase 8).
 *
 * A member asked for a reward; NO points have moved yet. Staff either CONFIRM (the reward was given → the server deducts
 * the request's own cost snapshot through the central ledger) or REJECT (nothing moves). Every number on this screen comes
 * from the server; the "balance after" preview is only a convenience — the server re-checks the live balance on confirm and
 * the success screen (and its points-moving animation) shows the values the server answered with, never values we computed.
 * The animation is mounted ONLY from the confirm mutation's onSuccess — never optimistically.
 */

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export default function RedemptionQueue() {
  const { t } = useLT();
  const flash = useFlash();
  const q = useRedemptionsPending();
  const confirm = useConfirmRedemption();
  const reject = useRejectRedemption();
  const now = useNow();
  const [confirming, setConfirming] = useState<RedemptionRow | null>(null);
  const [done, setDone] = useState<RedemptionOutcome | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Keep the dialog's numbers live: if the queue refreshes while it is open, show the newest row.
  const liveRow = confirming ? q.data?.redemptions.find((r) => r.id === confirming.id) ?? null : null;
  useEffect(() => {
    if (confirming && q.data && !liveRow && !confirm.isPending) setConfirming(null); // handled by someone else meanwhile
  }, [confirming, q.data, liveRow, confirm.isPending]);

  const doReject = (row: RedemptionRow, reason: string) => {
    setBusyId(row.id);
    reject.mutate(
      { id: row.id, reason },
      {
        onSuccess: () => flash.show("ok", t("Request rejected — no points were deducted.", "تم رفض الطلب — لم تُخصم أي نقاط.")),
        onError: (e) => flash.show("err", messageFor(apiError(e, t("Couldn't reject the request", "تعذّر رفض الطلب")), t)),
        onSettled: () => setBusyId(null),
      }
    );
  };

  if (q.isError) return <LoyaltyErrorState message={apiError(q.error, t("Couldn't load redemption requests", "تعذّر تحميل طلبات الاسترداد")).message} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <LoyaltyLoader className="h-44" />
        <LoyaltyLoader className="h-44" />
      </div>
    );
  }
  const d = q.data;

  return (
    <div className="space-y-3">
      {flash.node}
      <LoyaltyPanel
        title={t("Waiting for you", "بانتظار الرد")}
        subtitle={t("Requested by members from their Loyalty page.", "طلبها الأعضاء من صفحة الولاء الخاصة بهم.")}
        icon={<IconGift size={16} />}
        index={0}
        action={
          <span className="flex items-center gap-3">
            <span className="lyx-live">{t("LIVE", "مباشر")}</span>
            <span className="text-sm font-semibold tabular-nums text-[var(--lyx-ivory)]" data-testid="rd-count">
              {fmtNum(d.total)}
            </span>
          </span>
        }
      >
        {d.redemptions.length === 0 ? (
          <LoyaltyEmptyState
            kind="redemptions"
            icon={<IconGift size={30} stroke={1.5} />}
            title={t("No redemption requests.", "لا توجد طلبات استرداد.")}
            text={t("When a member asks for a reward from their Loyalty page, the request appears here. Points are only deducted when you confirm it.", "عندما يطلب العضو جائزة من صفحة الولاء الخاصة به يظهر طلبه هنا. لا تُخصم النقاط إلا عند تأكيدك.")}
          />
        ) : (
          <ul className="lyx-rd-list">
            {d.redemptions.map((row, i) => (
              <PendingCard key={row.id} row={row} index={i} now={now} disabled={busyId !== null || confirm.isPending} busy={busyId === row.id} onConfirm={() => setConfirming(row)} onReject={(reason) => doReject(row, reason)} />
            ))}
          </ul>
        )}

        <p className="lyx-rd-note" style={{ marginTop: 16 }}>
          <IconInfoCircle size={13} />
          {t("Requesting a reward never deducts points. Confirming deducts the points the reward cost when it was requested, even if the reward's price changed since. Rejecting deducts nothing.", "طلب الجائزة لا يخصم نقاطًا. التأكيد يخصم النقاط التي كانت تكلّفها الجائزة عند الطلب حتى لو تغيّر سعرها لاحقًا. الرفض لا يخصم شيئًا.")}
        </p>
      </LoyaltyPanel>

      {confirming && !done && (
        <ConfirmDialog
          row={liveRow ?? confirming}
          pending={confirm.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={(setError) => {
            confirm.mutate(confirming.id, {
              onSuccess: (r) => {
                setConfirming(null);
                setDone(r); // ← the only place the success state (and its animation) can start: the server has answered
              },
              onError: (e) => {
                const er = apiError(e, t("Couldn't confirm the request", "تعذّر تأكيد الطلب"));
                if (er.code === "REDEMPTION_NOT_PENDING") {
                  setConfirming(null);
                  flash.show("err", messageFor(er, t));
                } else setError(messageFor(er, t));
              },
            });
          }}
        />
      )}
      {done && <Redeemed outcome={done} onClose={() => setDone(null)} />}
    </div>
  );
}

/** Friendly text for the codes the server can answer with. */
function messageFor(er: { message: string; code?: string }, t: (en: string, ar: string) => string): string {
  switch (er.code) {
    case "REDEMPTION_NOT_PENDING":
      return t("Someone else already handled this request.", "تمت معالجة هذا الطلب من قبل شخص آخر.");
    case "INSUFFICIENT_BALANCE":
      return t("The member doesn't have enough points right now. The request stays pending — you can reject it or confirm it once they have enough.", "لا يملك العضو نقاطًا كافية حاليًا. يبقى الطلب معلّقًا — يمكنك رفضه أو تأكيده عندما تتوفر النقاط.");
    case "ACCOUNT_NOT_ACTIVE":
      return t("This member's Loyalty account is not active.", "حساب الولاء لهذا العضو غير فعّال.");
    case "PATIENT_ARCHIVED":
      return t("This patient is archived, so the reward can't be redeemed.", "هذا المريض مؤرشف، لا يمكن صرف الجائزة.");
    default:
      return er.message;
  }
}

function PendingCard({ row, index, now, busy, disabled, onConfirm, onReject }: { row: RedemptionRow; index: number; now: number; busy: boolean; disabled: boolean; onConfirm: () => void; onReject: (reason: string) => void }) {
  const { t, lang } = useLT();
  const [askReject, setAskReject] = useState(false);
  const [reason, setReason] = useState("");
  const mins = Math.max(0, Math.floor((now - new Date(row.requestedAt).getTime()) / 60_000));
  const waited = mins < 1 ? t("just now", "الآن") : mins < 60 ? t(`${mins} min ago`, `قبل ${mins} دقيقة`) : mins < 1440 ? t(`${Math.floor(mins / 60)} h ago`, `قبل ${Math.floor(mins / 60)} ساعة`) : t(`${Math.floor(mins / 1440)} d ago`, `قبل ${Math.floor(mins / 1440)} يوم`);
  const name = row.patient?.fullName ?? t("Unknown patient", "مريض غير معروف");
  const changed = row.currentReward && (row.currentReward.pointsRequired !== row.pointsCostSnapshot || row.currentReward.name !== row.rewardNameSnapshot);
  const afford = row.canAfford === false ? "no" : row.canAfford === true ? "yes" : "unknown";

  return (
    <li className="lyx-rd" data-afford={afford} style={{ ["--i" as string]: index } as CSSProperties} data-testid="rd-row">
      <div className="lyx-rd-head">
        <Avatar name={name} />
        <div className="lyx-rd-who">
          <b>{name}</b>
          <span>
            {row.patient && <em dir="ltr" style={{ fontStyle: "normal" }}>#{row.patient.fileNumber}</em>}
            {row.patient && <em dir="ltr" style={{ fontStyle: "normal" }}>{row.patient.phone}</em>}
          </span>
        </div>
        <span className="lyx-rd-wait">
          <IconClockHour4 size={12} /> {waited}
        </span>
      </div>

      <div className="lyx-rd-ticket">
        <span className="lyx-rd-med" aria-hidden="true">
          <IconGift size={22} />
        </span>
        <div className="lyx-rd-cell">
          <small>{t("Reward", "الجائزة")}</small>
          <b className="gold" data-testid="rd-reward">
            {row.rewardNameSnapshot}
          </b>
        </div>
        <div className="lyx-rd-ticket-fig">
          <div className="lyx-rd-cell">
            <small>{t("Cost", "التكلفة")}</small>
            <b data-testid="rd-cost">{pointsWord(row.pointsCostSnapshot, lang)}</b>
          </div>
          <div className="lyx-rd-cell">
            <small>{t("Current balance", "الرصيد الحالي")}</small>
            <b className={row.canAfford === false ? "bad" : ""} data-testid="rd-balance">
              {row.balance === null ? "—" : fmtNum(row.balance)}
            </b>
          </div>
        </div>
      </div>

      {row.balance !== null && row.pointsCostSnapshot > 0 && row.canAfford === false && (
        <div className="lyx-rd-afford">
          <div className="lyx-rd-afford-t">
            <span>{t("Balance toward this reward", "الرصيد مقابل هذه الجائزة")}</span>
            <span dir="ltr" className="tabular-nums">
              {fmtNum(Math.min(row.balance, row.pointsCostSnapshot))} / {fmtNum(row.pointsCostSnapshot)}
            </span>
          </div>
          <ProgressRail value={Math.min(row.balance, row.pointsCostSnapshot)} max={row.pointsCostSnapshot} tone={row.canAfford === false ? "rose" : "mint"} height={7} label={t("Balance toward this reward", "الرصيد مقابل هذه الجائزة")} />
        </div>
      )}

      {row.canAfford === false && (
        <p className="lyx-rd-note" data-k="bad" role="status">
          <IconAlertTriangle size={13} />
          {t("Not enough points right now — it can't be confirmed until the balance covers the cost.", "لا توجد نقاط كافية حاليًا — لا يمكن التأكيد حتى يغطي الرصيد التكلفة.")}
        </p>
      )}
      {changed && row.currentReward && (
        <p className="lyx-rd-note">
          <IconInfoCircle size={13} />
          {t(`The reward has changed since this request (now “${row.currentReward.name}”, ${pointsWord(row.currentReward.pointsRequired, "en")}). This request keeps its original cost.`, `تغيّرت الجائزة منذ هذا الطلب (أصبحت «${row.currentReward.name}»، ${pointsWord(row.currentReward.pointsRequired, "ar")}). يحتفظ هذا الطلب بتكلفته الأصلية.`)}
        </p>
      )}
      {row.currentReward && row.currentReward.status !== "active" && (
        <p className="lyx-rd-note" data-k="gold">
          <IconInfoCircle size={13} />
          {t("This reward is now inactive. Existing requests can still be confirmed or rejected; new ones are blocked.", "هذه الجائزة متوقفة الآن. يمكن تأكيد الطلبات الحالية أو رفضها؛ الطلبات الجديدة محظورة.")}
        </p>
      )}

      <div className="lyx-rd-act">
        {row.busy && <span className="me-auto text-[11px] text-[var(--lyx-text2)]">{t("Being processed…", "قيد المعالجة…")}</span>}
        {askReject ? (
          <div className="lyx-rd-reject" role="group" aria-label={t("Confirm rejecting", "تأكيد الرفض")}>
            <input className="inp" placeholder={t("Reason (optional)", "السبب (اختياري)")} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Rejection reason", "سبب الرفض")} data-testid="rd-reject-reason" />
            <button type="button" className="btn-ghost" style={{ minHeight: 40 }} disabled={disabled} onClick={() => setAskReject(false)}>
              {t("Keep", "إبقاء")}
            </button>
            <button type="button" className="lyx-btn-danger" disabled={disabled} onClick={() => onReject(reason)} data-testid="rd-reject-yes">
              {busy && <span className="lyc-spinner" aria-hidden="true" />}
              {t("Yes, reject", "نعم، ارفض")}
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs" style={{ minHeight: 40 }} disabled={disabled} onClick={() => setAskReject(true)} data-testid="rd-reject">
              <IconX size={14} /> {t("Reject", "رفض")}
            </button>
            <button type="button" className="btn-teal inline-flex items-center gap-1.5" style={{ minHeight: 40 }} disabled={disabled || row.busy} onClick={onConfirm} data-testid="rd-confirm">
              <IconCheck size={15} /> {t("Confirm…", "تأكيد…")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/* ---------- confirm dialog: balance → cost → after (preview — the server re-checks everything) ---------- */

function ConfirmDialog({ row, pending, onClose, onConfirm }: { row: RedemptionRow; pending: boolean; onClose: () => void; onConfirm: (setError: (m: string | null) => void) => void }) {
  const { t } = useLT();
  const [error, setError] = useState<string | null>(null);
  const bal = row.balance;
  const after = bal === null ? null : bal - row.pointsCostSnapshot;
  const can = row.canAfford === true;
  const name = row.patient?.fullName ?? t("Unknown patient", "مريض غير معروف");
  const keepPct = bal && bal > 0 && after !== null ? Math.max(0, Math.min(100, (after / bal) * 100)) : 0;

  return (
    <Dialog open wide onClose={onClose} busy={pending} title={t("Confirm redemption", "تأكيد صرف الجائزة")} testId="rd-dialog" initialFocus="[data-testid=rd-dialog-confirm]">
      <p className="mb-3 text-xs text-[var(--lyx-text2)]">{t("Confirm only after the member has actually received the reward.", "أكّد فقط بعد أن يستلم العضو الجائزة فعلًا.")}</p>
      <div className="mb-3 flex items-center gap-3 rounded-2xl border border-[var(--lyx-line)] p-3" style={{ background: "rgba(255,244,214,.04)" }}>
        <Avatar name={name} />
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-[var(--lyx-ivory)]">{name}</div>
          <div className="break-words text-xs text-[var(--lyx-gold)]">{row.rewardNameSnapshot}</div>
        </div>
      </div>

      <div className="lyx-bm" data-testid="rd-math">
        <div className="lyx-bm-row">
          <div className="lyx-bm-c" data-k="bal">
            <small>{t("Current balance", "الرصيد الحالي")}</small>
            <b dir="ltr" data-testid="rd-m-balance">
              {bal === null ? "—" : fmtNum(bal)}
            </b>
          </div>
          <span className="lyx-bm-arr" aria-hidden="true">
            <IconArrowRight size={16} />
          </span>
          <div className="lyx-bm-c" data-k="cost">
            <small>{t("Reward", "الجائزة")}</small>
            <b dir="ltr" data-testid="rd-m-cost">
              −{fmtNum(row.pointsCostSnapshot)}
            </b>
          </div>
          <span className="lyx-bm-arr" aria-hidden="true">
            <IconArrowRight size={16} />
          </span>
          <div className="lyx-bm-c" data-k="after" data-bad={!can ? "true" : undefined}>
            <small>{t("Balance after", "الرصيد بعد الخصم")}</small>
            <b dir="ltr" data-testid="rd-m-after">
              {after === null ? "—" : fmtNum(after)}
            </b>
          </div>
        </div>
        {bal !== null && bal > 0 && (
          <>
            <div className="lyx-bm-bar" data-bad={!can ? "true" : undefined} aria-hidden="true">
              <span className="lyx-bm-keep" style={{ width: `${can ? keepPct : 0}%` }} />
              <span className="lyx-bm-cost" style={{ width: `${can ? 100 - keepPct : 100}%` }} />
            </div>
            <div className="lyx-bm-legend" aria-hidden="true">
              <span>{t("Stays with the member", "يبقى مع العضو")}</span>
              <span>{t("Used for the reward", "يُستخدم للجائزة")}</span>
            </div>
          </>
        )}
      </div>

      {!can && (
        <p role="alert" className="lyx-rd-note" data-k="bad" style={{ marginTop: 0, marginBottom: 12 }}>
          <IconAlertTriangle size={14} />
          {t("The balance doesn't cover this reward right now.", "الرصيد لا يغطي هذه الجائزة حاليًا.")}
        </p>
      )}
      {error && (
        <div role="alert" className="mb-3 rounded-xl border p-2.5 text-xs" style={{ borderColor: "rgba(240,138,138,.4)", background: "rgba(240,138,138,.1)", color: "var(--lyx-danger)" }} data-testid="rd-dialog-error">
          {error}
        </div>
      )}
      <p className="mb-3 text-[11px] text-[var(--lyx-text3)]">{t("The system re-checks the live balance when you confirm.", "يعيد النظام فحص الرصيد الفعلي عند التأكيد.")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
          {t("Cancel", "إلغاء")}
        </button>
        <button type="button" className="btn-teal inline-flex items-center gap-1.5" style={{ minHeight: 40 }} onClick={() => (setError(null), onConfirm(setError))} disabled={pending || !can} data-testid="rd-dialog-confirm">
          {pending ? <span className="lyc-spinner" aria-hidden="true" /> : <IconCheck size={15} />}
          {t(`Deduct ${pointsWord(row.pointsCostSnapshot, "en")}`, `خصم ${pointsWord(row.pointsCostSnapshot, "ar")}`)}
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- success (only ever rendered from a real server response) ---------- */

export function Redeemed({ outcome, onClose }: { outcome: RedemptionOutcome; onClose: () => void }) {
  const { t } = useLT();
  const r = outcome.redemption;
  return (
    <Dialog open wide onClose={onClose} title={t("Reward redeemed", "تم صرف الجائزة")} testId="rd-success" initialFocus="[data-testid=rd-success-close]">
      <div className="lyx-done">
        <PointsMove from={outcome.balanceBefore} to={outcome.balanceAfter} points={outcome.points} direction="out" label={r.rewardNameSnapshot} />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
          <SuccessBurst tone="mint" />
        </div>
        <h3>{t("Reward redeemed", "تم صرف الجائزة")}</h3>
        <p>
          {r.patient?.fullName ? `${r.patient.fullName} · ` : ""}
          <span style={{ color: "var(--lyx-gold)" }}>{r.rewardNameSnapshot}</span>
        </p>
        <div className="lyx-done-grid">
          <div>
            <small>{t("Points used", "النقاط المستخدمة")}</small>
            <b dir="ltr" style={{ color: "var(--lyx-danger)" }} data-testid="rd-s-points">
              −{fmtNum(outcome.points)}
            </b>
          </div>
          <div style={{ borderColor: "rgba(111,214,176,.3)", background: "rgba(111,214,176,.06)" }}>
            <small>{t("New balance", "الرصيد الجديد")}</small>
            <b style={{ color: "var(--lyx-mint)" }} data-testid="rd-s-balance">
              {fmtNum(outcome.balanceAfter)}
            </b>
          </div>
        </div>
        <p style={{ marginTop: 10, fontSize: 11, color: "var(--lyx-text3)" }}>{t(`Was ${pointsWord(outcome.balanceBefore, "en")}`, `كان ${pointsWord(outcome.balanceBefore, "ar")}`)}</p>
        <button type="button" className="btn-teal mt-4 inline-flex items-center gap-1.5" style={{ minHeight: 40 }} onClick={onClose} data-testid="rd-success-close">
          {t("Done", "تم")}
        </button>
      </div>
    </Dialog>
  );
}
