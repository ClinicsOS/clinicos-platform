"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { Invoice } from "@/lib/types";
import { useBillTreatment } from "@/lib/dental/hooks";
import type { SurfaceId } from "@/lib/dental/taxonomy";
import type { TargetType } from "@/lib/dental/types";
import { procLabel } from "@/lib/dental/procedures";
import { TargetText, invLabel, invoiceDescription, money } from "./shared";

/** What the modal needs to know about the treatment (works from a plan item or from a visit session snapshot). */
export interface BillableTreatment {
  _id: string;
  procedureCode: string;
  customName?: string;
  targetType: TargetType;
  toothNumbers: string[];
  surfaces: SurfaceId[];
  estimatedPrice: number | null;
}

/**
 * The compact confirmation for the ONE billing action. The dentist's estimate only PRE-FILLS the actual price;
 * the person confirming reviews / changes it — what they confirm becomes the authoritative invoice line.
 * "Invoiced" is shown by the screens only after the server confirms (this modal closes on success and the data refetches).
 */
export default function AddToInvoiceModal({ patientId, item, onClose }: { patientId: string; item: BillableTreatment; onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const bill = useBillTreatment(patientId);
  const lock = useRef(false); // the server is idempotent too; this just stops a second click from even being sent
  const [price, setPrice] = useState(item.estimatedPrice != null ? String(item.estimatedPrice) : "");
  const [desc, setDesc] = useState(invoiceDescription(t, lang, item));
  const [target, setTarget] = useState<string>("new");
  const [error, setError] = useState("");

  // Reuses the same query (key + endpoint) the patient profile already uses for the patient's invoices.
  const inv = useQuery({
    queryKey: ["invoices", patientId],
    queryFn: async () => (await api.get<Invoice[]>(`/invoices?patientId=${patientId}`)).data,
  });
  const open = (inv.data ?? []).filter((i) => i.status !== "paid"); // a fully paid invoice is not silently re-opened

  const num = price.trim() === "" ? NaN : Number(price.replace(",", "."));
  const priceOk = Number.isFinite(num) && num >= 0 && num <= 100000 && Math.abs(num * 1000 - Math.round(num * 1000)) < 1e-6;
  const descOk = desc.trim().length > 0 && desc.trim().length <= 200;
  const canSave = priceOk && descOk && !bill.isPending;

  const confirm = async () => {
    if (!canSave || lock.current) return;
    lock.current = true; setError("");
    try {
      await bill.mutateAsync({ id: item._id, price: num, description: desc.trim(), ...(target !== "new" ? { invoiceId: target } : {}) });
      toast.success(t("dn.inv.done"));
      onClose();
    } catch (e) {
      setError(errMsg(e, t("dn.err.action")));
    } finally { lock.current = false; }
  };

  return (
    <Modal title={t("dn.inv.add")} onClose={onClose}>
      <div className="space-y-3.5">
        <div className="rounded-lg border border-edge bg-card2 px-2.5 py-2 text-[12px] text-ink">
          {procLabel(t, item)} — <span className="text-mute"><TargetText targetType={item.targetType} toothNumbers={item.toothNumbers} surfaces={item.surfaces} /></span>
          <div className="mt-1 text-[11px] text-mute">{t("dn.inv.estimated")}: <span dir="ltr">{item.estimatedPrice != null ? money(item.estimatedPrice) : "—"}</span></div>
        </div>

        <div>
          <label className="lbl">{t("dn.inv.actual")} (JD)</label>
          <input dir="ltr" inputMode="decimal" className={`inp ${price.trim() !== "" && !priceOk ? "!border-red-400" : ""}`} placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={price.trim() !== "" && !priceOk} />
          {price.trim() !== "" && !priceOk && <p className="mt-1 text-[10px] text-amber-400">{t("dn.inv.err.price")}</p>}
        </div>

        <div>
          <label className="lbl">{t("dn.inv.desc")}</label>
          <input dir="auto" className={`inp ${!descOk ? "!border-red-400" : ""}`} maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} />
          {!descOk && <p className="mt-1 text-[10px] text-amber-400">{t("dn.inv.err.desc")}</p>}
        </div>

        <div>
          <label className="lbl">{t("dn.inv.target")}</label>
          <div className="space-y-1.5">
            <button type="button" aria-pressed={target === "new"} onClick={() => setTarget("new")}
              className={`w-full rounded-lg border px-2.5 py-2 text-start text-[11px] ${target === "new" ? "border-teal bg-teal/10 text-ink" : "border-edge bg-card2 text-mute hover:border-sky"}`}>{t("dn.inv.new")}</button>
            {inv.isLoading && <div className="text-[11px] text-mute animate-pulse">{t("dn.loading")}</div>}
            {!inv.isLoading && open.length === 0 && <p className="text-[10px] text-mute">{t("dn.inv.noOpen")}</p>}
            {open.length > 0 && <p className="pt-1 text-[10px] text-mute">{t("dn.inv.existing")}</p>}
            {open.map((i) => (
              <button key={i._id} type="button" aria-pressed={target === i._id} onClick={() => setTarget(i._id)}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-[11px] ${target === i._id ? "border-teal bg-teal/10 text-ink" : "border-edge bg-card2 text-mute hover:border-sky"}`}>
                <span dir="ltr" className="font-mono">{invLabel(i.invoiceNumber)}</span>
                <span dir="ltr" className="ms-auto">{money(i.total)}</span>
                <span className="text-[9px]">{i.status === "partially_paid" ? t("inv.partial") : t("inv.unpaid")}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-mute">{t("dn.inv.note")}</p>
        {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={bill.isPending}>{t("dn.cancel")}</button>
          <button type="button" className="btn-teal text-xs disabled:opacity-50" disabled={!canSave} onClick={confirm}>{t("dn.inv.confirm")}</button>
        </div>
      </div>
    </Modal>
  );
}
