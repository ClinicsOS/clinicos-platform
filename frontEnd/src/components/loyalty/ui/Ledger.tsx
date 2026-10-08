"use client";
import type { ReactNode } from "react";
import { IconAdjustmentsHorizontal, IconArrowBackUp, IconCalendarEvent, IconClockOff, IconCoins, IconGift, IconPencil, IconReceipt } from "@tabler/icons-react";
import { fmtNum, useLT, type LoyaltyTransactionType, type LoyaltyTx } from "@/lib/loyalty";
import { useTxLabel } from "../parts";

/** credit / debit / reversal — told apart by symbol, icon AND word, never by colour alone. */
export type LedgerKind = "credit" | "debit" | "reversal";
export const ledgerKind = (type: LoyaltyTransactionType, delta: number): LedgerKind => (type === "reversal" ? "reversal" : delta < 0 ? "debit" : "credit");

const TYPE_ICON: Record<LoyaltyTransactionType, ReactNode> = {
  earn_visit: <IconCalendarEvent size={17} stroke={1.7} />,
  earn_spending: <IconReceipt size={17} stroke={1.7} />,
  manual_credit: <IconPencil size={17} stroke={1.7} />,
  manual_debit: <IconPencil size={17} stroke={1.7} />,
  reward_redemption: <IconGift size={17} stroke={1.7} />,
  expiration: <IconClockOff size={17} stroke={1.7} />,
  reversal: <IconArrowBackUp size={17} stroke={1.7} />,
  correction: <IconAdjustmentsHorizontal size={17} stroke={1.7} />,
};

export function Delta({ delta, kind, withWord = true }: { delta: number; kind: LedgerKind; withWord?: boolean }) {
  const { t } = useLT();
  const word = kind === "reversal" ? t("returned", "أُعيدت") : kind === "debit" ? t("debit", "خصم") : t("credit", "إضافة");
  return (
    <span className="lyx-act-p">
      <span className="lyx-delta" data-k={kind} dir="ltr">
        {kind === "reversal" && <IconArrowBackUp size={12} stroke={2.4} />}
        {delta > 0 ? "+" : "−"}
        {fmtNum(Math.abs(delta))}
      </span>
      {withWord && <small>{word}</small>}
    </span>
  );
}

/** One ledger entry (immutable record). `showPatient` for the all-members ledger. */
export function LedgerRow({ tx, showPatient = false, index = 0, date }: { tx: LoyaltyTx; showPatient?: boolean; index?: number; date: (d: string, withTime?: boolean) => string }) {
  const { t } = useLT();
  const label = useTxLabel()(tx.type);
  const kind = ledgerKind(tx.type, tx.pointsDelta);
  return (
    <li className="lyx-act lyx-ledger" data-k={kind === "reversal" ? "points_reversed" : kind === "debit" ? "reward_redeemed" : "points_earned"} data-testid="ledger-row" data-kind={kind} style={{ ["--i" as string]: index } as React.CSSProperties}>
      <span className="lyx-act-g" aria-hidden="true">
        {TYPE_ICON[tx.type] ?? <IconCoins size={17} />}
      </span>
      <span className="lyx-act-b" style={{ whiteSpace: "normal" }}>
        <b>{label}</b>
        <span style={{ whiteSpace: "normal" }}>
          {showPatient ? `${tx.patient?.fullName ?? "—"} · ` : ""}
          {date(tx.createdAt, true)}
          {tx.createdBy?.name ? ` · ${tx.createdBy.name}` : ""}
          {tx.reversesTransactionId ? ` · ${t("reverses an entry", "يعكس حركة")}` : ""}
        </span>
        {tx.reason && <span style={{ whiteSpace: "normal", color: "var(--lyx-text3)" }}>“{tx.reason}”</span>}
      </span>
      <span className="lyx-ledger-end">
        <Delta delta={tx.pointsDelta} kind={kind} withWord />
        <small style={{ display: "block", marginTop: 2 }}>
          {t("Balance", "الرصيد")} {fmtNum(tx.balanceAfter)}
        </small>
      </span>
    </li>
  );
}
