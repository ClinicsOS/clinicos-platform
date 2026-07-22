"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/adminApi";
import StatCard from "@/components/admin/StatCard";
import {
  IconBuildingHospital,
  IconCircleCheck,
  IconFlask,
  IconStar,
  IconArrowUpRight,
  IconAlertTriangle,
  IconClock,
  IconUsers,
  IconMoneybag,
  IconCalendarEvent,
  IconUserPlus,
  IconAlertCircle,
} from "@tabler/icons-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DashStats {
  totalClinics: number;
  activeClinics: number;
  trialClinics: number;
  basicClinics: number;
  proClinics: number;
  suspendedClinics: number;
  expiringIn3Days: number;
  expiringIn7Days: number;
  expired: number;
  pendingUpgradeRequests: number;
  totalUsers: number;
  totalPatients: number;
  todayAppointments: number;
  monthRevenue: number;
  yearRevenue: number;
}

export default function AdminDashboardPage() {
  const { data: stats } = useQuery<DashStats>({
    queryKey: ["admin", "stats"],
    queryFn: async () => (await adminApi.get("/admin/stats")).data,
    refetchInterval: 30000, // auto-refresh every 30s
  });

  const { data: growth } = useQuery<{ month: string; count: number }[]>({
    queryKey: ["admin", "growth"],
    queryFn: async () => (await adminApi.get("/admin/stats/growth")).data,
  });

  const { data: plans } = useQuery<{ trial: number; basic: number; pro: number }>({
    queryKey: ["admin", "plans"],
    queryFn: async () => (await adminApi.get("/admin/stats/plans")).data,
  });

  const { data: revenue } = useQuery<{ month: string; revenue: number }[]>({
    queryKey: ["admin", "revenue"],
    queryFn: async () => (await adminApi.get("/admin/stats/revenue")).data,
  });

  const planPie = plans
    ? [
        { name: "Trial", value: plans.trial, color: "#94a3b8" },
        { name: "Basic", value: plans.basic, color: "#38bdf8" },
        { name: "Pro", value: plans.pro, color: "#34d399" },
      ]
    : [];

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          Real-time overview of the entire platform. Auto-refreshes every 30s.
        </p>
      </header>

      {/* Priority alerts */}
      {stats && (stats.pendingUpgradeRequests > 0 || stats.expiringIn3Days > 0) && (
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {stats.pendingUpgradeRequests > 0 && (
            <Link
              href="/admin/upgrade-requests?status=pending"
              className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 transition hover:bg-amber-500/15"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/20 text-amber-400">
                  <IconArrowUpRight size={18} />
                </div>
                <div>
                  <div className="text-sm font-medium text-amber-100">
                    {stats.pendingUpgradeRequests} upgrade request{stats.pendingUpgradeRequests > 1 ? "s" : ""} awaiting review
                  </div>
                  <div className="text-[10px] text-amber-200/50">Click to review →</div>
                </div>
              </div>
            </Link>
          )}
          {stats.expiringIn3Days > 0 && (
            <Link
              href="/admin/expiring"
              className="flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 p-3 transition hover:bg-red-500/15"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-500/20 text-red-400">
                  <IconAlertTriangle size={18} />
                </div>
                <div>
                  <div className="text-sm font-medium text-red-100">
                    {stats.expiringIn3Days} clinic{stats.expiringIn3Days > 1 ? "s" : ""} expiring in ≤ 3 days
                  </div>
                  <div className="text-[10px] text-red-200/50">Click to view →</div>
                </div>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* KPI grid */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Total Clinics"
          value={stats?.totalClinics ?? "—"}
          icon={<IconBuildingHospital size={14} />}
          hint={stats ? `${stats.activeClinics} active` : undefined}
        />
        <StatCard
          label="Active Subscribers"
          value={stats?.activeClinics ?? "—"}
          icon={<IconCircleCheck size={14} />}
          tone="success"
          hint={stats ? `${stats.basicClinics} Basic · ${stats.proClinics} Pro` : undefined}
        />
        <StatCard
          label="Trials"
          value={stats?.trialClinics ?? "—"}
          icon={<IconFlask size={14} />}
          tone="info"
        />
        <StatCard
          label="Pro Subscribers"
          value={stats?.proClinics ?? "—"}
          icon={<IconStar size={14} />}
          tone="success"
        />
        <StatCard
          label="Pending Upgrades"
          value={stats?.pendingUpgradeRequests ?? "—"}
          icon={<IconArrowUpRight size={14} />}
          tone={stats && stats.pendingUpgradeRequests > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Expiring in 3 days"
          value={stats?.expiringIn3Days ?? "—"}
          icon={<IconAlertTriangle size={14} />}
          tone={stats && stats.expiringIn3Days > 0 ? "danger" : "default"}
        />
        <StatCard
          label="Expiring in 7 days"
          value={stats?.expiringIn7Days ?? "—"}
          icon={<IconClock size={14} />}
          tone="warning"
        />
        <StatCard
          label="Expired"
          value={stats?.expired ?? "—"}
          icon={<IconAlertCircle size={14} />}
          tone="danger"
        />
        <StatCard
          label="Total Users"
          value={stats?.totalUsers ?? "—"}
          icon={<IconUsers size={14} />}
        />
        <StatCard
          label="Total Patients"
          value={stats?.totalPatients ?? "—"}
          icon={<IconUserPlus size={14} />}
        />
        <StatCard
          label="Today's Appointments"
          value={stats?.todayAppointments ?? "—"}
          icon={<IconCalendarEvent size={14} />}
        />
        <StatCard
          label="Month Revenue (JOD)"
          value={stats ? stats.monthRevenue.toLocaleString() : "—"}
          icon={<IconMoneybag size={14} />}
          tone="success"
          hint={stats ? `Year: ${stats.yearRevenue.toLocaleString()} JOD` : undefined}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Growth chart */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">
            Clinic Sign-ups — Last 12 Months
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={growth || []}>
              <XAxis
                dataKey="month"
                stroke="#7f1d1d"
                tick={{ fontSize: 10, fill: "#f9a8a8" }}
              />
              <YAxis
                stroke="#7f1d1d"
                tick={{ fontSize: 10, fill: "#f9a8a8" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a0808",
                  border: "1px solid #7f1d1d",
                  borderRadius: 8,
                  fontSize: 11,
                  color: "#fff",
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#f87171"
                strokeWidth={2}
                dot={{ fill: "#f87171", r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Plans pie */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Active Clinics by Plan</h3>
          {planPie.length > 0 && planPie.some((p) => p.value > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={planPie}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(entry: { name?: string; value?: number }) =>
                    `${entry.name}: ${entry.value}`
                  }
                  labelLine={{ stroke: "#7f1d1d" }}
                >
                  {planPie.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1a0808",
                    border: "1px solid #7f1d1d",
                    borderRadius: 8,
                    fontSize: 11,
                    color: "#fff",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-[11px] text-red-200/40">
              No active clinics yet
            </div>
          )}
        </div>

        {/* Revenue chart — full width */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-white">
            Revenue — Last 12 Months (JOD)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenue || []}>
              <XAxis
                dataKey="month"
                stroke="#7f1d1d"
                tick={{ fontSize: 10, fill: "#f9a8a8" }}
              />
              <YAxis
                stroke="#7f1d1d"
                tick={{ fontSize: 10, fill: "#f9a8a8" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a0808",
                  border: "1px solid #7f1d1d",
                  borderRadius: 8,
                  fontSize: 11,
                  color: "#fff",
                }}
              />
              <Bar dataKey="revenue" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
