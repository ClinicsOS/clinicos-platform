"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconCalendarEvent, IconClipboardCheck, IconClock, IconReceipt, IconRefresh, IconSearch, IconStethoscope, IconUserPlus } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import type { Patient } from "@/lib/types";
import { useDermDashboard } from "@/lib/derm/treatmentHooks";
import type { DashItemBrief } from "@/lib/derm/treatmentTypes";
import { RecordTypeBadge, fmtDate } from "./dermUi";
import AddToInvoiceModal from "./treatment/AddToInvoiceModal";
import { PriorityPill, StatusPill, money, useProcLabel } from "./treatment/shared";
import { regionLabel } from "@/lib/derm/regions";

/**
 * The Dermatology & Aesthetics operational dashboard (a cockpit, not BI): Today, Treatment Overview, Active Treatments,
 * Needs Billing, Follow-Ups, Recent Activity, Quick Actions. Rendered only for clinic.specialty === "dermatology_aesthetics"
 * (the caller checks) and read from ONE summary endpoint — it owns nothing, and it never imports the 3D engine.
 * Dermatology and Aesthetic stay distinguishable by a subtle badge, not by splitting the page in two.
 */
export default function DermDashboard() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const select = useSelectedPatient((s) => s.select);
  const procLabel = useProcLabel();
  const q = useDermDashboard();
  const [billing, setBilling] = useState<DashItemBrief | null>(null);

  // The dashboard only has an id + name per patient (kept light on purpose); the profile page loads the real record.
  const openPatient = (id: string, name: string | null) => { select({ _id: id, fullName: name ?? "" } as Patient); router.push("/patients/profile"); };
  const targetOf = (i: { targetType: string; regionIds: string[]; generalArea?: string }) => {
    if (i.targetType === "general" || i.regionIds.length === 0) return i.generalArea ? `${t("dt.target.general")} · ${t(`dm.group.${i.generalArea}`)}` : t("dt.target.general");
    const names = i.regionIds.slice(0, 2).map((r) => regionLabel(r, lang));
    return names.join(", ") + (i.regionIds.length > 2 ? ` +${i.regionIds.length - 2}` : "");
  };

  if (q.isError) {
    return (
      <div className="card mb-3 flex flex-col items-center gap-3 p-8 text-center" role="alert">
        <IconAlertTriangle size={20} className="text-amber-400" />
        <div className="text-sm text-ink">{t("dt.err.load")}</div>
        <button type="button" className="btn-ghost text-xs" onClick={() => q.refetch()}><IconRefresh size={13} /> {t("dm.retry")}</button>
      </div>
    );
  }
  if (q.isLoading || !q.data) return <div className="mb-4 space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="card h-24 animate-pulse" />)}</div>;
  const d = q.data;
  const ov = d.treatmentOverview;

  return (
    <div className="mb-4 space-y-3">
      <h1 className="text-lg font-medium text-ink">{t("dt.dash.title")}</h1>

      {/* ---- Today (counts of the EXISTING appointments; walk-ins included) ---- */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium text-ink">{t("dt.dash.today")}</h2>
          <Link href="/appointments" className="text-[10px] text-blue hover:underline">{t("dt.dash.viewAll")} →</Link>
        </div>
        {d.today.total === 0 ? (
          <div className="flex items-center gap-2 py-2 text-[11px] text-mute"><IconCalendarEvent size={16} />{t("dt.dash.noAppts")}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["scheduled", d.today.scheduled], ["confirmed", d.today.confirmed], ["walkIns", d.today.walkIns], ["completed", d.today.completed]] as const).map(([k, n]) => (
              <div key={k} className="rounded-lg border border-edge bg-card2 px-3 py-2">
                <div className="text-lg font-medium text-ink">{n}</div>
                <div className="text-[10px] text-mute">{t(`dt.dash.t.${k}`)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Treatment Overview (plan items — never sessions) ---- */}
      <div className="grid grid-cols-3 gap-3">
        {([["planned", ov.planned, "planned"], ["inProgress", ov.inProgress, "in_progress"], ["completed", ov.completed, "completed"]] as const).map(([k, n, s]) => (
          <div key={k} className="card p-3">
            <div className="text-xl font-medium text-ink">{n}</div>
            <div className="mt-0.5 text-[9px] tracking-widest text-mute">{t(`dt.status.${s}`)}</div>
            <div className="mt-1 flex gap-2 text-[9px] text-mute"><span>{t("dm.type.dermatology")} {ov.dermatology[k]}</span><span>{t("dm.type.aesthetic")} {ov.aesthetic[k]}</span></div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ---- Active Treatments ---- */}
        <div className="card p-4">
          <h2 className="mb-3 text-xs font-medium text-ink">{t("dt.dash.active")}</h2>
          {d.activeTreatments.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-[11px] text-mute"><IconStethoscope size={16} />{t("dt.dash.noActive")}</div>
          ) : (
            <div className="space-y-1.5">
              {d.activeTreatments.map((i) => (
                <div key={i._id} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-card2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-ink">{i.patientName ?? "—"}</span>
                      <RecordTypeBadge type={i.recordType} /><StatusPill status={i.status} /><PriorityPill priority={i.priority} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-mute">{procLabel(i.procedureCode)} — {targetOf(i)}{i.sessionCount > 0 ? ` · ${t("dt.dash.sessionsN").replace("{n}", String(i.sessionCount))}` : ""}</div>
                  </div>
                  <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 text-[10px]" onClick={() => openPatient(i.patientId, i.patientName)}>{t("dt.dash.openPatient")}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- Needs Billing: completed, not yet on an invoice. It does NOT mean the patient owes anything. ---- */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium text-ink">{t("dt.billing.needs")}{d.needsBilling.count > 0 ? ` (${d.needsBilling.count}${d.needsBilling.capped ? "+" : ""})` : ""}</h2>
          </div>
          <p className="mb-2 text-[10px] text-mute">{t("dt.billing.needsTip")}</p>
          {d.needsBilling.items.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-[11px] text-mute"><IconReceipt size={16} />{t("dt.dash.noNeedsBilling")}</div>
          ) : (
            <div className="space-y-1.5">
              {d.needsBilling.items.map((i) => (
                <div key={i._id} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-card2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="truncate text-[12px] font-medium text-ink">{i.patientName ?? "—"}</span><RecordTypeBadge type={i.recordType} /></div>
                    <div className="mt-0.5 text-[10px] text-mute">{procLabel(i.procedureCode)} — {targetOf(i)}{i.estimatedPrice != null && <span dir="ltr"> · {t("dt.estimate")} {money(i.estimatedPrice)}</span>}</div>
                  </div>
                  <button type="button" className="btn-teal shrink-0 !px-2.5 !py-1 text-[10px]" onClick={() => setBilling(i)}>{t("dt.inv.add")}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ---- Follow-Ups: review dates the clinician chose ---- */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium text-ink">{t("dt.dash.followUps")}</h2>
            <div className="flex gap-2 text-[10px]">
              {d.followUps.overdue > 0 && <span className="pill bg-red-500/15 text-red-400">{t("dt.dash.overdue").replace("{n}", String(d.followUps.overdue))}</span>}
              {d.followUps.dueSoon > 0 && <span className="pill bg-soft text-blue">{t("dt.dash.dueSoon").replace("{n}", String(d.followUps.dueSoon))}</span>}
            </div>
          </div>
          {d.followUps.items.length === 0 ? (
            <p className="py-2 text-[11px] text-mute">{t("dt.dash.noFollowUps")}</p>
          ) : (
            <div className="space-y-1.5">
              {d.followUps.items.map((f) => (
                <div key={f.sessionId} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-card2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="truncate text-[12px] font-medium text-ink">{f.patientName ?? "—"}</span><RecordTypeBadge type={f.recordType} /></div>
                    <div className={`mt-0.5 text-[10px] ${f.overdue ? "text-red-400" : "text-mute"}`}>{procLabel(f.procedureCode)} · {fmtDate(f.dueAt, lang)}</div>
                  </div>
                  <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 text-[10px]" onClick={() => openPatient(f.patientId, f.patientName)}>{t("dt.dash.openPatient")}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- Recent Activity ---- */}
        <div className="card p-4">
          <h2 className="mb-3 text-xs font-medium text-ink">{t("dt.dash.recent")}</h2>
          {d.recentActivity.length === 0 ? <p className="py-4 text-center text-[11px] text-mute">{t("dt.dash.noRecent")}</p> : (
            <div className="space-y-1.5">
              {d.recentActivity.map((e, idx) => (
                <div key={idx} className="flex items-start gap-2 text-[11px]">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                  <div className="min-w-0 flex-1">
                    <span className="text-ink">{e.kind === "treatment" && e.status ? t(`dt.dash.h.treatment.${e.status}`) : t(`dt.dash.h.${e.kind}`)}{e.kind === "session" && e.sessionNumber ? ` ${e.sessionNumber}` : ""}</span>{" "}
                    <span className="text-mute">{e.patientName ?? "—"}{e.procedureCode ? ` — ${procLabel(e.procedureCode)}` : ""}</span>
                  </div>
                  <span className="shrink-0 text-[9px] text-mute" dir="ltr">{fmtDate(e.at, lang)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- Quick Actions ---- */}
      <div className="card p-4">
        <h2 className="mb-3 text-xs font-medium text-ink">{t("dt.dash.quick")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickAction icon={<IconUserPlus size={16} />} label={t("dt.dash.qa.walkin")} href="/appointments" />
          <QuickAction icon={<IconSearch size={16} />} label={t("dt.dash.qa.find")} href="/patients" />
          <QuickAction icon={<IconClipboardCheck size={16} />} label={t("dt.dash.qa.plan")} href="/patients" />
          <QuickAction icon={<IconClock size={16} />} label={t("dt.dash.qa.today")} href="/appointments" />
        </div>
      </div>

      {billing && <AddToInvoiceModal patientId={billing.patientId} item={{ _id: billing._id, procedureCode: billing.procedureCode, targetType: billing.targetType, regions: billing.regionIds.map((id) => ({ id })), generalArea: billing.generalArea, estimatedPrice: billing.estimatedPrice }} onClose={() => setBilling(null)} />}
    </div>
  );
}

function QuickAction({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg border border-edge bg-card2 px-3 py-2.5 text-[11px] font-medium text-ink transition-colors hover:border-sky/50 hover:text-sky">{icon} {label}</Link>
  );
}
