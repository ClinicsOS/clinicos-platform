"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { Invoice } from "@/lib/types";
import type { TreatmentItem } from "@/lib/derm/treatmentTypes";
import { useBillDermTreatment } from "@/lib/derm/treatmentHooks";
import { invLabel, money, treatmentErrorKey, useProcLabel, useTargetText } from "./shared";

/**
 * The compact confirmation for the ONE billing action. The clinician's ESTIMATE only pre-fills the price field; what the
 * person confirming types is the ACTUAL invoice price and becomes the authoritative invoice line in the EXISTING invoice
 * module (no second financial system). "Invoiced" is only shown after the server confirms; the server is idempotent.
 */
export default function AddToInvoiceModal({ patientId, item, onClose }: { patientId: string; item: Pick<TreatmentItem, "_id" | "procedureCode" | "targetType" | "regions" | "generalArea" | "estimatedPrice">; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const procLabel = useProcLabel();
  const targetText = useTargetText();
  const bill = useBillDermTreatment(patientId);
  const lock = useRef(false);
  const [price, setPrice] = useState(item.estimatedPrice != null ? String(item.estimatedPrice) : "");
  const [desc, setDesc] = useState(`${procLabel(item.procedureCode)} — ${targetText(item)}`.slice(0, 200));
  const [target, setTarget] = useState<string>("new");
  const [error, setError] = useState("");

  // the same query key + endpoint the patient profile already uses for the patient's invoices
  const inv = useQuery({ queryKey: ["invoices", patientId], queryFn: async () => (await api.get<Invoice[]>(`/invoices?patientId=${patientId}`)).data });
  const open = (inv.data ?? []).filter((i) => i.status !== "paid"); // a fully paid invoice is never silently re-opened

  const num = price.trim() === "" ? NaN : Number(price.replace(",", "."));
  const priceOk = Number.isFinite(num) && num >= 0 && num <= 100000 && Math.abs(num * 1000 - Math.round(num * 1000)) < 1e-6;
  const descOk = desc.trim().length > 0 && desc.trim().length <= 200;
  const canSave = priceOk && descOk && !bill.isPending;

  const confirm = async () => {
    if (!canSave || lock.current) return;
    lock.current = true; setError("");
    try {
      await bill.mutateAsync({ itemId: item._id, price: num, description: desc.trim(), ...(target !== "new" ? { invoiceId: target } : {}) });
      toast.success(t("dt.inv.done"));
      onClose();
    } catch (e) { setError(t(treatmentErrorKey(e))); } finally { lock.current = false; }
  };

  return (
    <Modal title={t("dt.inv.add")} onClose={onClose}>
      <div className="space-y-3.5">
        <div className="rounded-lg border border-edge bg-card2 px-2.5 py-2 text-[12px] text-ink">
          {procLabel(item.procedureCode)} — <span className="text-mute">{targetText(item)}</span>
          <div className="mt-1 text-[11px] text-mute">{t("dt.inv.estimated")}: <span dir="ltr">{item.estimatedPrice != null ? money(item.estimatedPrice) : "—"}</span></div>
        </div>
        <div>
          <label className="lbl" htmlFor="dt-inv-price">{t("dt.inv.actual")} (JD)</label>
          <input id="dt-inv-price" dir="ltr" inputMode="decimal" className={`inp ${price.trim() !== "" && !priceOk ? "!border-red-400" : ""}`} placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={price.trim() !== "" && !priceOk} />
          {price.trim() !== "" && !priceOk && <p className="mt-1 text-[10px] text-amber-400">{t("dt.inv.err.price")}</p>}
          <p className="mt-1 text-[10px] text-mute">{t("dt.inv.actualNote")}</p>
        </div>
        <div>
          <label className="lbl" htmlFor="dt-inv-desc">{t("dt.inv.desc")}</label>
          <input id="dt-inv-desc" dir="auto" className={`inp ${!descOk ? "!border-red-400" : ""}`} maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} />
          {!descOk && <p className="mt-1 text-[10px] text-amber-400">{t("dt.inv.err.desc")}</p>}
        </div>
        <div>
          <div className="lbl">{t("dt.inv.target")}</div>
          <div className="space-y-1.5">
            <button type="button" aria-pressed={target === "new"} onClick={() => setTarget("new")} className={`w-full rounded-lg border px-2.5 py-2 text-start text-[11px] ${target === "new" ? "border-teal bg-teal/10 text-ink" : "border-edge bg-card2 text-mute hover:border-sky"}`}>{t("dt.inv.new")}</button>
            {inv.isLoading && <div className="animate-pulse text-[11px] text-mute">{t("common.loading")}</div>}
            {!inv.isLoading && open.length === 0 && <p className="text-[10px] text-mute">{t("dt.inv.noOpen")}</p>}
            {open.length > 0 && <p className="pt-1 text-[10px] text-mute">{t("dt.inv.existing")}</p>}
            {open.map((i) => (
              <button key={i._id} type="button" aria-pressed={target === i._id} onClick={() => setTarget(i._id)} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-[11px] ${target === i._id ? "border-teal bg-teal/10 text-ink" : "border-edge bg-card2 text-mute hover:border-sky"}`}>
                <span dir="ltr" className="font-mono">{invLabel(i.invoiceNumber)}</span>
                <span dir="ltr" className="ms-auto">{money(i.total)}</span>
                <span className="text-[9px]">{i.status === "partially_paid" ? t("inv.partial") : t("inv.unpaid")}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-mute">{t("dt.inv.note")}</p>
        {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={bill.isPending}>{t("dm.cancel")}</button>
          <button type="button" className="btn-teal text-xs disabled:opacity-50" disabled={!canSave} onClick={confirm}>{t("dt.inv.confirm")}</button>
        </div>
      </div>
    </Modal>
  );
}
