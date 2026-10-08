"use client";
import { IconHistory } from "@tabler/icons-react";
import { apiError, useLoyaltyTransactions, useLT, type LoyaltyTransactionType } from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import { ErrorBox, Pager, useTxLabel } from "./parts";
import { LoyaltyEmptyState, LoyaltyLoader, LoyaltyPanel, SegTabs } from "./ui/LoyaltyUI";
import { LedgerRow } from "./ui/Ledger";

const FILTERS: ("" | LoyaltyTransactionType)[] = ["", "earn_visit", "earn_spending", "manual_credit", "manual_debit", "reward_redemption", "reversal"];

/** Transactions (Phase 8): the immutable points ledger as a timeline. Credits, debits and reversals differ by symbol, icon and word — not only colour. */
export default function TransactionsTab() {
  const { t, date } = useLT();
  const label = useTxLabel();
  const { page, type } = useLoyaltyUi((s) => s.transactions);
  const setTx = useLoyaltyUi((s) => s.setTransactions);
  const q = useLoyaltyTransactions(page, type);

  const filters = (
    <div className="mb-3 flex max-w-full overflow-x-auto" data-testid="tx-filters">
      <SegTabs
        label={t("Filter by type", "تصفية حسب النوع")}
        value={type as string}
        onChange={(v) => setTx({ type: v, page: 1 })}
        items={FILTERS.map((f) => ({ id: f as string, label: f === "" ? t("All", "الكل") : label(f), testId: `tx-filter-${f || "all"}` }))}
      />
    </div>
  );

  if (q.isError) return <ErrorBox message={apiError(q.error, t("Couldn't load transactions", "تعذّر تحميل الحركات")).message} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <LoyaltyLoader className="h-64" />;
  const d = q.data;

  return (
    <div>
      {filters}
      <LoyaltyPanel title={t("Points ledger", "سجلّ النقاط")} subtitle={t("Every movement is permanent — corrections are new entries, never edits.", "كل حركة دائمة — التصحيحات تُسجَّل كحركات جديدة لا كتعديل.")} icon={<IconHistory size={16} />} testId="tx-panel">
        {d.transactions.length === 0 ? (
          type ? (
            <LoyaltyEmptyState kind="transactions" icon={<IconHistory size={30} stroke={1.5} />} title={t("No transactions of this type.", "لا توجد حركات من هذا النوع.")} text={t("Try another filter.", "جرّب تصفية أخرى.")} />
          ) : (
            <LoyaltyEmptyState
              kind="transactions"
              icon={<IconHistory size={30} stroke={1.5} />}
              title={t("No Loyalty transactions yet.", "لا توجد حركات نقاط بعد.")}
              text={t("Every points movement will appear here as an immutable record. Earning rules have not been configured yet, so nothing is awarded automatically.", "ستظهر هنا كل حركة نقاط كسجل ثابت لا يمكن تعديله. لم يتم ضبط قواعد الكسب بعد، لذلك لا تُمنح أي نقاط تلقائيًا.")}
            />
          )
        ) : (
          <>
            <ul className="lyx-tl">
              {d.transactions.map((x, i) => (
                <LedgerRow key={x.id} tx={x} showPatient index={i} date={date} />
              ))}
            </ul>
            <Pager page={page} pages={d.pages} onPage={(p) => setTx({ page: p })} />
          </>
        )}
      </LoyaltyPanel>
    </div>
  );
}
