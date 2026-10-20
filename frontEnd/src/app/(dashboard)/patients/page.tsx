"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useAccess, useClinicDoctors } from "@/lib/access";
import { useToast } from "@/components/Toast";
import AccessBadge from "@/components/patients/AccessBadge";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import Modal from "@/components/Modal";
import PatientForm from "@/components/patients/PatientForm";
import { activeFlags, severityPill } from "@/lib/medical";
import type { Patient } from "@/lib/types";
import { IconSearch, IconUserPlus, IconEye, IconUsersGroup } from "@tabler/icons-react";

export default function PatientsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const select = useSelectedPatient((s) => s.select);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  // PHASE 1 — multi-doctor isolation. The SERVER narrows the list (a doctor gets only his own + covered patients); these controls only
  // choose a view inside what the server already allows: doctor → All / My patients / Covering, owner & front desk → one doctor / Unassigned.
  const access = useAccess();
  const toast = useToast();
  const [scope, setScope] = useState<"all" | "mine" | "delegated">("all");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [assigning, setAssigning] = useState<Patient | null>(null);
  const { doctors } = useClinicDoctors(!access.isDoctor);

  // Debounced live search (350ms), same behaviour as the prototype
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(input);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(id);
  }, [input]);

  const { data } = useQuery({
    queryKey: ["patients", search, page, scope, doctorFilter],
    queryFn: async () =>
      (await api.get<{ patients: Patient[]; total: number; page: number; pages: number }>(
        `/patients?search=${encodeURIComponent(search)}&page=${page}` +
          (access.isDoctor ? `&scope=${scope}` : doctorFilter ? `&doctorId=${encodeURIComponent(doctorFilter)}` : "")
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
        {(access.isOwner || access.isDoctor) && (
          <Link href="/patients/coverage" className="btn-ghost ms-auto !py-2 text-xs backdrop-blur-sm">
            <IconUsersGroup size={14} /> {t("pa.coverage.open")}
          </Link>
        )}
        <button onClick={() => setAdding(true)} className={`btn-teal !py-2 text-xs ${access.isOwner || access.isDoctor ? "" : "ms-auto"}`}>
          <IconUserPlus size={14} /> {t("pt.add")}
        </button>
      </div>

      {/* view switch: server-side scope (doctor) / doctor filter (owner, front desk) */}
      {access.isDoctor ? (
        <div className="mb-3 inline-flex rounded-lg border border-edge bg-card/70 p-0.5 backdrop-blur-md" role="tablist">
          {(["all", "mine", "delegated"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={scope === k}
              onClick={() => { setScope(k); setPage(1); }}
              className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${scope === k ? "bg-blue text-white" : "text-mute hover:text-ink"}`}
            >
              {t(`pa.tab.${k}`)}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-[11px] text-mute" htmlFor="pt-doctor-filter">{t("pa.filter.doctor")}</label>
          <select
            id="pt-doctor-filter"
            className="inp !w-auto !py-1.5 text-xs"
            value={doctorFilter}
            onChange={(e) => { setDoctorFilter(e.target.value); setPage(1); }}
          >
            <option value="">{t("pa.filter.allDoctors")}</option>
            <option value="unassigned">{t("pa.filter.unassigned")}</option>
            {doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </select>
        </div>
      )}

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
              {access.isDoctor && scope === "mine" && !search ? t("pa.empty.mine") : access.isDoctor && scope === "delegated" && !search ? t("pa.empty.delegated") : t("empty.noPatients.body")}
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
                <span className="mt-0.5 flex flex-wrap items-center gap-1">
                  <AccessBadge access={p.access} compact />
                  {access.isOwner && p.access?.kind === "clinic" && p.access.doctors.length === 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAssigning(p); }}
                      className="pill !px-1.5 !py-0 !text-[9px] border border-sky/40 bg-sky/10 text-sky hover:bg-sky/20"
                    >
                      {t("pa.assign")}
                    </button>
                  )}
                </span>
                <MedicalBadges p={p} />
              </span>
            </span>
            <span className="flex-1 pe-3 font-mono text-[11px] text-mute">
              <span dir="ltr">{p.phone}</span>
            </span>
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

      {assigning && (
        <AssignModal
          patient={assigning}
          doctors={doctors}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            qc.invalidateQueries({ queryKey: ["patients"] });
            toast.success(t("pa.assign.done"));
          }}
          onError={(m) => toast.error(t("common.error"), m)}
        />
      )}

      {adding && (
        <Modal title={t("pt.add")} size="lg" onClose={() => setAdding(false)}>
          <PatientForm
            mode="create"
            onSaved={(p) => {
              setAdding(false);
              qc.invalidateQueries({ queryKey: ["patients"] });
              // Jump straight into the new file so the doctor can see it.
              open(p);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * Up to two of the most important "yes" answers from the medical history,
 * so the receptionist sees an allergy or a pregnancy right in the list.
 * Falls back to the old free-text note for patients without a checklist.
 */
function MedicalBadges({ p }: { p: Patient }) {
  const { t } = useI18n();
  const flags = activeFlags(p);
  if (flags.length) {
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-1">
        {flags.slice(0, 2).map((f) => (
          <span key={f.key} className={`pill !px-1.5 !py-0 !text-[9px] ${severityPill[f.severity]}`}>
            {t(`med.${f.key}`)}
          </span>
        ))}
        {flags.length > 2 && <span className="text-[9px] text-mute">+{flags.length - 2}</span>}
      </span>
    );
  }
  if (p.medicalNotes) {
    return <span className="block truncate text-[9px] text-amber-500">⚠ {p.medicalNotes.slice(0, 40)}</span>;
  }
  return null;
}

/** Owner only (the server enforces it): make a doctor the primary doctor of a patient nobody is linked to. */
function AssignModal({ patient, doctors, onClose, onDone, onError }: {
  patient: Patient;
  doctors: { _id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [doctorId, setDoctorId] = useState("");
  const m = useMutation({
    mutationFn: async () => (await api.post("/patient-access/assign", { patientId: patient._id, doctorId })).data,
    onSuccess: onDone,
    onError: (e) => onError(errMsg(e, t("common.error"))),
  });
  return (
    <Modal title={t("pa.assign.title")} subtitle={patient.fullName} onClose={onClose}>
      <p className="mb-3 text-[11px] leading-relaxed text-mute">{t("pa.assign.body")}</p>
      <select className="inp mb-4" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label={t("pa.assign.pick")}>
        <option value="">{t("pa.assign.pick")}</option>
        {doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
      </select>
      <button className="btn-teal w-full" disabled={!doctorId || m.isPending} onClick={() => m.mutate()}>{t("pa.assign")}</button>
    </Modal>
  );
}
