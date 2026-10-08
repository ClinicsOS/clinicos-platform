"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/adminAuth";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { IconMenu2, IconShield, IconX } from "@tabler/icons-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAdminAuth((s) => s.token);

  const isLoginPage = pathname === "/admin/login";

  // Mobile / tablet: below `lg` the sidebar is an off-canvas drawer (it used to take a fixed
  // 240px of every screen, leaving a phone ~150px for content). From `lg` up nothing changes.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    // Guard everything except /admin/login — if there's no token, kick to login
    if (!isLoginPage && !token) {
      router.replace("/admin/login");
    }
  }, [isLoginPage, token, router]);

  // Login page renders standalone (no sidebar)
  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a0808] via-[#0a0303] to-[#000000] text-red-50">
        {children}
      </div>
    );
  }

  // While the redirect is in flight, don't flash the sidebar
  if (!token) {
    return <div className="min-h-screen bg-[#0a0303]" />;
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-[#0a0303] via-[#0f0505] to-[#0a0303] text-red-50">
      <div className="hidden lg:block">
        <AdminSidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-red-900/30 bg-[#120505] px-3 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
            className="flex h-10 w-10 items-center justify-center rounded-md text-red-100 hover:bg-red-900/30"
          >
            <IconMenu2 size={20} />
          </button>
          <span className="flex items-center gap-2 text-sm font-bold text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-red-600">
              <IconShield size={16} />
            </span>
            ClinicOS Admin
          </span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setNavOpen(false)}
          />
          <div className="relative h-full w-60 max-w-[85vw] shadow-2xl">
            <AdminSidebar onNavigate={() => setNavOpen(false)} />
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
              className="absolute right-2 top-3 flex h-9 w-9 items-center justify-center rounded-md text-red-200/70 hover:bg-red-900/30 hover:text-white"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
