"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import DepthIcon from "@/components/DepthIcon";
import Modal from "@/components/Modal";
import { useSelectedPatient } from "@/store/patient";
import { paidOf, type Invoice, type Patient } from "@/lib/types";
import {
  IconCoin,
  IconHourglass,
  IconReceipt,
  IconPlus,
  IconTrash,
  IconCreditCard,
  IconPencil,
  IconSearch,
  IconX,
  IconTrophy,
  IconFolderOpen,
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
  const router = useRouter();
  const selectPatient = useSelectedPatient((s) => s.select);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [error, setError] = useState("");

  // --- create form state ---
  const [patientSearch, setPatientSearch] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<ItemRow[]>([{ description: "", price: "", qty: "1" }]);
  const [discount, setDiscount] = useState("0");

  // --- edit form state ---
  const [editItems, setEditItems] = useState<ItemRow[]>([]);
  const [editDiscount, setEditDiscount] = useState("0");
  const [editError, setEditError] = useState("");

  // --- payment form state ---
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");

  // --- list filters ---
  const [period, setPeriod] = useState<"day" | "week" | "month" | "all">("month");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "partially_paid" | "unpaid">("all");

  // --- NEW: search + sort ---
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "total" | "balance">("newest");

  // Debounced (350ms) — same feel as the patients search.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const onSearchChange = (value: string) => {
    // Looking for a person's invoice almost always means "any date" —
    // widen the period once, when a new search starts.
    if (!searchInput.trim() && value.trim() && period !== "all") setPeriod("all");
    setSearchInput(value);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
  };

  // Compute the [from, to) date range for the selected period (null = all time)
  const dateRange = useMemo(() => {
    const now = new Date();
    if (period === "all") return null;
    if (period === "day") {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      return { from, to };
    }
    if (period === "week") {
      const to = new Date(now);
      to.setHours(23, 59, 59, 999);
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { from, to };
    }
    // month
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to };
  }, [period]);

  const { data: rawInvoices, isFetching } = useQuery({
    queryKey: ["invoices", period, statusFilter, search, sort === "total" ? "total" : "newest"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange) {
        params.set("from", dateRange.from.toISOString());
        params.set("to", dateRange.to.toISOString());
      }
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      if (sort === "total") params.set("sort", "total");
      return (await api.get<Invoice[]>(`/invoices?${params.toString()}`)).data;
    },
    placeholderData: (prev) => prev,
  });

  // "Biggest balance" is sorted here — it depends on payments, not a stored field.
  const invoices = useMemo(() => {
    if (!rawInvoices) return rawInvoices;
    if (sort !== "balance") return rawInvoices;
    return [...rawInvoices].sort((a, b) => b.total - paidOf(b) - (a.total - paidOf(a)));
  }, [rawInvoices, sort]);

  // When a search lands on exactly one patient, show their totals up top.
  const searchPatient = useMemo(() => {
    if (!search || !invoices?.length) return null;
    const first = invoices[0].patientId;
    if (!first?._id || !invoices.every((i) => i.patientId?._id === first._id)) return null;
    const billed = invoices.reduce((s, i) => s + i.total, 0);
    const paid = invoices.reduce((s, i) => s + paidOf(i), 0);
    return { patient: first, count: invoices.length, billed, paid, balance: Math.max(0, billed - paid) };
  }, [search, invoices]);

  // Crown the biggest invoice in the search results.
  const largestId = useMemo(() => {
    if (!search || !invoices || invoices.length < 2) return null;
    return invoices.reduce((m, i) => (i.total > m.total ? i : m), invoices[0])._id;
  }, [search, invoices]);

  // Invoice rows only carry name/phone/file number — load the full file first.
  const openPatientFile = async (p: Patient) => {
    try {
      const full = (await api.get<Patient>(`/patients/${p._id}`)).data;
      selectPatient(full);
      router.push("/patients/profile");
    } catch (e) {
      toast.error(t("common.error"), errMsg(e, t("common.error")));
    }
  };

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

  const editItemsTotal = editItems.reduce(
    (s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0),
    0
  );
  const editGrandTotal = Math.max(0, editItemsTotal - (Number(editDiscount) || 0));
  const editPaidSoFar = editing ? paidOf(editing) : 0;

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

  const update = useMutation({
    mutationFn: async () => {
      const body = {
        items: editItems
          .filter((it) => it.description.trim())
          .map((it) => ({
            description: it.description.trim(),
            price: Number(it.price) || 0,
            qty: Number(it.qty) || 1,
          })),
        discount: Number(editDiscount) || 0,
      };
      return (await api.put<Invoice>(`/invoices/${editing!._id}`, body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setEditing(null);
      setEditError("");
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
    },
    onError: (e) => {
      const msg = errMsg(e, t("common.error"));
      setEditError(msg);
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

      {/* ===== NEW — Search ===== */}
      <div className="relative mb-2">
        <IconSearch size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-mute" />
        <input
          className="inp !bg-card pe-9 ps-9"
          placeholder={t("inv.searchPh")}
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={t("inv.searchPh")}
        />
        {searchInput && (
          <button
            onClick={clearSearch}
            className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-mute hover:text-ink"
            aria-label={t("inv.clearSearch")}
          >
            <IconX size={14} />
          </button>
        )}
        {isFetching && searchInput && (
          <span className="absolute bottom-0 start-3 end-3 h-px overflow-hidden">
            <span className="block h-full w-1/3 animate-pulse bg-sky" />
          </span>
        )}
      </div>

      {/* ===== NEW — one-patient summary when the search finds a single person ===== */}
      {searchPatient && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-sky/40 bg-hero px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#F2F7FC]">{searchPatient.patient.fullName}</div>
            <div className="font-mono text-[10px] text-[#8FB3CC]" dir="ltr">
              #{String(searchPatient.patient.fileNumber ?? 0).padStart(4, "0")} · {searchPatient.patient.phone}
            </div>
          </div>
          {[
            [t("inv.ps.invoices"), String(searchPatient.count)],
            [t("inv.ps.billed"), `${searchPatient.billed} JD`],
            [t("inv.ps.paid"), `${searchPatient.paid} JD`],
            [t("inv.ps.balance"), `${searchPatient.balance} JD`],
          ].map(([l, v], i) => (
            <div key={l}>
              <div className="text-[9px] text-[#7FA3BE]">{l}</div>
              <div className={`text-sm font-medium ${i === 3 && searchPatient.balance > 0 ? "text-amber-300" : "text-[#F2F7FC]"}`} dir="ltr">
                {v}
              </div>
            </div>
          ))}
          <button
            onClick={() => openPatientFile(searchPatient.patient)}
            className="btn-ghost ms-auto !bg-sky/10 !border-[#8FB3CC]/50 !px-3 !py-1.5 text-[11px] !text-[#DCEBF7]"
          >
            <IconFolderOpen size={13} /> {t("inv.ps.open")}
          </button>
        </div>
      )}

      {/* Filters: period + payment status + sort */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-edge bg-card2 p-1">
          {(["day", "week", "month", "all"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                period === p ? "bg-teal text-navy" : "text-mute hover:text-ink"
              }`}
            >
              {p === "day"
                ? t("inv.periodDay")
                : p === "week"
                ? t("inv.periodWeek")
                : p === "month"
                ? t("inv.periodMonth")
                : t("inv.periodAll")}
            </button>
          ))}
        </div>

        <select
          className="inp !w-auto !py-1.5 text-[11px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">{t("inv.filterAll")}</option>
          <option value="paid">{t("inv.paid")}</option>
          <option value="partially_paid">{t("inv.partial")}</option>
          <option value="unpaid">{t("inv.unpaid")}</option>
        </select>

        <select
          className="inp !w-auto !py-1.5 text-[11px]"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label={t("inv.sortNewest")}
        >
          <option value="newest">{t("inv.sortNewest")}</option>
          <option value="total">{t("inv.sortTotal")}</option>
          <option value="balance">{t("inv.sortBalance")}</option>
        </select>

        {search && invoices && (
          <span className="ms-auto text-[10px] text-mute">
            {invoices.length} {t("inv.results")}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="flex border-b border-edge bg-card2 px-4 py-2 text-[9px] font-medium tracking-widest text-mute">
          <span className="w-24">{t("inv.invoice")}</span>
          <span className="flex-[1.2]">{t("pt.patient")}</span>
          <span className="flex-1">{t("inv.paidTotal")}</span>
          <span className="w-20">{t("inv.status")}</span>
          <span className="w-44 text-end">{t("pt.actions")}</span>
        </div>
        {invoices && invoices.length === 0 && search && (
          <div className="py-14 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-soft text-blue">
              <IconSearch size={24} />
            </div>
            <p className="text-sm font-medium text-ink">{t("inv.noMatch").replace("{q}", search)}</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-mute">{t("inv.noMatchSub")}</p>
            <div className="mt-4 flex justify-center gap-2">
              {period !== "all" && (
                <button onClick={() => setPeriod("all")} className="btn-teal !px-3 !py-1.5 text-[11px]">
                  {t("inv.searchAllTime")}
                </button>
              )}
              <button onClick={clearSearch} className="btn-ghost !px-3 !py-1.5 text-[11px]">
                {t("inv.clearSearch")}
              </button>
            </div>
          </div>
        )}
        {invoices && invoices.length === 0 && !search && (
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
              <span className="min-w-0 flex-[1.2] pe-2">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[11px] font-medium text-ink">
                    <Highlight text={inv.patientId?.fullName ?? ""} query={search} />
                  </span>
                  {inv._id === largestId && (
                    <span className="pill shrink-0 items-center gap-0.5 !px-1.5 !py-0 !text-[9px] bg-amber-500/15 text-amber-400">
                      <IconTrophy size={9} /> {t("inv.largest")}
                    </span>
                  )}
                </span>
                {search && inv.patientId?.phone && (
                  <span className="block truncate font-mono text-[9px] text-mute" dir="ltr">
                    {inv.patientId.phone}
                  </span>
                )}
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
              <span className="flex w-44 shrink-0 justify-end gap-1.5">
                <button
                  onClick={() => {
                    setEditing(inv);
                    setEditItems(
                      inv.items.map((it) => ({
                        description: it.description,
                        price: String(it.price),
                        qty: String(it.qty),
                      }))
                    );
                    setEditDiscount(String(inv.discount));
                    setEditError("");
                  }}
                  className="btn-ghost whitespace-nowrap !px-2.5 !py-1 text-[10px]"
                >
                  <IconPencil size={12} /> {t("inv.edit")}
                </button>
                {inv.status !== "paid" && (
                  <button
                    onClick={() => {
                      setPaying(inv);
                      setAmount("");
                      setError("");
                    }}
                    className="btn-ghost whitespace-nowrap !px-2.5 !py-1 text-[10px]"
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

      {/* ===== Edit invoice modal ===== */}
      {editing && (
        <Modal
          title={`${t("inv.edit")} — INV-${String(editing.invoiceNumber).padStart(4, "0")}`}
          onClose={() => setEditing(null)}
        >
          {editPaidSoFar > 0 && (
            <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
              {t("inv.editPaidWarning").replace("{amount}", String(editPaidSoFar))}
            </p>
          )}

          <label className="lbl">{t("inv.items")}</label>
          {editItems.map((it, i) => (
            <div key={i} className="mb-2 flex gap-2" dir="ltr">
              <input
                className="inp flex-[2]"
                placeholder={t("inv.desc")}
                value={it.description}
                onChange={(e) =>
                  setEditItems(editItems.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                }
              />
              <input
                className="inp w-20"
                placeholder={t("inv.price")}
                type="number"
                min={0}
                value={it.price}
                onChange={(e) => setEditItems(editItems.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              />
              <input
                className="inp w-14"
                placeholder={t("inv.qty")}
                type="number"
                min={1}
                value={it.qty}
                onChange={(e) => setEditItems(editItems.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
              />
              {editItems.length > 1 && (
                <button
                  onClick={() => setEditItems(editItems.filter((_, j) => j !== i))}
                  className="text-mute hover:text-red-400"
                  aria-label="Remove item"
                >
                  <IconTrash size={15} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setEditItems([...editItems, { description: "", price: "", qty: "1" }])}
            className="mb-3 text-xs text-blue hover:underline"
          >
            {t("inv.addItem")}
          </button>

          <div className="mb-3 flex items-end gap-3">
            <div className="flex-1">
              <label className="lbl">{t("inv.discount")}</label>
              <input
                className="inp"
                type="number"
                min={0}
                value={editDiscount}
                onChange={(e) => setEditDiscount(e.target.value)}
              />
            </div>
            <div
              className={`pb-1 text-sm font-medium ${editGrandTotal < editPaidSoFar ? "text-red-400" : "text-ink"}`}
              dir="ltr"
            >
              = {editGrandTotal} JD
            </div>
          </div>

          {editError && <p className="mb-2 text-xs text-red-400">{editError}</p>}
          <button
            className="btn-teal w-full"
            disabled={
              editGrandTotal < editPaidSoFar ||
              !editItems.some((it) => it.description.trim()) ||
              update.isPending
            }
            onClick={() => update.mutate()}
          >
            {update.isPending ? t("common.loading") : t("inv.saveChanges")}
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

/** Marks the part of a name that matches the search, so the eye lands on it. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-sky/25 px-0.5 text-ink">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}
