"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import DepthIcon from "@/components/DepthIcon";
import FloatingPlus from "@/components/FloatingPlus";
import Modal from "@/components/Modal";
import PatientForm from "@/components/patients/PatientForm";
import { paidOf, type Appointment, type Invoice, type Patient } from "@/lib/types";
import {
  MEDICAL_GROUPS,
  activeFlags,
  hasMedicalHistory,
  severityOf,
  type MedicalKey,
} from "@/lib/medical";
import {
  IconStethoscope,
  IconUserX,
  IconCoin,
  IconHeart,
  IconAlertTriangle,
  IconId,
  IconCalendarPlus,
  IconReceipt,
  IconPhone,
  IconPencil,
  IconHeartbeat,
  IconLifebuoy,
  IconCircleCheck,
  IconDroplet,
  IconBrandWhatsapp,
  IconNotes,
} from "@tabler/icons-react";

const pillClass: Record<string, string> = {
  scheduled: "bg-blue/15 text-sky",
  confirmed: "bg-teal/15 text-teal",
  completed: "bg-teal/15 text-teal",
  cancelled: "bg-red-500/15 text-red-400",
  no_show: "bg-amber-500/15 text-amber-400",
};

type EditTab = "personal" | "medical" | "contact";

export default function PatientProfilePage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const selected = useSelectedPatient((s) => s.selected);
  const select = useSelectedPatient((s) => s.select);
  const [editing, setEditing] = useState<EditTab | null>(null);

  // NEW — always read the latest version of the file from the server (the
  // stored selection can be stale after an edit from another device).
  const { data: fresh } = useQuery({
    queryKey: ["patient", selected?._id],
    queryFn: async () => (await api.get<Patient>(`/patients/${selected!._id}`)).data,
    enabled: !!selected,
    initialData: selected ?? undefined,
  });
  const patient = fresh ?? selected;

  const { data: allAppts } = useQuery({
    queryKey: ["appointments-all"],
    queryFn: async () => (await api.get<Appointment[]>("/appointments")).data,
    enabled: !!patient,
  });
  const { data: invoices } = useQuery({
    queryKey: ["invoices", patient?._id],
    queryFn: async () => (await api.get<Invoice[]>(`/invoices?patientId=${patient!._id}`)).data,
    enabled: !!patient,
  });

  if (!patient) {
    return (
      <div className="card p-8 text-center text-sm text-mute">
        {t("pp.missing")}{" "}
        <Link href="/patients" className="text-blue hover:underline">{t("pt.title")} →</Link>
      </div>
    );
  }

  const visits = (allAppts ?? [])
    .filter((a) => {
      const pid = typeof a.patientId === "string" ? a.patientId : a.patientId?._id;
      return pid === patient._id;
    })
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

  const noShows = visits.filter((v) => v.status === "no_show").length;
  const totalPaid = (invoices ?? []).reduce((s, i) => s + paidOf(i), 0);
  const balance = (invoices ?? []).reduce((s, i) => s + Math.max(0, i.total - paidOf(i)), 0);
  const since = new Date(patient.createdAt).getFullYear();
  const age = patient.birthDate ? Math.floor((Date.now() - new Date(patient.birthDate).getTime()) / 3.15576e10) : null;
  const initials = patient.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const flags = activeFlags(patient);
  const critical = flags.filter((f) => f.severity === "critical");
  const filled = hasMedicalHistory(patient);

  const stats = [
    { icon: <IconStethoscope size={15} />, v: visits.length, l: t("pp.visits"), d: 0 },
    { icon: <IconUserX size={15} />, v: noShows, l: t("pp.noshows"), d: 0.7 },
    { icon: <IconCoin size={15} />, v: `${totalPaid} JD`, l: t("pp.paid"), d: 1.4 },
    { icon: <IconHeart size={15} />, v: since, l: t("pp.since"), d: 2.1 },
  ];

  const details: [string, string | undefined, boolean?][] = [
    [t("pp.dob"), patient.birthDate ? `${new Date(patient.birthDate).toLocaleDateString()}${age !== null ? ` · ${age} ${t("pp.years")}` : ""}` : undefined],
    [t("pp.city"), patient.phone, true],
    [t("pf.email"), patient.email, true],
    [t("pf.nationalId"), patient.nationalId, true],
    [t("pf.occupation"), patient.occupation],
    [t("pf.marital"), patient.maritalStatus ? t(`pf.marital.${patient.maritalStatus}`) : undefined],
    [t("pf.address"), patient.address],
    [t("pf.referral"), patient.referralSource ? t(`pf.ref.${patient.referralSource}`) : undefined],
    [t("pp.opened"), new Date(patient.createdAt).toLocaleDateString()],
  ];

  const ec = patient.emergencyContact;
  const ins = patient.insurance;
  const hasContact = !!(ec?.name || ec?.phone || ins?.provider || ins?.policyNumber);

  const onSaved = (p: Patient) => {
    qc.setQueryData(["patient", p._id], p);
    select(p);
    qc.invalidateQueries({ queryKey: ["patients"] });
    setEditing(null);
  };

  return (
    <div>
      {/* ===== Hero: orbiting 3D avatar ===== */}
      <div className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-xl bg-hero p-4">
        <FloatingPlus style={{ top: 12, right: "22%" }} />
        <FloatingPlus style={{ bottom: 10, right: "8%" }} delay={2} />
        <div className="relative h-[74px] w-[74px] shrink-0" style={{ perspective: 400 }}>
          <span className="orbit orbit-a" />
          <span className="orbit orbit2 orbit-b" />
          <span className="absolute inset-[9px] z-10 flex items-center justify-center rounded-full bg-teal text-lg font-medium text-navy">
            {initials}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-[#F2F7FC]">
            {patient.fullName}
            <span className="rounded-full border border-sky/40 bg-sky/10 px-2 py-0.5 font-mono text-[9px] text-sky">
              #{String(patient.fileNumber).padStart(4, "0")}
            </span>
          </h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {patient.gender && (
              <span className="pill border border-sky/30 bg-sky/10 text-[#B8D4EA] capitalize">
                {t(`pt.${patient.gender}`)}{age !== null ? ` · ${age}` : ""}
              </span>
            )}
            <span className="pill items-center gap-1 border border-sky/30 bg-sky/10 text-[#B8D4EA]" dir="ltr">
              <IconPhone size={9} /> {patient.phone}
            </span>
            {patient.bloodType && (
              <span className="pill items-center gap-1 border border-red-400/40 bg-red-500/15 font-mono text-red-300" dir="ltr">
                <IconDroplet size={9} /> {patient.bloodType}
              </span>
            )}
            {critical.slice(0, 3).map((f) => (
              <span key={f.key} className="pill items-center gap-1 border border-red-400/50 bg-red-500/20 text-red-200">
                <IconAlertTriangle size={9} /> {t(`med.${f.key}`)}
              </span>
            ))}
            {critical.length > 3 && (
              <span className="pill border border-red-400/40 bg-red-500/10 text-red-200">+{critical.length - 3}</span>
            )}
            {!flags.length && patient.medicalNotes && (
              <span className="pill border border-amber-500/40 bg-amber-500/15 text-amber-300">⚠ {patient.medicalNotes.slice(0, 50)}</span>
            )}
            {patient.whatsappOptIn === false && (
              <span className="pill items-center gap-1 border border-sky/30 bg-sky/10 text-[#8FB3CC]">
                <IconBrandWhatsapp size={9} /> {t("pp.whatsappOff")}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEditing("personal")} className="btn-ghost !bg-sky/10 !text-[#DCEBF7] !border-[#8FB3CC]/50 !py-2 text-xs">
            <IconPencil size={14} /> {t("pp.edit")}
          </button>
          <Link href="/appointments" className="btn-teal !py-2 text-xs"><IconCalendarPlus size={14} /> {t("pp.book")}</Link>
          <Link href="/invoices" className="btn-ghost !bg-sky/10 !text-[#DCEBF7] !border-[#8FB3CC]/50 !py-2 text-xs"><IconReceipt size={14} /> {t("pp.invoice")}</Link>
        </div>
      </div>

      {/* ===== Stats with rotating depth icons ===== */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.l} className="card flex items-center gap-3 p-3">
            <DepthIcon delay={s.d}>{s.icon}</DepthIcon>
            <div>
              <div className="text-sm font-medium leading-tight text-ink">{s.v}</div>
              <div className="text-[8px] tracking-widest text-mute">{s.l}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.35fr]">
        <div>
          {/* Personal details */}
          <div className="card p-4">
            <div className="mb-2 flex items-center">
              <h2 className="flex items-center gap-1.5 text-xs font-medium text-ink"><IconId size={14} className="text-blue" /> {t("pp.details")}</h2>
              <button onClick={() => setEditing("personal")} className="ms-auto text-mute hover:text-sky" aria-label={t("pp.edit")}>
                <IconPencil size={13} />
              </button>
            </div>
            {details
              .filter(([, v]) => !!v)
              .map(([l, v, ltr]) => (
                <div key={l} className="flex justify-between gap-3 border-b border-edge py-1.5 text-[11px] last:border-0">
                  <span className="shrink-0 text-mute">{l}</span>
                  <span className="min-w-0 truncate text-end font-medium text-ink" dir={ltr ? "ltr" : "auto"}>{v}</span>
                </div>
              ))}
          </div>

          {/* Emergency & insurance */}
          <div className="card mt-3 p-4">
            <div className="mb-2 flex items-center">
              <h2 className="flex items-center gap-1.5 text-xs font-medium text-ink"><IconLifebuoy size={14} className="text-blue" /> {t("pp.contact")}</h2>
              <button onClick={() => setEditing("contact")} className="ms-auto text-mute hover:text-sky" aria-label={t("pp.edit")}>
                <IconPencil size={13} />
              </button>
            </div>
            {!hasContact && <p className="py-1 text-[11px] text-mute">{t("pp.noContact")}</p>}
            {(ec?.name || ec?.phone) && (
              <div className="rounded-lg border border-edge bg-card2 px-3 py-2">
                <div className="text-[9px] text-mute">{t("pf.ec.title")}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-ink">
                  {ec?.name}
                  {ec?.relation && <span className="font-normal text-mute">({ec.relation})</span>}
                  {ec?.phone && (
                    <a href={`tel:${ec.phone}`} className="ms-auto font-mono text-sky hover:underline" dir="ltr">{ec.phone}</a>
                  )}
                </div>
              </div>
            )}
            {(ins?.provider || ins?.policyNumber) && (
              <div className="mt-2 rounded-lg border border-edge bg-card2 px-3 py-2">
                <div className="text-[9px] text-mute">{t("pf.ins.title")}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-ink">
                  {ins?.provider}
                  {ins?.policyNumber && <span className="ms-auto font-mono text-mute" dir="ltr">{ins.policyNumber}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Floating balance card — bobs in 3D like the prototype */}
          <div className="bob mt-3 rounded-xl border border-sky/40 bg-hero p-3.5">
            <div className="text-[8px] tracking-widest text-[#7FA3BE]">{t("pp.balance")}</div>
            <div className="mt-0.5 text-lg font-medium text-[#F2F7FC]">{balance.toFixed(2)} JD</div>
            <Link href="/invoices" className="btn-teal mt-2 !px-3 !py-1.5 text-[10px]">{t("pp.pay")}</Link>
          </div>
        </div>

        <div>
          {/* ===== NEW — Medical profile ===== */}
          <div className={`card p-4 ${critical.length ? "border-red-500/40" : ""}`}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <IconHeartbeat size={14} className={critical.length ? "text-red-400" : "text-teal"} /> {t("pp.medical")}
              </h2>
              {critical.length > 0 && (
                <span className="pill bg-red-500/15 text-red-400">{t("pp.critical")}</span>
              )}
              <button onClick={() => setEditing("medical")} className="ms-auto text-mute hover:text-sky" aria-label={t("pp.edit")}>
                <IconPencil size={13} />
              </button>
            </div>

            {!filled && !patient.medicalNotes && (
              <div className="rounded-lg border border-dashed border-edge px-4 py-6 text-center">
                <IconHeartbeat size={22} className="mx-auto mb-2 text-mute" />
                <p className="text-[11px] text-mute">{t("pp.medicalEmpty")}</p>
                <button onClick={() => setEditing("medical")} className="btn-teal mt-3 !px-3 !py-1.5 text-[11px]">
                  {t("pp.medicalFill")}
                </button>
              </div>
            )}

            {filled && flags.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-teal/30 bg-teal/10 px-3 py-2.5 text-[11px] text-teal">
                <IconCircleCheck size={15} className="shrink-0" /> {t("pp.medicalClear")}
              </div>
            )}

            {flags.length > 0 &&
              MEDICAL_GROUPS.map((g) => {
                const items = g.keys.filter((k) => patient.medicalHistory?.[k]?.has);
                if (!items.length) return null;
                return (
                  <div key={g.id} className="mb-3 last:mb-0">
                    <div className="mb-1.5 text-[10px] font-medium text-mute">{t(`pf.group.${g.id}`)}</div>
                    <div className="grid gap-1.5">
                      {items.map((k) => (
                        <MedicalLine key={k} k={k} label={t(`med.${k}`)} details={patient.medicalHistory?.[k]?.details} />
                      ))}
                    </div>
                  </div>
                );
              })}

            {patient.medicalNotes && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-mute">
                  <IconNotes size={11} /> {t("pp.generalNotes")}
                </div>
                <div dir="auto" className="whitespace-pre-line rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-start text-[11px] leading-relaxed text-amber-500">
                  {patient.medicalNotes}
                </div>
              </div>
            )}

            {patient.medicalUpdatedAt && (
              <div className="mt-3 text-[9px] text-mute">
                {t("pp.medicalUpdated")}: {new Date(patient.medicalUpdatedAt).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* ===== Visit timeline with spinning cube nodes ===== */}
          <div className="card mt-3 p-4">
            <h2 className="mb-3 text-xs font-medium text-ink">{t("pp.history")}</h2>
            <div className="relative ps-7">
              <span className="absolute inset-y-1 start-2 border-s border-dashed border-edge" />
              {visits.length === 0 && <p className="py-4 text-xs text-mute">{t("dash.empty")}</p>}
              {visits.map((v) => {
                const doc = v.doctorId as { name?: string };
                return (
                  <div key={v._id} className="relative mb-3 last:mb-0">
                    <span
                      className={`preserve-3d spin-slow absolute -start-7 top-1.5 h-4 w-4 rounded border ${
                        v.status === "completed" ? "border-teal bg-teal/20" : "border-blue bg-blue/15"
                      }`}
                    />
                    {/* depth-layer card */}
                    <div className="preserve-3d relative rounded-lg border border-edge bg-card2 px-3 py-2">
                      <span
                        aria-hidden
                        className="absolute inset-0 -z-10 rounded-lg border border-teal/40"
                        style={{ transform: "translateZ(-8px) translate(4px,4px)" }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-ink">
                          {new Date(v.startAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                          {new Date(v.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}
                        </span>
                        <span className={`pill ${pillClass[v.status] ?? "bg-soft text-mute"}`}>{t(`status.${v.status}`)}</span>
                        <span className="ms-auto text-[9px] text-mute">{doc?.name}</span>
                      </div>
                      {v.visitNote && <p className="mt-1 text-[10px] leading-relaxed text-mute">&ldquo;{v.visitNote}&rdquo;</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ===== NEW — Edit the whole file ===== */}
      {editing && (
        <Modal
          title={t("pf.editTitle")}
          subtitle={`${patient.fullName} · #${String(patient.fileNumber).padStart(4, "0")}`}
          size="lg"
          onClose={() => setEditing(null)}
        >
          <PatientForm mode="edit" initial={patient} startTab={editing} onSaved={onSaved} />
        </Modal>
      )}
    </div>
  );
}

/** One "yes" answer, coloured by how much it matters before treatment. */
function MedicalLine({ k, label, details }: { k: MedicalKey; label: string; details?: string }) {
  const sev = severityOf(k);
  const tone =
    sev === "critical"
      ? "border-red-500/40 bg-red-500/10 text-red-400"
      : sev === "caution"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
      : "border-edge bg-card2 text-ink";
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${tone}`}>
      {sev === "critical" ? (
        <IconAlertTriangle size={13} className="mt-0.5 shrink-0" />
      ) : (
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-medium">{label}</div>
        {details && <div dir="auto" className="mt-0.5 break-words text-start text-[10px] leading-relaxed opacity-90">{details}</div>}
      </div>
    </div>
  );
}
