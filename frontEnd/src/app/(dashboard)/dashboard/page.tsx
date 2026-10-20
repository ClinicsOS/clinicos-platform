"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/lib/i18n";
import { useAccess, useClinicDoctors } from "@/lib/access";
import { useState } from "react";
import { todayLocal } from "@/lib/dates";
import DepthIcon from "@/components/DepthIcon";
import dynamic from "next/dynamic";
import type { Stats, Appointment, Patient, Clinic } from "@/lib/types";
import {
  IconCalendarEvent,
  IconCircleCheck,
  IconCoin,
  IconUserX,
  IconUserPlus,
  IconPlus,
} from "@tabler/icons-react";

const pillClass: Record<string, string> = {
  scheduled: "bg-blue/15 text-sky",
  confirmed: "bg-teal/15 text-teal",
  completed: "bg-teal/15 text-teal",
  cancelled: "bg-red-500/15 text-red-400",
  no_show: "bg-amber-500/15 text-amber-400",
};

// Dentistry-only cockpit (Today/Treatment Overview/Active/Needs Billing/Recent Activity/Quick Actions). Loaded on
// demand so a non-dentistry clinic's dashboard bundle and requests are completely unaffected.
const DentalDashboard = dynamic(() => import("@/components/dental/treatment/DentalDashboard"), { ssr: false });
// Dermatology & Aesthetics cockpit — same on-demand rule (2D only: it never imports the 3D engine).
const DermDashboard = dynamic(() => import("@/components/derm/DermDashboard"), { ssr: false });

/**
 * Today's schedule — the SAME card the dashboard always had (time, avatar, name, doctor, status, "pending online booking" dot), now a
 * component so a doctor / receptionist can have it FIRST on the page. It only renders the list the page already fetched (no extra request).
 * Added in the polish pass: a Walk-In pill, and a highlight on the next appointment that has not finished yet.
 */
function TodaySchedule({ today, loading, limit }: { today: Appointment[] | undefined; loading: boolean; limit: number }) {
  const { t } = useI18n();
  const now = Date.now();
  const rows = [...(today ?? [])].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const nextId = rows.find((a) => (a.status === "scheduled" || a.status === "confirmed") && +new Date(a.startAt) + (a.duration || 0) * 60_000 > now)?._id;
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium text-ink">{t("dash.today")}</h2>
        <Link href="/appointments" className="text-[10px] text-blue hover:underline">{t("ap.title")} →</Link>
      </div>
      {!loading && !rows.length && (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-ink">{t("empty.noAppointments.title")}</p>
          <p className="mx-auto mt-1 max-w-xs text-[10px] leading-relaxed text-mute">
            {t("empty.noAppointments.body")}
          </p>
        </div>
      )}
      {rows.slice(0, limit).map((a) => {
        const p = a.patientId as Patient;
        const d = a.doctorId as { name?: string };
        const isPending = a.source === "public" && a.status === "scheduled";
        return (
          <div key={a._id} className={`flex items-center gap-2.5 border-b border-edge py-2 last:border-0 ${a._id === nextId ? "-mx-2 rounded-lg bg-soft/60 px-2" : ""}`}>
            <span className="w-14 shrink-0 font-mono text-[10px] text-mute" dir="ltr">
              {new Date(a.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Amman" })}
            </span>
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-soft text-[9px] font-medium text-blue">
              {(p?.fullName || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}
              {isPending && (
                <span className="absolute -end-0.5 -top-0.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-ink">{p?.fullName}</span>
              <span className="block truncate text-[9px] text-mute">{d?.name}</span>
            </span>
            {a.source === "walk_in" && <span className="pill shrink-0 bg-soft text-blue">{t("dn.dash.walkin")}</span>}
            <span className={`pill shrink-0 ${pillClass[a.status] ?? "bg-soft text-mute"}`}>{t(`status.${a.status}`)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const user = useAuth((s) => s.user);

  // Same query key the layout/appointments pages already use for the clinic — react-query dedupes it, so this
  // adds no extra request. specialty decides whether the Dentistry cockpit renders; nothing else here changes it.
  const { data: clinic } = useQuery({ queryKey: ["clinic"], queryFn: async () => (await api.get<Clinic>("/clinic")).data });
  const isDental = clinic?.specialty === "dentistry";
  const isDerm = clinic?.specialty === "dermatology_aesthetics";

  // PHASE 4 — the owner can narrow the cards to one doctor; a doctor is always scoped to themselves by the server (no choice here),
  // and a receptionist's response simply carries revenue: null, so no money card is ever rendered for them.
  const access = useAccess();
  const [docFilter, setDocFilter] = useState("all");
  const { doctors } = useClinicDoctors(access.isOwner);
  const statsDoctor = access.isOwner && docFilter !== "all" ? docFilter : "";
  const { data: stats } = useQuery({
    queryKey: ["stats", statsDoctor],
    queryFn: async () =>
      (await api.get<Stats>("/dashboard/stats", { params: statsDoctor ? { doctorId: statsDoctor } : undefined })).data,
    refetchInterval: 60_000,
  });

  const { data: today, isLoading: todayLoading } = useQuery({
    queryKey: ["appointments", todayLocal()],
    queryFn: async () =>
      (await api.get<Appointment[]>(`/appointments?date=${todayLocal()}`)).data,
    refetchInterval: 60_000,
  });

  const maxWeek = Math.max(1, ...(stats?.week.map((w) => w.count) ?? [1]));

  // PHASE 6 — EVERY role opens ClinicOS on what must be DONE today: greeting → date / clinic → Today's appointments → key KPIs → the rest.
  // (Doctor / receptionist already had this order; the owner used to get the specialty cockpit first and the greeting at the very bottom.)
  // Role scope is untouched: the KPI cards still come from the SERVER's role-scoped /dashboard/stats (receptionist: revenue null → no money card).
  // The money card exists only for a role the SERVER gave a figure to (receptionist: revenue === null AND no dashboardRevenue access → no card, no placeholder).
  const showRevenue = !(stats?.today.revenue === null || (stats && !access.can("dashboardRevenue")));
  // Receptionist: the slot the revenue card used to occupy is an operational one — today's Walk-Ins, counted from the list this page already fetched.
  const walkIns = (today ?? []).filter((a) => a.source === "walk_in" && a.status !== "cancelled").length;

  const cards = [
    { icon: <IconCalendarEvent size={16} />, v: stats?.today.total ?? "—", l: t("dash.visits"), d: 0 },
    ...(access.isReceptionist
      ? [{ icon: <IconUserPlus size={16} />, v: today ? walkIns : "—", l: t("dash.walkins"), d: 0.5 }]
      : []),
    { icon: <IconCircleCheck size={16} />, v: stats?.today.completed ?? "—", l: t("dash.completed"), d: 0.8 },
    // Money card only when the server actually returned a figure (null = this role may not see revenue).
    ...(!showRevenue
      ? []
      : [{ icon: <IconCoin size={16} />, v: stats && stats.today.revenue != null ? `${stats.today.revenue.toFixed(2)} JD` : "—", l: access.isDoctor ? t("md.dash.myRevenue") : t("dash.revenue"), d: 1.6 }]),
    { icon: <IconUserX size={16} />, v: stats?.today.noShow ?? "—", l: t("dash.noshow"), d: 2.4 },
  ];

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3" data-testid="dash-header">
      <div>
        <h1 className="text-lg font-medium text-ink" data-testid="dash-greeting">
          {t("dash.morning")}{lang === "ar" ? "،" : ","} {user?.name?.split(" ")[0]}
        </h1>
        <p className="mt-0.5 text-xs text-mute" data-testid="dash-date">
          {new Date().toLocaleDateString(lang === "ar" ? "ar-JO" : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Amman" })}
          {clinic?.name ? <span> · {clinic.name}</span> : null}
        </p>
      </div>
      <Link href="/appointments" className="btn-teal !py-2 text-xs">
        <IconPlus size={15} /> {t("dash.new")}
      </Link>
    </div>
  );

  const kpis = (
    <div className={`grid grid-cols-2 gap-3 ${cards.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
      {cards.map((c) => (
        <div key={c.l} className="card p-3.5">
          <div className="mb-5"><DepthIcon delay={c.d}>{c.icon}</DepthIcon></div>
          <div className="text-xl font-medium text-ink">{c.v}</div>
          <div className="mt-0.5 text-[9px] tracking-widest text-mute">{c.l}</div>
        </div>
      ))}
    </div>
  );

  // Week chart — pure CSS bars, same as the prototype
  const weekChart = (
    <div className="card p-4">
      <h2 className="mb-4 text-xs font-medium text-ink">{t("dash.week")}</h2>
      <div className="flex h-28 items-end gap-2 border-b border-edge px-1" dir="ltr">
        {(stats?.week ?? Array.from({ length: 7 }, (_, i) => ({ date: `${i}`, count: 0 }))).map((w, i) => (
          <div key={w.date} className="flex h-full flex-1 flex-col items-center justify-end">
            <div
              className={`grow-bar w-full origin-bottom rounded-t ${i % 2 ? "bg-teal" : "bg-blue"}`}
              style={{ height: `${Math.max(4, (w.count / maxWeek) * 100)}%`, animationDelay: `${i * 0.08}s` }}
              title={`${w.count}`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 px-1 pt-1.5" dir="ltr">
        {(stats?.week ?? []).map((w) => (
          <span key={w.date} className="flex-1 text-center text-[8px] text-mute">
            {new Date(w.date + "T00:00:00").toLocaleDateString(lang === "ar" ? "ar-JO" : "en-US", { weekday: "short" })}
          </span>
        ))}
      </div>
    </div>
  );

  const ownerFilter = access.isOwner && doctors.length > 1 && (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <label className="text-[10px] tracking-widest text-mute" htmlFor="dash-doc">{t("md.filter.doctor")}</label>
      <select id="dash-doc" className="inp !w-auto !py-1.5 text-xs" value={docFilter} onChange={(e) => setDocFilter(e.target.value)}>
        <option value="all">{t("md.filter.all")}</option>
        {doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
      </select>
    </div>
  );

  // ===== ALL ROLES: greeting → date/clinic → Today's appointments → KPI cards → Bookings this week → the rest of the specialty cockpit =====
  return (
    <div>
      {header}
      {access.isDoctor && <div className="mb-2 text-[10px] text-mute">{t("md.scope.self")}</div>}
      {/* Owner only: narrow every card to one doctor (the server ignores/forbids this for other roles) */}
      {ownerFilter}
      {/* 3. Today's appointments — a Dentistry clinic's own Today section IS its schedule (same data + treatment context), so it isn't shown twice.
             Both read data the page/hook already fetches: no extra request. */}
      <div className="mb-3" data-testid="dash-today">
        {isDental ? <DentalDashboard part="today" /> : <TodaySchedule today={today} loading={todayLoading} limit={8} />}
      </div>
      {/* 4. Key operational KPIs */}
      {kpis}
      {/* 5. Bookings this week */}
      <div className="mt-3">{weekChart}</div>
      {/* 6. Everything else (specialty cockpit sections) */}
      {(isDental || isDerm) && (
        <div className="mt-3">
          {isDental && <DentalDashboard part="rest" />}
          {isDerm && <DermDashboard />}
        </div>
      )}
    </div>
  );
}
