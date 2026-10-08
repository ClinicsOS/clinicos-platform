"use client";
import { useState, type CSSProperties } from "react";
import { IconArrowBackUp, IconGift, IconHistory, IconSearch } from "@tabler/icons-react";
import { apiError, fmtNum, pointsWord, useDebounced, useLT, useRedemptionHistory, useRewards, useReverseRedemption, type RedemptionHistoryFilter, type RedemptionOutcome, type RedemptionRow, type RedemptionStatus } from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import { Pager, useFlash } from "./parts";
import Dialog from "./Dialog";
import PointsMove from "./ui/PointsMove";
import { LoyaltyEmptyState, LoyaltyErrorState, LoyaltyLoader, LoyaltyPanel, StatusOrb, SuccessBurst } from "./ui/LoyaltyUI";

/**
 * Redemption history (Phase 6, redesigned in Phase 8): paged and filterable; the filters survive navigating to another Loyalty section. Rows show the
 * SNAPSHOT the member requested (name + cost), which never changes when the reward is edited later. owner / doctor can reverse a confirmed redemption:
 * the server appends a NEW positive ledger row (the original debit is never edited) and the redemption becomes "Reversed". The reversal animation
 * (points travelling back to the member) starts only after the server confirmed the reversal.
 */

export default function RedemptionHistory({ canReverse }: { canReverse: boolean }) {
  const { t, date, lang } = useLT();
  const flash = useFlash();
  const rewards = useRewards();
  const reverse = useReverseRedemption();
  const f = useLoyaltyUi((s) => s.redemptionFilter);
  const setF = useLoyaltyUi((s) => s.setRedemptionFilter);
  const [reversing, setReversing] = useState<RedemptionRow | null>(null);
  const [reversed, setReversed] = useState<RedemptionOutcome | null>(null);

  const q = useDebounced(f.q.trim(), 350);
  const badRange = !!f.from && !!f.to && f.to < f.from;
  const filter: RedemptionHistoryFilter = { status: f.status, rewardId: f.rewardId, q, from: badRange ? "" : f.from, to: badRange ? "" : f.to, page: f.page };
  const h = useRedemptionHistory(filter);
  /** any filter change goes back to page 1 */
  const change = (p: Partial<RedemptionHistoryFilter>) => setF({ ...p, page: 1 });

  const label: Record<RedemptionStatus, string> = {
    confirmed: t("Redeemed", "تم الصرف"),
    rejected: t("Rejected", "مرفوض"),
    reversed: t("Reversed", "تم العكس"),
    pending: t("Pending", "قيد الانتظار"),
  };
  const filtered = !!(f.status || f.rewardId || f.q || f.from || f.to);

  return (
    <div className="space-y-3">
      {flash.node}
      <LoyaltyPanel title={t("Redemption history", "سجل الاسترداد")} subtitle={t("Every request, with the cost it had when it was made.", "كل الطلبات، بالتكلفة التي كانت عند تقديمها.")} icon={<IconHistory size={16} />} index={0}>
        <div className="lyx-rh-filters" role="search" aria-label={t("Filter redemption history", "تصفية سجل الاسترداد")}>
          <div className="wide" style={{ position: "relative" }}>
            <IconSearch size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2" style={{ color: "var(--lyx-text3)" }} aria-hidden="true" />
            <input className="inp w-full ps-8" style={{ minHeight: 40 }} value={f.q} onChange={(e) => change({ q: e.target.value })} placeholder={t("Patient name, phone or file #", "اسم المريض أو الهاتف أو رقم الملف")} aria-label={t("Search patient", "بحث عن مريض")} maxLength={60} data-testid="rh-search" />
          </div>
          <select className="inp" style={{ minHeight: 40 }} value={f.status} onChange={(e) => change({ status: e.target.value as RedemptionHistoryFilter["status"] })} aria-label={t("Status", "الحالة")} data-testid="rh-status">
            <option value="">{t("All results", "كل النتائج")}</option>
            <option value="confirmed">{label.confirmed}</option>
            <option value="rejected">{label.rejected}</option>
            <option value="reversed">{label.reversed}</option>
            <option value="pending">{label.pending}</option>
          </select>
          <select className="inp" style={{ minHeight: 40 }} value={f.rewardId} onChange={(e) => change({ rewardId: e.target.value })} aria-label={t("Reward", "الجائزة")} data-testid="rh-reward">
            <option value="">{t("All rewards", "كل الجوائز")}</option>
            {(rewards.data?.rewards ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input type="date" dir="ltr" className="inp" style={{ minHeight: 40 }} value={f.from} onChange={(e) => change({ from: e.target.value })} aria-label={t("From date", "من تاريخ")} data-testid="rh-from" />
          <input type="date" dir="ltr" className="inp" style={{ minHeight: 40 }} value={f.to} min={f.from || undefined} onChange={(e) => change({ to: e.target.value })} aria-label={t("To date", "إلى تاريخ")} data-testid="rh-to" aria-invalid={badRange} />
        </div>
        {badRange && <p className="mb-2 text-[11px]" style={{ color: "var(--lyx-danger)" }}>{t("“To” can't be before “From”.", "تاريخ النهاية لا يمكن أن يسبق تاريخ البداية.")}</p>}
        {filtered && (
          <button type="button" className="lyx-link" style={{ marginBottom: 6 }} onClick={() => setF({ status: "", rewardId: "", q: "", from: "", to: "", page: 1 })}>
            {t("Clear filters", "مسح التصفية")}
          </button>
        )}

        {h.isError ? (
          <LoyaltyErrorState message={apiError(h.error, t("Couldn't load history", "تعذّر تحميل السجل")).message} onRetry={() => h.refetch()} />
        ) : h.isLoading || !h.data ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <LoyaltyLoader key={i} className="h-16" />
            ))}
          </div>
        ) : h.data.redemptions.length === 0 ? (
          <div data-testid="rh-empty">
            <LoyaltyEmptyState
              kind="redemptions"
              compact
              icon={<IconGift size={28} stroke={1.5} />}
              title={filtered ? t("No redemptions match these filters.", "لا توجد عمليات مطابقة للتصفية.") : t("No redemptions yet.", "لا توجد عمليات استرداد بعد.")}
              text={filtered ? undefined : t("Confirmed, rejected and reversed requests will be listed here.", "ستُعرض هنا الطلبات المؤكَّدة والمرفوضة والمعكوسة.")}
            />
          </div>
        ) : (
          <>
            <ul className="lyx-tl" data-testid="rh-list">
              {h.data.redemptions.map((row, i) => {
                const when = row.status === "confirmed" ? row.confirmedAt : row.status === "rejected" ? row.rejectedAt : row.status === "reversed" ? row.reversedAt : row.requestedAt;
                const who = row.status === "confirmed" ? row.confirmedBy?.name : row.status === "rejected" ? row.rejectedBy?.name : row.reversedBy?.name;
                const note = row.status === "rejected" ? row.rejectionReason : row.status === "reversed" ? row.reversalReason : null;
                return (
                  <li key={row.id} className="lyx-act lyx-rh" data-status={row.status} data-testid="rh-row" style={{ ["--i" as string]: i } as CSSProperties}>
                    <span className="lyx-act-g" aria-hidden="true">
                      {row.status === "reversed" ? <IconArrowBackUp size={17} stroke={1.7} /> : <IconGift size={17} stroke={1.7} />}
                    </span>
                    <span className="lyx-act-b" style={{ flexBasis: "12rem" }}>
                      <b>
                        {row.patient?.fullName ?? "—"}
                        {row.patient && (
                          <span style={{ display: "inline", marginInlineStart: 8, fontWeight: 500 }} dir="ltr">
                            #{row.patient.fileNumber}
                          </span>
                        )}
                      </b>
                      <span data-testid="rh-snap-name" style={{ color: "var(--lyx-gold)" }}>
                        {row.rewardNameSnapshot}
                        <span data-testid="rh-snap-cost" style={{ display: "inline", marginInlineStart: 8, color: "var(--lyx-ivory)", fontVariantNumeric: "tabular-nums" }}>
                          {pointsWord(row.pointsCostSnapshot, lang)}
                        </span>
                      </span>
                      <span>
                        {date(when, true)}
                        {who ? ` · ${who}` : ""}
                      </span>
                      {note && <span style={{ color: "var(--lyx-info)" }}>“{note}”</span>}
                      {row.currentReward && (row.currentReward.pointsRequired !== row.pointsCostSnapshot || row.currentReward.name !== row.rewardNameSnapshot) && (
                        <span style={{ color: "var(--lyx-text3)" }}>{t(`Reward is now “${row.currentReward.name}” (${pointsWord(row.currentReward.pointsRequired, "en")})`, `الجائزة الآن «${row.currentReward.name}» (${pointsWord(row.currentReward.pointsRequired, "ar")})`)}</span>
                      )}
                    </span>
                    <span className="lyx-rh-end">
                      <StatusOrb status={row.status} label={label[row.status]} pulse={false} />
                      {canReverse && row.status === "confirmed" && (
                        <button type="button" className="btn-ghost inline-flex items-center gap-1 text-[11px]" style={{ minHeight: 36 }} disabled={row.busy} onClick={() => setReversing(row)} data-testid="rh-reverse">
                          <IconArrowBackUp size={13} /> {t("Reverse", "عكس")}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Pager page={f.page} pages={h.data.pages} onPage={(p) => setF({ page: p })} />
          </>
        )}
      </LoyaltyPanel>

      {reversing && !reversed && (
        <ReverseDialog
          row={reversing}
          pending={reverse.isPending}
          onClose={() => setReversing(null)}
          onSubmit={(reason, setError) =>
            reverse.mutate(
              { id: reversing.id, reason },
              {
                onSuccess: (r) => {
                  setReversing(null);
                  setReversed(r); // ← the reversal animation starts only now: the server confirmed it
                },
                onError: (e) => {
                  const er = apiError(e, t("Couldn't reverse the redemption", "تعذّر عكس العملية"));
                  if (er.code === "REDEMPTION_NOT_CONFIRMED") {
                    setReversing(null);
                    flash.show("err", t("This redemption was already reversed or changed.", "تم عكس هذه العملية أو تغييرها مسبقًا."));
                  } else setError(er.message);
                },
              }
            )
          }
        />
      )}
      {reversed && <Reversed outcome={reversed} onClose={() => setReversed(null)} />}
    </div>
  );
}

function ReverseDialog({ row, pending, onClose, onSubmit }: { row: RedemptionRow; pending: boolean; onClose: () => void; onSubmit: (reason: string, setError: (m: string | null) => void) => void }) {
  const { t } = useLT();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open onClose={onClose} busy={pending} title={t("Reverse redemption", "عكس عملية الاسترداد")} testId="rh-dialog" initialFocus="#rh-reason">
      <p className="mb-3 text-xs leading-relaxed text-[var(--lyx-text2)]">
        {t(`This gives ${pointsWord(row.pointsCostSnapshot, "en")} back to ${row.patient?.fullName ?? "the member"} by adding a new entry to the points ledger. The original deduction stays in the history. A redemption can be reversed once.`, `سيُعيد هذا ${pointsWord(row.pointsCostSnapshot, "ar")} إلى ${row.patient?.fullName ?? "العضو"} بإضافة حركة جديدة في سجل النقاط. يبقى الخصم الأصلي ظاهرًا في السجل. يمكن عكس العملية مرة واحدة فقط.`)}
      </p>
      <label htmlFor="rh-reason" className="mb-1 block text-[11px] font-semibold" style={{ color: "var(--lyx-text2)" }}>
        {t("Reason (required)", "السبب (مطلوب)")}
      </label>
      <textarea id="rh-reason" className="inp mb-2 w-full" style={{ minHeight: 84 }} value={reason} maxLength={300} onChange={(e) => (setReason(e.target.value), setError(null))} data-testid="rh-reason" />
      {error && (
        <div role="alert" className="mb-2 rounded-xl border p-2.5 text-xs" style={{ borderColor: "rgba(240,138,138,.4)", background: "rgba(240,138,138,.1)", color: "var(--lyx-danger)" }} data-testid="rh-dialog-error">
          {error}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
          {t("Cancel", "إلغاء")}
        </button>
        <button type="button" className="lyx-btn-rose" disabled={!ok || pending} onClick={() => onSubmit(reason, setError)} data-testid="rh-reverse-yes">
          {pending ? <span className="lyc-spinner" aria-hidden="true" /> : <IconArrowBackUp size={14} />}
          {t("Reverse and return points", "عكس وإرجاع النقاط")}
        </button>
      </div>
    </Dialog>
  );
}

/** Reversal confirmed by the server — the points travel back to the member. */
export function Reversed({ outcome, onClose }: { outcome: RedemptionOutcome; onClose: () => void }) {
  const { t } = useLT();
  const r = outcome.redemption;
  return (
    <Dialog open wide onClose={onClose} title={t("Redemption reversed", "تم عكس الاسترداد")} testId="rh-success" initialFocus="[data-testid=rh-success-close]">
      <div className="lyx-done">
        <PointsMove from={outcome.balanceBefore} to={outcome.balanceAfter} points={outcome.points} direction="back" label={r.rewardNameSnapshot} />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
          <SuccessBurst tone="rose" icon={<IconArrowBackUp size={28} stroke={2.4} />} />
        </div>
        <h3>{t("Points returned", "أُعيدت النقاط")}</h3>
        <p>
          {r.patient?.fullName ? `${r.patient.fullName} · ` : ""}
          <span style={{ color: "var(--lyx-gold)" }}>{r.rewardNameSnapshot}</span>
        </p>
        <div className="lyx-done-grid">
          <div>
            <small>{t("Returned", "المُعاد")}</small>
            <b dir="ltr" style={{ color: "var(--lyx-rose)" }} data-testid="rh-s-points">
              +{fmtNum(outcome.points)}
            </b>
          </div>
          <div style={{ borderColor: "rgba(111,214,176,.3)", background: "rgba(111,214,176,.06)" }}>
            <small>{t("New balance", "الرصيد الجديد")}</small>
            <b style={{ color: "var(--lyx-mint)" }} data-testid="rh-s-balance">
              {fmtNum(outcome.balanceAfter)}
            </b>
          </div>
        </div>
        <button type="button" className="btn-teal mt-4 inline-flex items-center gap-1.5" style={{ minHeight: 40 }} onClick={onClose} data-testid="rh-success-close">
          {t("Done", "تم")}
        </button>
      </div>
    </Dialog>
  );
}
