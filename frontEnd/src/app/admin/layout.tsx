"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/adminAuth";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAdminAuth((s) => s.token);

  const isLoginPage = pathname === "/admin/login";

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
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
