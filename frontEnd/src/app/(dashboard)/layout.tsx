"use client";
import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import Cube3D from "@/components/Cube3D";
import type { Clinic, Appointment } from "@/lib/types";
import NotificationBell from "@/components/NotificationBell";
import DigitalClock from "@/components/DigitalClock";
import {
  IconLayoutDashboard,
  IconCalendar,
  IconUsers,
  IconReceipt,
  IconSettings,
  IconLogout,
  IconSun,
  IconMoon,
  IconAlertTriangle,
  IconArrowRight,
  IconChartBar,
} from "@tabler/icons-react";

const planLabel = (plan: string | undefined, t: (k: string) => string) => {
  if (plan === "trial") return t("sub.trial");
  if (plan === "basic") return t("sub.basic");
  if (plan === "pro") return t("sub.pro");
  return "";
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { token, user, logout } = useAuth();
  const [hydrated, setHydrated] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    if (hydrated && !token) router.replace("/signin");
  }, [hydrated, token, router]);

  const { data: clinic } = useQuery({
    queryKey: ["clinic"],
    queryFn: async () => (await api.get<Clinic>("/clinic")).data,
    enabled: hydrated && !!token,
    refetchInterval: 5_000,
    staleTime: 3_000,
    retry: (failureCount, error: any) => {
      // Don't retry on 402 — subscription expired
      if (error?.response?.status === 402) return false;
      return failureCount < 2;
    },
  });

  // Poll appointments for pending public bookings — every 30s
  const { data: allAppts } = useQuery({
    queryKey: ["appointments-all"],
    queryFn: async () => (await api.get<Appointment[]>("/appointments")).data,
    enabled: hydrated && !!token && clinic?.status === "active",
    refetchInterval: 5_000,
  });

  const pendingCount = (allAppts ?? []).filter(
    (a) =>
      a.source === "public" &&
      a.status === "scheduled" &&
      new Date(a.startAt).getTime() > Date.now()
  ).length;

  if (!hydrated || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hero">
        <Cube3D size={64} />
      </div>
    );
  }

  const nav = [
    { href: "/dashboard", label: t("nav.dashboard"), icon: IconLayoutDashboard },
    { href: "/appointments", label: t("nav.appointments"), icon: IconCalendar },
    { href: "/patients", label: t("nav.patients"), icon: IconUsers },
    { href: "/invoices", label: t("nav.invoices"), icon: IconReceipt },
    ...(clinic?.planInfo?.limits.reports
      ? [{ href: "/reports", label: t("nav.reports"), icon: IconChartBar }]
      : []),
    { href: "/settings", label: t("nav.settings"), icon: IconSettings },
  ];

  const initials = (user?.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const plan = clinic?.planInfo?.plan ?? clinic?.plan;
  const daysLeft = clinic?.planInfo?.daysRemaining ?? null;
  const isExpired = clinic?.status === "expired";
  const showWarning = plan === "trial" && daysLeft !== null && daysLeft <= 3;

  // ===== Expired screen — full-screen renewal call to action =====
  if (isExpired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hero p-6">
        <div className="relative w-full max-w-sm rounded-2xl border border-amber-500/40 bg-[#0B3153]/95 p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
            <IconAlertTriangle size={26} />
          </div>
          <h1 className="text-lg font-medium text-[#F2F7FC]">{t("sub.expiredScreen.title")}</h1>
          <p className="mt-2 text-xs text-[#8FB3CC]">{t("sub.expiredScreen.sub")}</p>
          <Link
            href="/settings?tab=subscription"
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-teal py-2.5 text-sm font-medium text-navy hover:brightness-110"
          >
            {t("sub.renew")} <IconArrowRight size={15} className="rtl-flip" />
          </Link>
          <button
            onClick={() => {
              logout();
              router.replace("/signin");
            }}
            className="mt-3 text-[10px] text-[#7FA3BE] hover:text-sky"
          >
            {t("nav.logout")}
          </button>
        </div>
      </div>
    );
  }

  const bookingLink = origin && clinic ? `${origin}/book/${clinic.slug}` : "";

  return (
    <div className="flex min-h-screen bg-base">
      {/* ===== Sidebar — always navy for brand consistency ===== */}
      <aside className="flex w-52 shrink-0 flex-col p-3" style={{ background: "#06263F" }}>
        <Link
          href="/dashboard"
          className="mb-6 flex items-center gap-2 px-1.5 text-sm font-medium text-[#F2F7FC]"
        >
          <Cube3D size={20} /> ClinicOS
        </Link>

        {nav.map((n) => {
          const active = pathname.startsWith(n.href);
          const showDot = n.href === "/appointments" && pendingCount > 0;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`relative mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${
                active
                  ? "border border-teal/30 bg-teal/15 text-[#7FE3D8]"
                  : "text-[#8FB3CC] hover:bg-sky/10"
              }`}
            >
              <n.icon size={16} /> {n.label}
              {showDot && (
                <span className="ms-auto flex h-2 w-2">
                  <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
              )}
            </Link>
          );
        })}

        {/* Booking link */}
        {clinic && bookingLink && (
          <div className="mt-auto rounded-lg border border-dashed border-sky/40 bg-blue/10 p-2.5" dir="ltr">
            <div className="mb-1 text-[8px] tracking-widest text-[#7FA3BE]">{t("nav.bookingLink")}</div>
            <div className="break-all font-mono text-[9px] text-sky">
              {bookingLink.replace(/^https?:\/\//, "")}
            </div>
          </div>
        )}

        {/* ==== Subscription card — bigger, clearer, with progress bar ==== */}
        {plan && (
          <Link
            href="/settings?tab=subscription"
            className={`mt-3 block rounded-lg border p-3 transition-colors ${
              daysLeft !== null && daysLeft <= 1
                ? "border-red-500/40 bg-red-500/10 hover:bg-red-500/15"
                : daysLeft !== null && daysLeft <= 3
                ? "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15"
                : "border-teal/30 bg-teal/10 hover:bg-teal/15"
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-[#DCEBF7]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    plan === "trial"
                      ? "bg-amber-400"
                      : plan === "basic"
                      ? "bg-sky"
                      : "bg-teal"
                  }`}
                />
                {planLabel(plan, t)}
              </span>
              <span className="text-[8px] uppercase tracking-widest text-[#7FA3BE]">
                {plan === "trial" ? "TRIAL" : plan === "basic" ? "BASIC" : "PRO"}
              </span>
            </div>
            {daysLeft !== null && (
              <>
                <div className="mb-1.5 text-[10px] text-[#B8D4EA]">
                  <span
                    className={`font-medium ${
                      daysLeft <= 1
                        ? "text-red-400"
                        : daysLeft <= 3
                        ? "text-amber-300"
                        : "text-[#DCEBF7]"
                    }`}
                  >
                    {daysLeft}
                  </span>{" "}
                  {daysLeft === 1 ? t("sub.dayLeft") : t("sub.daysLeft")}
                </div>
                {plan === "trial" && (
                  <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#06263F]">
                    <div
                      className={`h-full transition-all ${
                        daysLeft <= 1
                          ? "bg-red-500"
                          : daysLeft <= 3
                          ? "bg-amber-500"
                          : "bg-teal"
                      }`}
                      style={{ width: `${Math.max(5, Math.min(100, (daysLeft / 7) * 100))}%` }}
                    />
                  </div>
                )}
                {(plan === "trial" || daysLeft <= 3) && (
                  <div
                    className={`rounded py-1 text-center text-[9px] font-medium ${
                      daysLeft <= 1
                        ? "bg-red-500 text-white"
                        : daysLeft <= 3
                        ? "bg-amber-500 text-navy"
                        : "bg-teal text-navy"
                    }`}
                  >
                    {t("sub.upgrade")}
                  </div>
                )}
              </>
            )}
          </Link>
        )}

        {/* ==== User row ==== */}
        <div className="mt-2 flex items-center gap-2 px-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal text-[10px] font-medium text-navy">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-[#DCEBF7]">{user?.name}</div>
            <div className="text-[9px] text-[#7FA3BE]">{user?.email}</div>
          </div>
          <button
            onClick={() => {
              logout();
              router.replace("/signin");
            }}
            className="text-[#5E86A5] hover:text-red-400"
            title={t("nav.logout")}
          >
            <IconLogout size={15} />
          </button>
        </div>
      </aside>

      {/* ===== Main ===== */}
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-end gap-2 px-5 pt-4">
          <DigitalClock />
          <NotificationBell appointments={allAppts ?? []} />
          <div className="flex overflow-hidden rounded-lg border border-edge bg-card text-[10px]">
            {(["en", "ar"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2.5 py-1.5 uppercase ${lang === l ? "bg-blue text-white" : "text-mute"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={toggle}
            className="rounded-lg border border-edge bg-card p-1.5 text-mute hover:text-ink"
            title="Theme"
          >
            {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
          </button>
        </header>
        <main className="px-5 pb-8 pt-3">{children}</main>
      </div>
    </div>
  );
}
