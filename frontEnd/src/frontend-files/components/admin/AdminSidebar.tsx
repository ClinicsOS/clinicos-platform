"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/adminAuth";
import {
  IconLayoutDashboard,
  IconBuildingHospital,
  IconArrowUpRight,
  IconClock,
  IconUsers,
  IconMail,
  IconHistory,
  IconSettings,
  IconLogout,
  IconShield,
} from "@tabler/icons-react";

const NAV_ITEMS = [
  { href: "/admin", icon: IconLayoutDashboard, label: "Dashboard" },
  { href: "/admin/clinics", icon: IconBuildingHospital, label: "Clinics" },
  { href: "/admin/upgrade-requests", icon: IconArrowUpRight, label: "Upgrade Requests" },
  { href: "/admin/expiring", icon: IconClock, label: "Expiring Soon" },
  { href: "/admin/users", icon: IconUsers, label: "Users" },
  { href: "/admin/email", icon: IconMail, label: "Send Email" },
  { href: "/admin/activity-log", icon: IconHistory, label: "Activity Log" },
  { href: "/admin/settings", icon: IconSettings, label: "Settings" },
] as const;

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const admin = useAdminAuth((s) => s.admin);
  const logout = useAdminAuth((s) => s.logout);

  const doLogout = () => {
    logout();
    router.replace("/admin/login");
  };

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-red-900/30 bg-gradient-to-b from-[#1a0808] to-[#0a0303] text-red-50">
      {/* Brand */}
      <div className="flex items-center gap-2 border-b border-red-900/30 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white">
          <IconShield size={20} />
        </div>
        <div>
          <div className="text-sm font-bold text-white">ClinicOS Admin</div>
          <div className="text-[10px] text-red-400/70">Command Center</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/admin" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-[12px] transition-colors ${
                isActive
                  ? "bg-red-600/20 text-white ring-1 ring-red-600/40"
                  : "text-red-100/70 hover:bg-red-900/20 hover:text-white"
              }`}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-red-900/30 p-3">
        <div className="mb-2 truncate text-[10px] text-red-300/60">
          Signed in as
        </div>
        <div className="mb-2 truncate text-[11px] font-medium text-white">
          {admin?.email || "—"}
        </div>
        <button
          onClick={doLogout}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-800/50 bg-red-900/20 py-1.5 text-[11px] text-red-200 hover:bg-red-900/40 hover:text-white"
        >
          <IconLogout size={13} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
