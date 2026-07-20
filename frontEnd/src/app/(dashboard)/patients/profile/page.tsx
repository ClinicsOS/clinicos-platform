"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import DepthIcon from "@/components/DepthIcon";
import FloatingPlus from "@/components/FloatingPlus";
import { paidOf, type Appointment, type Invoice } from "@/lib/types";
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
} from "@tabler/icons-react";

const pillClass: Record<string, string> = {
  scheduled: "bg-blue/15 text-sky",
  confirmed: "bg-teal/15 text-teal",
  completed: "bg-teal/15 text-teal",
  cancelled: "bg-red-500/15 text-red-400",
  no_show: "bg-amber-500/15 text-amber-400",
};

export default function PatientProfilePage() {
  const { t } = useI18n();
  const patient = useSelectedPatient((s) => s.selected);

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

  const stats = [
    { icon: <IconStethoscope size={15} />, v: visits.length, l: t("pp.visits"), d: 0 },
    { icon: <IconUserX size={15} />, v: noShows, l: t("pp.noshows"), d: 0.7 },
    { icon: <IconCoin size={15} />, v: `${totalPaid} JD`, l: t("pp.paid"), d: 1.4 },
    { icon: <IconHeart size={15} />, v: since, l: t("pp.since"), d: 2.1 },
  ];

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
          <h1 className="flex flex-wrap items-center gap-2 text-base font-medium text-[#F2F7FC]">
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
            {patient.medicalNotes && (
              <span className="pill border border-amber-500/40 bg-amber-500/15 text-amber-300">⚠ {patient.medicalNotes.slice(0, 50)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
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
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink"><IconId size={14} className="text-blue" /> {t("pp.details")}</h2>
            {[
              [t("pp.dob"), patient.birthDate ? new Date(patient.birthDate).toLocaleDateString() : "—"],
              [t("pp.city"), patient.phone],
              [t("pp.opened"), new Date(patient.createdAt).toLocaleDateString()],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between border-b border-edge py-1.5 text-[11px] last:border-0">
                <span className="text-mute">{l}</span>
                <span className="font-medium text-ink" dir="ltr">{v}</span>
              </div>
            ))}
          </div>

          {/* Medical alerts */}
          {patient.medicalNotes && (
            <div className="card mt-3 p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
                <IconAlertTriangle size={14} className="text-amber-500" /> {t("pp.alerts")}
              </h2>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-500">
                {patient.medicalNotes}
              </div>
            </div>
          )}

          {/* Floating balance card — bobs in 3D like the prototype */}
          <div className="bob mt-3 rounded-xl border border-sky/40 bg-hero p-3.5">
            <div className="text-[8px] tracking-widest text-[#7FA3BE]">{t("pp.balance")}</div>
            <div className="mt-0.5 text-lg font-medium text-[#F2F7FC]">{balance.toFixed(2)} JD</div>
            <Link href="/invoices" className="btn-teal mt-2 !px-3 !py-1.5 text-[10px]">{t("pp.pay")}</Link>
          </div>
        </div>

        {/* ===== Visit timeline with spinning cube nodes ===== */}
        <div className="card p-4">
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
                        {new Date(v.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
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
  );
}
