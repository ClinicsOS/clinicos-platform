"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAccess, useClinicDoctors } from "@/lib/access";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { DoctorDelegationRow } from "@/lib/types";
import { IconArrowRight, IconArrowLeft, IconChevronLeft, IconChevronRight, IconPlus, IconSearch, IconShieldLock, IconUsersGroup } from "@tabler/icons-react";

/**
 * PHASE 1 — Doctor coverage ("Dr Ahmad covers Dr Mahmoud's patients").
 * Owner: create / revoke. Doctor: read-only list of the coverage he gives or receives. The server enforces every rule
 * (owner-only writes, same-clinic doctors, only the covered doctor's own patients, validity window) — this page is presentation.
 */
type Tab = "active" | "expired" | "revoked";
const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((a, [k, v]) => a.replace(`{${k}}`, String(v)), s);

export default function CoveragePage() {
  const { t, lang } = useI18n();
  const access = useAccess();
  const [tab, setTab] = useState<Tab>("active");
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = access.isOwner || access.isDoctor;

  const { data, isLoading } = useQuery({
    queryKey: ["patient-access", "delegations"],
    queryFn: async () => (await api.get<{ delegations: DoctorDelegationRow[]; canManage: boolean }>("/patient-access/delegations?status=all")).data,
    enabled: allowed,
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await api.post(`/patient-access/delegations/${id}/revoke`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient-access"] });
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success(t("cov.revoked"));
    },
    onError: (e) => toast.error(t("common.error"), errMsg(e, t("common.error"))),
  });

  const rows = data?.delegations ?? [];
  const groups: Record<Tab, DoctorDelegationRow[]> = useMemo(
    () => ({
      active: rows.filter((r) => r.status === "active" || r.status === "scheduled"),
      expired: rows.filter((r) => r.status === "expired"),
      revoked: rows.filter((r) => r.status === "revoked"),
    }),
    [rows]
  );
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "ar" ? "ar-JO-u-nu-latn" : undefined) : "");
  // an end stored as "start of the next day" (inclusive end date) is shown as the last included day
  const fmtEnd = (iso: string | null) => (iso ? fmt(new Date(new Date(iso).getTime() - 1).toISOString()) : "");
  const period = (r: DoctorDelegationRow) =>
    r.startsAt && r.expiresAt ? fill(t("cov.period.range"), { from: fmt(r.startsAt), to: fmtEnd(r.expiresAt) })
    : r.expiresAt ? fill(t("cov.period.until"), { to: fmtEnd(r.expiresAt) })
    : r.startsAt ? fill(t("cov.period.from"), { from: fmt(r.startsAt) })
    : t("cov.period.untilRevoked");

  if (!allowed) {
    return <div className="card p-8 text-center text-sm text-mute">{t("cov.forbidden")}</div>;
  }
  const BackIcon = lang === "ar" ? IconArrowRight : IconArrowLeft;
  const canManage = !!data?.canManage;
  const pill: Record<string, string> = {
    active: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
    scheduled: "border-sky/30 bg-sky/10 text-sky",
    expired: "border-edge bg-soft text-mute",
    revoked: "border-red-400/30 bg-red-500/10 text-red-300",
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Link href="/patients" className="text-mute hover:text-ink" aria-label={t("pt.title")}><BackIcon size={16} /></Link>
        <h1 className="text-lg font-medium text-ink">{t("cov.title")}</h1>
        {!canManage && data && <span className="pill border border-edge bg-soft text-mute">{t("cov.readonly")}</span>}
        {canManage && (
          <button onClick={() => setCreating(true)} className="btn-teal ms-auto !py-2 text-xs">
            <IconPlus size={14} /> {t("cov.new")}
          </button>
        )}
      </div>
      <p className="mb-4 max-w-2xl text-[11px] leading-relaxed text-mute">{canManage ? t("cov.subtitle") : t("cov.subtitle.doctor")}</p>

      <div className="mb-3 inline-flex rounded-lg border border-edge bg-card/70 p-0.5 backdrop-blur-md" role="tablist">
        {(["active", "expired", "revoked"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${tab === k ? "bg-blue text-white" : "text-mute hover:text-ink"}`}
          >
            {t(`cov.tab.${k}`)} <span className="opacity-70">({groups[k].length})</span>
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {isLoading && <div className="card p-6 text-center text-xs text-mute">{t("cov.loading")}</div>}
        {!isLoading && groups[tab].length === 0 && (
          <div className="card flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-blue"><IconUsersGroup size={22} /></span>
            <p className="text-sm text-ink">{t(`cov.empty.${tab}`)}</p>
          </div>
        )}
        {groups[tab].map((r) => (
          <div key={r._id} className="card flex flex-wrap items-center gap-3 border-edge bg-card/80 px-4 py-3 backdrop-blur-md">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-300"><IconShieldLock size={17} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink">
                <span>{r.toDoctor?.name ?? "—"}</span>
                <span className="text-mute">{t("cov.covers")}</span>
                <span>{r.fromDoctor?.name ?? "—"}</span>
                <span className={`pill border ${pill[r.status]}`}>{t(`cov.status.${r.status}`)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-mute">
                <span>{r.scope === "all" ? t("cov.scope.all") : t("cov.scope.selected")} · {fill(t("cov.patients"), { n: r.patientCount })}</span>
                <span>{period(r)}</span>
                {r.revokedAt && <span>{fmt(r.revokedAt)}</span>}
                {r.note && <span className="truncate">“{r.note}”</span>}
              </div>
            </div>
            {canManage && (r.status === "active" || r.status === "scheduled") && (
              <button
                className="btn-ghost !py-1.5 text-[11px] text-red-300"
                disabled={revoke.isPending}
                onClick={() => { if (window.confirm(t("cov.revoke.confirm"))) revoke.mutate(r._id); }}
              >
                {t("cov.revoke")}
              </button>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <CreateCoverage
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ["patient-access"] });
            qc.invalidateQueries({ queryKey: ["patients"] });
            toast.success(t("cov.created"));
          }}
        />
      )}
    </div>
  );
}

function CreateCoverage({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { doctors, data: staff } = useClinicDoctors();
  const allDoctors = (staff ?? []).filter((x) => x.role === "doctor"); // a doctor who left can still be COVERED (his patients stay); only an active doctor can cover
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [mode, setMode] = useState<"forever" | "range">("forever");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({}); // id -> name
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [err, setErr] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => { setSearch(input); setPage(1); }, 300);
    return () => window.clearTimeout(id);
  }, [input]);
  useEffect(() => { setPicked({}); setPage(1); }, [fromId]);

  const { data: pats } = useQuery({
    queryKey: ["patient-access", "doctor-patients", fromId, search, page],
    queryFn: async () =>
      (await api.get<{ patients: { _id: string; fullName: string; fileNumber: number }[]; total: number; page: number; pages: number }>(
        `/patient-access/doctors/${fromId}/patients?search=${encodeURIComponent(search)}&page=${page}`
      )).data,
    enabled: scope === "selected" && !!fromId,
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post("/patient-access/delegations", {
        fromDoctorId: fromId,
        toDoctorId: toId,
        scope,
        ...(scope === "selected" ? { patientIds: Object.keys(picked) } : {}),
        ...(mode === "range" && start ? { startsAt: start } : {}),
        ...(mode === "range" && end ? { expiresAt: end } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })).data,
    onSuccess: onCreated,
    onError: (e) => toast.error(t("common.error"), errMsg(e, t("common.error"))),
  });

  const submit = () => {
    if (!fromId || !toId || fromId === toId) return setErr(t("cov.form.err.doctors"));
    if (scope === "selected" && !Object.keys(picked).length) return setErr(t("cov.form.err.patients"));
    if (mode === "range" && start && end && end < start) return setErr(t("cov.form.err.dates"));
    setErr("");
    create.mutate();
  };
  const pickedCount = Object.keys(picked).length;
  const radio = (on: boolean) => `flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${on ? "border-sky bg-sky/10 text-ink" : "border-edge bg-card2 text-mute hover:border-sky/50"}`;

  return (
    <Modal title={t("cov.form.title")} size="lg" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="lbl" htmlFor="cov-from">{t("cov.form.from")}</label>
          <select id="cov-from" className="inp" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">{t("cov.form.pick")}</option>
            {allDoctors.map((d) => <option key={d._id} value={d._id}>{d.name}{d.isActive ? "" : " (—)"}</option>)}
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor="cov-to">{t("cov.form.to")}</label>
          <select id="cov-to" className="inp" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">{t("cov.form.pick")}</option>
            {doctors.filter((d) => d._id !== fromId).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <span className="lbl">{t("cov.form.scope")}</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={radio(scope === "all")}><input type="radio" name="cov-scope" checked={scope === "all"} onChange={() => setScope("all")} /> {t("cov.form.all")}</label>
          <label className={radio(scope === "selected")}><input type="radio" name="cov-scope" checked={scope === "selected"} onChange={() => setScope("selected")} /> {t("cov.form.selected")}</label>
        </div>
      </div>

      {scope === "selected" && (
        <div className="mt-3 rounded-xl border border-edge bg-card2/60 p-3 backdrop-blur-md">
          <div className="relative mb-2">
            <IconSearch size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-mute" />
            <input className="inp ps-9" placeholder={t("cov.form.search")} value={input} onChange={(e) => setInput(e.target.value)} disabled={!fromId} />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {fromId && pats && pats.patients.length === 0 && <p className="py-4 text-center text-[11px] text-mute">{t("cov.form.noPatients")}</p>}
            {(pats?.patients ?? []).map((p) => (
              <label key={p._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-soft">
                <input
                  type="checkbox"
                  checked={!!picked[p._id]}
                  onChange={(e) => setPicked((cur) => { const n = { ...cur }; if (e.target.checked) n[p._id] = p.fullName; else delete n[p._id]; return n; })}
                />
                <span className="font-mono text-[10px] text-mute">#{String(p.fileNumber).padStart(4, "0")}</span>
                <span className="truncate text-ink">{p.fullName}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-mute">
            <span>{fill(t("cov.form.selectedCount"), { n: pickedCount })}</span>
            {pats && pats.pages > 1 && (
              <span className="flex items-center gap-1">
                <button className="disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="prev"><IconChevronLeft size={14} /></button>
                {pats.page} / {pats.pages}
                <button className="disabled:opacity-40" disabled={page >= pats.pages} onClick={() => setPage(page + 1)} aria-label="next"><IconChevronRight size={14} /></button>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        <span className="lbl">{t("cov.form.duration")}</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={radio(mode === "forever")}><input type="radio" name="cov-mode" checked={mode === "forever"} onChange={() => setMode("forever")} /> {t("cov.form.untilRevoked")}</label>
          <label className={radio(mode === "range")}><input type="radio" name="cov-mode" checked={mode === "range"} onChange={() => setMode("range")} /> {t("cov.form.dates")}</label>
        </div>
        {mode === "range" && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="lbl" htmlFor="cov-start">{t("cov.form.start")}</label>
              <input id="cov-start" type="date" className="inp" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="cov-end">{t("cov.form.end")}</label>
              <input id="cov-end" type="date" className="inp" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="lbl" htmlFor="cov-note">{t("cov.form.note")}</label>
        <input id="cov-note" className="inp" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-mute">{t("cov.note.ownership")}</p>
      {err && <p role="alert" className="mt-2 text-xs text-red-400">{err}</p>}
      <div className="sticky bottom-0 -mx-5 mt-4 border-t border-edge bg-card/90 px-5 py-3 backdrop-blur-md">
        <button className="btn-teal w-full" disabled={create.isPending} onClick={submit}>{t("cov.form.submit")}</button>
      </div>
    </Modal>
  );
}
