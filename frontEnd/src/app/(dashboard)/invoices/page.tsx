"use client";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import DepthIcon from "@/components/DepthIcon";
import Modal from "@/components/Modal";
import { paidOf, type Invoice, type Patient } from "@/lib/types";
import {
  IconCoin,
  IconHourglass,
  IconReceipt,
  IconPlus,
  IconTrash,
  IconCreditCard,
} from "@tabler/icons-react";

const statusPill: Record<string, string> = {
  paid: "bg-teal/15 text-teal",
  partially_paid: "bg-amber-500/15 text-amber-400",
  unpaid: "bg-red-500/15 text-red-400",
};

interface ItemRow {
  description: string;
  price: string;
  qty: string;
}

export default function InvoicesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [error, setError] = useState("");

  // --- create form state ---
  const [patientSearch, setPatientSearch] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<ItemRow[]>([{ description: "", price: "", qty: "1" }]);
  const [discount, setDiscount] = useState("0");

  // --- payment form state ---
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");

  const { data: invoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.get<Invoice[]>("/invoices")).data,
  });

  const { data: patientResults } = useQuery({
    queryKey: ["patients", patientSearch, 1],
    queryFn: async () =>
      (
        await api.get<{ patients: Patient[] }>(
          `/patients?search=${encodeURIComponent(patientSearch)}&page=1`
        )
      ).data,
    enabled: creating && patientSearch.length > 0 && !patient,
  });

  // Summary numbers computed from the list (this month, outstanding, count)
  const summary = useMemo(() => {
    const list = invoices ?? [];
    const now = new Date();
    let month = 0;
    let outstanding = 0;
    for (const inv of list) {
      const paid = paidOf(inv);
      outstanding += Math.max(0, inv.total - paid);
      for (const p of inv.payments) {
        const d = new Date(p.paidAt);
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
          month += p.amount;
        }
      }
    }
    return { month, outstanding, count: list.length };
  }, [invoices]);

  const itemsTotal = items.reduce(
    (s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0),
    0
  );
  const grandTotal = Math.max(0, itemsTotal - (Number(discount) || 0));

  const resetCreate = () => {
    setPatient(null);
    setPatientSearch("");
    setItems([{ description: "", price: "", qty: "1" }]);
    setDiscount("0");
    setError("");
  };

  const create = useMutation({
    mutationFn: async () => {
      const body = {
        patientId: patient!._id,
        items: items
          .filter((it) => it.description.trim())
          .map((it) => ({
            description: it.description.trim(),
            price: Number(it.price) || 0,
            qty: Number(it.qty) || 1,
          })),
        discount: Number(discount) || 0,
      };
      return (await api.post<Invoice>("/invoices", body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setCreating(false);
      resetCreate();
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
    },
    onError: (e) => {
      const msg = errMsg(e, t("common.error"));
      setError(msg);
      toast.error(t("common.error"), msg);
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      return (
        await api.post<Invoice>(`/invoices/${paying!._id}/payments`, {
          amount: Number(amount),
          method,
        })
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setPaying(null);
      setAmount("");
      setError("");
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
    },
    onError: (e) => {
      const msg = errMsg(e, t("common.error"));
      setError(msg);
      toast.error(t("common.error"), msg);
    },
  });

  const cards = [
    { icon: <IconCoin size={16} />, v: `${summary.month} JD`, l: t("inv.month"), d: 0 },
    { icon: <IconHourglass size={16} />, v: `${summary.outstanding} JD`, l: t("inv.out"), d: 0.8 },
    { icon: <IconReceipt size={16} />, v: summary.count, l: t("inv.count"), d: 1.6 },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <h1 className="text-lg font-medium text-ink">{t("inv.title")}</h1>
        <button onClick={() => setCreating(true)} className="btn-teal ms-auto !py-2 text-xs">
          <IconPlus size={14} /> {t("inv.new")}
        </button>
      </div>

      {/* Summary cards with 3D depth icons */}
      <div className="mb-3 grid grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.l} className="card flex items-center gap-3 p-3.5">
            <DepthIcon delay={c.d}>{c.icon}</DepthIcon>
            <div>
              <div className="text-base font-medium text-ink">{c.v}</div>
              <div className="text-[9px] tracking-widest text-mute">{c.l}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="flex border-b border-edge bg-card2 px-4 py-2 text-[9px] font-medium tracking-widest text-mute">
          <span className="w-24">{t("inv.invoice")}</span>
          <span className="flex-[1.2]">{t("pt.patient")}</span>
          <span className="flex-1">{t("inv.paidTotal")}</span>
          <span className="w-20">{t("inv.status")}</span>
          <span className="w-20 text-end">{t("pt.actions")}</span>
        </div>
        {invoices && invoices.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-soft text-blue">
              <IconReceipt size={24} />
            </div>
            <p className="text-sm font-medium text-ink">{t("empty.noInvoices.title")}</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-mute">
              {t("empty.noInvoices.body")}
            </p>
          </div>
        )}
        {(invoices ?? []).map((inv) => {
          const paid = paidOf(inv);
          const pct = inv.total ? Math.min(100, Math.round((paid / inv.total) * 100)) : 100;
          return (
            <div key={inv._id} className="flex items-center border-b border-edge px-4 py-2.5 last:border-0">
              <span className="w-24 font-mono text-[10px] text-blue">
                INV-{String(inv.invoiceNumber).padStart(4, "0")}
              </span>
              <span className="flex-[1.2] truncate text-[11px] font-medium text-ink">
                {inv.patientId?.fullName}
              </span>
              <span className="flex-1 pe-3">
                <span className="font-mono text-[10px] text-ink">
                  {paid} / {inv.total} JD
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-soft">
                  <span className="block h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
                </span>
              </span>
              <span className="w-20">
                <span className={`pill ${statusPill[inv.status] ?? "bg-soft text-mute"}`}>
                  {inv.status === "paid" ? t("inv.paid") : inv.status === "partially_paid" ? t("inv.partial") : t("inv.unpaid")}
                </span>
              </span>
              <span className="flex w-20 justify-end">
                {inv.status !== "paid" && (
                  <button
                    onClick={() => {
                      setPaying(inv);
                      setAmount("");
                      setError("");
                    }}
                    className="btn-ghost !px-2.5 !py-1 text-[10px]"
                  >
                    <IconCreditCard size={12} /> {t("inv.addPayment")}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* ===== Create invoice modal ===== */}
      {creating && (
        <Modal title={t("inv.new")} onClose={() => setCreating(false)}>
          <label className="lbl">{t("ap.patient")}</label>
          {patient ? (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-xs text-ink">
              <span>
                {patient.fullName} <span className="text-mute">· {patient.phone}</span>
              </span>
              <button onClick={() => setPatient(null)} className="text-mute hover:text-ink">✕</button>
            </div>
          ) : (
            <div className="relative mb-3">
              <input
                className="inp"
                placeholder={t("pt.search")}
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
              {patientResults && patientSearch && (
                <div className="absolute z-10 mt-1 max-h-40 w-full overflow-auto rounded-lg border border-edge bg-card shadow-lg">
                  {patientResults.patients.length === 0 && (
                    <p className="px-3 py-2 text-xs text-mute">{t("pt.none")}</p>
                  )}
                  {patientResults.patients.map((p) => (
                    <button
                      key={p._id}
                      onClick={() => setPatient(p)}
                      className="block w-full px-3 py-2 text-start text-xs text-ink hover:bg-soft"
                    >
                      {p.fullName} <span className="text-mute">· {p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="lbl">{t("inv.items")}</label>
          {items.map((it, i) => (
            <div key={i} className="mb-2 flex gap-2" dir="ltr">
              <input
                className="inp flex-[2]"
                placeholder={t("inv.desc")}
                value={it.description}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                }
              />
              <input
                className="inp w-20"
                placeholder={t("inv.price")}
                type="number"
                min={0}
                value={it.price}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              />
              <input
                className="inp w-14"
                placeholder={t("inv.qty")}
                type="number"
                min={1}
                value={it.qty}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
              />
              {items.length > 1 && (
                <button
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  className="text-mute hover:text-red-400"
                  aria-label="Remove item"
                >
                  <IconTrash size={15} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setItems([...items, { description: "", price: "", qty: "1" }])}
            className="mb-3 text-xs text-blue hover:underline"
          >
            {t("inv.addItem")}
          </button>

          <div className="mb-3 flex items-end gap-3">
            <div className="flex-1">
              <label className="lbl">{t("inv.discount")}</label>
              <input className="inp" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="pb-1 text-sm font-medium text-ink" dir="ltr">
              = {grandTotal} JD
            </div>
          </div>

          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <button
            className="btn-teal w-full"
            disabled={!patient || grandTotal < 0 || !items.some((it) => it.description.trim()) || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? t("common.loading") : t("inv.create")}
          </button>
        </Modal>
      )}

      {/* ===== Add payment modal ===== */}
      {paying && (
        <Modal title={`${t("inv.addPayment")} — INV-${String(paying.invoiceNumber).padStart(4, "0")}`} onClose={() => setPaying(null)}>
          <p className="mb-3 text-xs text-mute" dir="ltr">
            {paidOf(paying)} / {paying.total} JD
          </p>
          <label className="lbl">{t("inv.amount")}</label>
          <input className="inp mb-3" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          <label className="lbl">{t("inv.method")}</label>
          <select className="inp mb-4" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="cliq">CliQ</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <button className="btn-teal w-full" disabled={!Number(amount) || pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? t("common.loading") : t("ap.save")}
          </button>
        </Modal>
      )}
    </div>
  );
}
