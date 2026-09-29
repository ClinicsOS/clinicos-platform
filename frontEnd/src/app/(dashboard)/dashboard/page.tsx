"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/lib/i18n";
import { todayLocal } from "@/lib/dates";
import DepthIcon from "@/components/DepthIcon";
import dynamic from "next/dynamic";
import type { Stats, Appointment, Patient, Clinic } from "@/lib/types";
import {
  IconCalendarEvent,
  IconCircleCheck,
  IconCoin,
  IconUserX,
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

export default function DashboardPage() {
  const { t } = useI18n();
  const user = useAuth((s) => s.user);

  // Same query key the layout/appointments pages already use for the clinic — react-query dedupes it, so this
  // adds no extra request. specialty decides whether the Dentistry cockpit renders; nothing else here changes it.
  const { data: clinic } = useQuery({ queryKey: ["clinic"], queryFn: async () => (await api.get<Clinic>("/clinic")).data });
  const isDental = clinic?.specialty === "dentistry";

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: async () => (await api.get<Stats>("/dashboard/stats")).data,
    refetchInterval: 60_000,
  });

  const { data: today, isLoading: todayLoading } = useQuery({
    queryKey: ["appointments", todayLocal()],
    queryFn: async () =>
      (await api.get<Appointment[]>(`/appointments?date=${todayLocal()}`)).data,
    refetchInterval: 60_000,
  });

  const maxWeek = Math.max(1, ...(stats?.week.map((w) => w.count) ?? [1]));

  const cards = [
    { icon: <IconCalendarEvent size={16} />, v: stats?.today.total ?? "—", l: t("dash.visits"), d: 0 },
    { icon: <IconCircleCheck size={16} />, v: stats?.today.completed ?? "—", l: t("dash.completed"), d: 0.8 },
    { icon: <IconCoin size={16} />, v: stats ? `${stats.today.revenue.toFixed(2)} JD` : "—", l: t("dash.revenue"), d: 1.6 },
    { icon: <IconUserX size={16} />, v: stats?.today.noShow ?? "—", l: t("dash.noshow"), d: 2.4 },
  ];

  return (
    <div>
      {isDental && <DentalDashboard />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-ink">
            {t("dash.morning")}, {user?.name?.split(" ")[0]}
          </h1>
          <p className="mt-0.5 text-xs text-mute">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <Link href="/appointments" className="btn-teal !py-2 text-xs">
          <IconPlus size={15} /> {t("dash.new")}
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.l} className="card p-3.5">
            <div className="mb-5"><DepthIcon delay={c.d}>{c.icon}</DepthIcon></div>
            <div className="text-xl font-medium text-ink">{c.v}</div>
            <div className="mt-0.5 text-[9px] tracking-widest text-mute">{c.l}</div>
          </div>
        ))}
      </div>

      <div className={`mt-3 grid gap-3 ${isDental ? "" : "lg:grid-cols-2"}`}>
        {/* Week chart — pure CSS bars, same as the prototype */}
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
                {new Date(w.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}
              </span>
            ))}
          </div>
        </div>

        {/* Today's schedule — superseded by the Dentistry cockpit's own Today section above (same appointment data, plus treatment context), so it's hidden there instead of showing the same list twice. */}
        {!isDental && <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium text-ink">{t("dash.today")}</h2>
            <Link href="/appointments" className="text-[10px] text-blue hover:underline">{t("ap.title")} →</Link>
          </div>
          {!todayLoading && !today?.length && (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-ink">{t("empty.noAppointments.title")}</p>
              <p className="mx-auto mt-1 max-w-xs text-[10px] leading-relaxed text-mute">
                {t("empty.noAppointments.body")}
              </p>
            </div>
          )}
          {today?.slice(0, 6).map((a) => {
            const p = a.patientId as Patient;
            const d = a.doctorId as { name?: string };
            const isPending = a.source === "public" && a.status === "scheduled";
            return (
              <div key={a._id} className="flex items-center gap-2.5 border-b border-edge py-2 last:border-0">
                <span className="w-10 font-mono text-[10px] text-mute">
                  {new Date(a.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}
                </span>
                <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-soft text-[9px] font-medium text-blue">
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
                  <span className="text-[9px] text-mute">{d?.name}</span>
                </span>
                <span className={`pill ${pillClass[a.status] ?? "bg-soft text-mute"}`}>{t(`status.${a.status}`)}</span>
              </div>
            );
          })}
        </div>}
      </div>
    </div>
  );
}
