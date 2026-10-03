"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconAlertTriangle, IconCalendarEvent, IconClipboardCheck, IconClock, IconReceipt, IconRefresh,
  IconSearch, IconStethoscope, IconUserPlus,
} from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import type { Patient } from "@/lib/types";
import { useDentalDashboard } from "@/lib/dental/hooks";
import AddToInvoiceModal, { type BillableTreatment } from "./AddToInvoiceModal";
import { PriorityPill, StatusPill, TargetText, money, shortDate } from "./shared";
import { procLabel } from "@/lib/dental/procedures";

/**
 * The Dentistry operational dashboard ("cockpit", not BI): Today, Treatment Overview, Active Treatments,
 * Needs Billing, Recent Activity, Quick Actions. Rendered only for clinic.specialty === "dentistry" (the caller
 * checks that), and reads from ONE summary endpoint — it owns nothing (Appointment/Invoice/Treatment stay
 * authoritative). No 3D bundle is loaded here; that lives only in the Dental Chart.
 */
export default function DentalDashboard() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const select = useSelectedPatient((s) => s.select);
  const q = useDentalDashboard();
  const [billing, setBilling] = useState<{ item: BillableTreatment; patientId: string } | null>(null);

  // The dashboard only has an id + name for each patient (kept light on purpose); this placeholder is
  // immediately replaced by the real fetch on the profile page, exactly like clicking a patient in Patients does.
  const openPatient = (id: string, name: string | null) => { select({ _id: id, fullName: name ?? "" } as Patient); router.push("/patients/profile"); };
  const openVisit = (appointmentId: string) => router.push(`/appointments?appt=${appointmentId}`);

  if (q.isError) {
    return (
      <div className="card mb-3 flex flex-col items-center gap-3 p-8 text-center" role="alert">
        <IconAlertTriangle size={20} className="text-amber-400" />
        <div className="text-sm text-ink">{t("dn.err.plan.load")}</div>
        <button type="button" className="btn-ghost text-xs" onClick={() => q.refetch()}><IconRefresh size={13} /> {t("dn.retry")}</button>
      </div>
    );
  }
  if (q.isLoading || !q.data) return <DashboardSkeleton />;
  const d = q.data;

  return (
    <div className="mb-4 space-y-3">
      <h1 className="text-lg font-medium text-ink">{t("dn.dash.title")}</h1>

      {/* ---- Today ---- */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium text-ink">{t("dn.dash.today")}</h2>
          <div className="flex items-center gap-2 text-[10px] text-mute">
            <span>{d.today.counts.total}</span>
            {d.today.counts.walkIns > 0 && <span className="pill bg-soft text-blue">{d.today.counts.walkIns} {t("dn.dash.walkin")}</span>}
            <Link href="/appointments" className="text-blue hover:underline">{t("dn.dash.viewAll")} →</Link>
          </div>
        </div>
        {d.today.appointments.length === 0 ? (
          <Empty icon={<IconCalendarEvent size={18} />} title={t("dn.dash.noAppts")} body={t("dn.dash.noApptsBody")} />
        ) : (
          <div className="space-y-1.5">
            {d.today.appointments.slice(0, 8).map((a) => (
              <div key={a._id} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-card2 px-2.5 py-2">
                <span className="w-14 shrink-0 font-mono text-[10px] text-mute" dir="ltr">{new Date(a.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium text-ink">{a.patientName ?? "—"}</span>
                    {a.source === "walk_in" && <span className="pill shrink-0 bg-soft text-blue">{t("dn.dash.walkin")}</span>}
                    <span className={`pill shrink-0 ${a.status === "cancelled" ? "bg-red-500/15 text-red-400" : a.status === "no_show" ? "bg-amber-500/15 text-amber-400" : "bg-teal/15 text-teal"}`}>{t(`status.${a.status}`)}</span>
                  </div>
                  {a.treatment && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mute">
                      {procLabel(t, a.treatment)} — <TargetText targetType={a.treatment.targetType} toothNumbers={a.treatment.toothNumbers} surfaces={[]} />
                      <StatusPill status={a.treatment.status} />
                    </div>
                  )}
                </div>
                <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 text-[10px]" onClick={() => (a.status === "cancelled" || a.status === "no_show" ? undefined : openVisit(a._id))}>
                  {a.status === "scheduled" || a.status === "confirmed" ? t("dn.dash.openVisit") : t("dn.dash.openPatient")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Treatment Overview ---- */}
      <div className="grid grid-cols-3 gap-3">
        {(["planned", "inProgress", "completed"] as const).map((k) => (
          <Link key={k} href="/patients" className="card p-3 transition-colors hover:border-sky/40">
            <div className="text-xl font-medium text-ink">{d.treatmentOverview[k]}</div>
            <div className="mt-0.5 text-[9px] tracking-widest text-mute">{t(`dn.ps.${k === "inProgress" ? "in_progress" : k}`)}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ---- Active Treatments ---- */}
        <div className="card p-4">
          <h2 className="mb-3 text-xs font-medium text-ink">{t("dn.dash.active")}</h2>
          {d.activeTreatments.length === 0 ? (
            <Empty icon={<IconStethoscope size={18} />} title={t("dn.dash.noActive")} body={t("dn.dash.noActiveBody")} />
          ) : (
            <div className="space-y-1.5">
              {d.activeTreatments.map((i) => (
                <div key={i._id} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-card2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-ink">{i.patientName ?? "—"}</span>
                      <StatusPill status={i.status} />
                      <PriorityPill priority={i.priority} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mute">
                      {procLabel(t, i)} — <TargetText targetType={i.targetType} toothNumbers={i.toothNumbers} surfaces={i.surfaces} />
                      {i.sessionCount > 0 && <span>· {i.sessionCount === 1 ? t("dn.dash.session1") : `${i.sessionCount} ${t("dn.dash.sessions")}`}</span>}
                    </div>
                  </div>
                  <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 text-[10px]" onClick={() => openPatient(i.patientId, i.patientName)}>{t("dn.dash.openPatient")}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- Needs Billing ---- */}
        <div className="card p-4">
          <h2 className="mb-3 text-xs font-medium text-ink">{t("dn.dash.needsBilling")}</h2>
          {d.needsBilling.length === 0 ? (
            <Empty icon={<IconReceipt size={18} />} title={t("dn.dash.noNeedsBilling")} body={t("dn.dash.noNeedsBillingBody")} />
          ) : (
            <div className="space-y-1.5">
              {d.needsBilling.map((i) => (
                <div key={i._id} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-card2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-[12px] font-medium text-ink">{i.patientName ?? "—"}</span>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mute">
                      {procLabel(t, i)} — <TargetText targetType={i.targetType} toothNumbers={i.toothNumbers} surfaces={i.surfaces} />
                      {i.estimatedPrice != null && <span dir="ltr">· {money(i.estimatedPrice)}</span>}
                    </div>
                  </div>
                  <button type="button" className="btn-teal shrink-0 !px-2.5 !py-1 text-[10px]" onClick={() => setBilling({ item: { _id: i._id, procedureCode: i.procedureCode, customName: i.customName, targetType: i.targetType, toothNumbers: i.toothNumbers, surfaces: i.surfaces, estimatedPrice: i.estimatedPrice }, patientId: i.patientId })}>
                    {t("dn.inv.add")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        {/* ---- Recent Activity ---- */}
        <div className="card p-4">
          <h2 className="mb-3 text-xs font-medium text-ink">{t("dn.dash.recent")}</h2>
          {d.recentActivity.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-mute">{t("dn.dash.noRecent")}</p>
          ) : (
            <div className="space-y-1.5">
              {d.recentActivity.map((e, idx) => (
                <div key={idx} className="flex items-start gap-2 text-[11px]">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                  <div className="min-w-0 flex-1">
                    <span className="text-ink">{t(`dn.dash.h.${e.kind}`)}</span>{" "}
                    <span className="text-mute">
                      {e.patientName} — {e.procedureCode && procLabel(t, { procedureCode: e.procedureCode, customName: e.customName })}
                      {e.toothNumbers && e.toothNumbers.length > 0 && e.targetType !== "general" && <> — <TargetText targetType={e.targetType ?? "tooth"} toothNumbers={e.toothNumbers} surfaces={[]} /></>}
                      {e.invoiceNumber != null && <> · <span dir="ltr">INV-{String(e.invoiceNumber).padStart(4, "0")}{typeof e.amount === "number" ? ` · ${money(e.amount)}` : ""}</span></>}
                    </span>
                  </div>
                  <span className="shrink-0 text-[9px] text-mute" dir="ltr">{shortDate(e.at, lang)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- Quick Actions ---- */}
        <div className="card p-4">
          <h2 className="mb-3 text-xs font-medium text-ink">{t("dn.dash.quick")}</h2>
          <div className="grid grid-cols-2 gap-2">
            <QuickAction icon={<IconUserPlus size={16} />} label={t("dn.dash.qa.walkin")} href="/appointments" />
            <QuickAction icon={<IconSearch size={16} />} label={t("dn.dash.qa.find")} href="/patients" />
            <QuickAction icon={<IconClipboardCheck size={16} />} label={t("dn.dash.qa.plan")} href="/patients" />
            <QuickAction icon={<IconClock size={16} />} label={t("dn.dash.qa.today")} href="/appointments" />
          </div>
        </div>
      </div>

      {billing && <AddToInvoiceModal patientId={billing.patientId} item={billing.item} onClose={() => setBilling(null)} />}
    </div>
  );
}

function QuickAction({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg border border-edge bg-card2 px-3 py-2.5 text-[11px] font-medium text-ink transition-colors hover:border-sky/50 hover:text-sky">
      {icon} {label}
    </Link>
  );
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center">
      <span className="text-mute/60">{icon}</span>
      <p className="text-[12px] font-medium text-ink">{title}</p>
      <p className="max-w-xs text-[10px] leading-relaxed text-mute">{body}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mb-4 space-y-3" aria-busy="true">
      <div className="h-5 w-40 animate-pulse rounded bg-soft" />
      <div className="card h-40 animate-pulse p-4" />
      <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="card h-16 animate-pulse p-3" />)}</div>
      <div className="grid gap-3 lg:grid-cols-2">{[0, 1].map((i) => <div key={i} className="card h-32 animate-pulse p-4" />)}</div>
    </div>
  );
}
