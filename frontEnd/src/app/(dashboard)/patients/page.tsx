"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { useSelectedPatient } from "@/store/patient";
import Modal from "@/components/Modal";
import type { Patient } from "@/lib/types";
import { IconSearch, IconUserPlus, IconEye } from "@tabler/icons-react";

export default function PatientsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const select = useSelectedPatient((s) => s.select);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  // Debounced live search (350ms), same behaviour as the prototype
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(input);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(id);
  }, [input]);

  const { data } = useQuery({
    queryKey: ["patients", search, page],
    queryFn: async () =>
      (await api.get<{ patients: Patient[]; total: number; page: number; pages: number }>(
        `/patients?search=${encodeURIComponent(search)}&page=${page}`
      )).data,
  });

  const open = (p: Patient) => {
    select(p);
    router.push("/patients/profile");
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <h1 className="text-lg font-medium text-ink">{t("pt.title")}</h1>
        {data && <span className="pill bg-soft text-blue">{data.total} {t("pt.total")}</span>}
        <button onClick={() => setAdding(true)} className="btn-teal ms-auto !py-2 text-xs">
          <IconUserPlus size={14} /> {t("pt.add")}
        </button>
      </div>

      <div className="relative mb-3">
        <IconSearch size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-mute" />
        <input className="inp !bg-card ps-9" placeholder={t("pt.search")} value={input} onChange={(e) => setInput(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex border-b border-edge bg-card2 px-4 py-2 text-[9px] font-medium tracking-widest text-mute">
          <span className="w-16">{t("pt.file")}</span>
          <span className="flex-[1.4]">{t("pt.patient")}</span>
          <span className="flex-1">{t("pt.phone")}</span>
          <span className="hidden flex-1 sm:block">{t("pt.last")}</span>
          <span className="w-12 text-end">{t("pt.actions")}</span>
        </div>
        {data && data.patients.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-soft text-blue">
              <IconUserPlus size={24} />
            </div>
            <p className="text-sm font-medium text-ink">{t("empty.noPatients.title")}</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-mute">
              {t("empty.noPatients.body")}
            </p>
          </div>
        )}
        {(data?.patients ?? []).map((p) => (
          <div
            key={p._id}
            onClick={() => open(p)}
            className="flex cursor-pointer items-center border-b border-edge px-4 py-2.5 last:border-0 hover:bg-soft"
          >
            <span className="w-16 font-mono text-[10px] text-mute">#{String(p.fileNumber).padStart(4, "0")}</span>
            <span className="flex flex-[1.4] items-center gap-2.5 min-w-0">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-medium ${p.gender === "female" ? "bg-teal/15 text-teal" : "bg-soft text-blue"}`}>
                {p.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-ink">{p.fullName}</span>
                {p.medicalNotes && <span className="text-[9px] text-amber-500">⚠ {p.medicalNotes.slice(0, 40)}</span>}
              </span>
            </span>
            <span className="flex-1 font-mono text-[11px] text-mute" dir="ltr">{p.phone}</span>
            <span className="hidden flex-1 text-[10px] text-mute sm:block">
              {new Date(p.createdAt).toLocaleDateString()}
            </span>
            <span className="flex w-12 justify-end text-blue"><IconEye size={15} /></span>
          </div>
        ))}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-edge bg-card2 px-4 py-2 text-[10px] text-mute">
            <span>{data.page} / {data.pages}</span>
            <span className="flex gap-1">
              {Array.from({ length: Math.min(5, data.pages) }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setPage(n)} className={`h-5 w-5 rounded ${n === page ? "bg-blue text-white" : "hover:text-ink"}`}>{n}</button>
              ))}
            </span>
          </div>
        )}
      </div>

      {adding && (
        <AddPatientModal
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ["patients"] }); }}
        />
      )}
    </div>
  );
}

function AddPatientModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: "", phone: "", gender: "", birthDate: "", medicalNotes: "" });
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { fullName: form.fullName, phone: form.phone };
      if (form.gender) body.gender = form.gender;
      if (form.birthDate) body.birthDate = form.birthDate;
      if (form.medicalNotes) body.medicalNotes = form.medicalNotes;
      await api.post("/patients", body);
    },
    onSuccess: () => {
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      onDone();
    },
    onError: (e) => {
      const msg = errMsg(e, t("common.error"));
      setError(msg);
      toast.error(t("common.error"), msg);
    },
  });

  return (
    <Modal title={t("pt.add")} onClose={onClose}>
      <label className="lbl">{t("pt.name")}</label>
      <input className="inp mb-3" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
      <label className="lbl">{t("pt.phone")}</label>
      <input className="inp mb-3" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="079 000 0000" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="lbl">{t("pt.gender")}</label>
          <select className="inp" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">—</option>
            <option value="male">{t("pt.male")}</option>
            <option value="female">{t("pt.female")}</option>
          </select>
        </div>
        <div>
          <label className="lbl">{t("pt.birth")}</label>
          <input type="date" className="inp" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
        </div>
      </div>
      <label className="lbl mt-3">{t("pt.notes")}</label>
      <textarea className="inp min-h-16" value={form.medicalNotes} onChange={(e) => setForm({ ...form, medicalNotes: e.target.value })} />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <button
        onClick={() => { setError(""); create.mutate(); }}
        disabled={!form.fullName || !form.phone || create.isPending}
        className="btn-teal mt-4 w-full"
      >
        {create.isPending ? t("common.loading") : t("pt.save")}
      </button>
    </Modal>
  );
}
