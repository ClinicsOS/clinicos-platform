"use client";
// CLINICOS CONNECT (C2) — /messages. Visibility here is presentation only: the server (/api/connect) enforces the Pro plan, the
// role matrix and conversation membership on every request. A clinic without the feature sees the locked screen WITHOUT a single
// chat request being made; a clinic that has it but is refused by the server (402) falls back to the same locked screen.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { useAuth } from "@/store/auth";
import type { Clinic } from "@/lib/types";
import { ConnectApp } from "@/components/connect/ConnectApp";
import { ConnectLocked } from "@/components/connect/ConnectLocked";
import s from "@/components/connect/connect.module.css";

export default function MessagesPage() {
  const router = useRouter();
  const token = useAuth((st) => st.token);
  const access = useAccess();

  // same query key as the dashboard layout, so this reuses its cache entry
  const clinicQ = useQuery({ queryKey: ["clinic"], queryFn: async () => (await api.get<Clinic>("/clinic")).data, enabled: !!token, staleTime: 3_000 });

  // A role without access never sees the page (all three roles have it today; the server's matrix decides).
  useEffect(() => {
    if (access.loaded && !access.can("internalChat")) router.replace("/dashboard");
  }, [access, router]);

  if (clinicQ.isLoading || !clinicQ.data) return <div className={s.shell} aria-busy="true" data-testid="messages-loading" />;
  const clinic = clinicQ.data;
  if (clinic.planInfo?.limits.internalChat !== true) return <ConnectLocked reason="plan" />;
  if (clinic.status && clinic.status !== "active") return <ConnectLocked reason="suspended" />;
  if (!access.can("internalChat")) return null;
  return <ConnectApp />;
}
