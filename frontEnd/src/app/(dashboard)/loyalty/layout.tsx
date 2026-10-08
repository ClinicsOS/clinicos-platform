"use client";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useLoyaltyEntitlement } from "@/lib/loyalty";
import type { Clinic } from "@/lib/types";
import LoyaltyShell from "@/components/loyalty/shell/LoyaltyShell";
import LoyaltyBoot from "@/components/loyalty/shell/LoyaltyBoot";
import LockedView from "@/components/loyalty/shell/LockedView";

/**
 * ClinicOS Loyalty — product layout (Phase 8). Every /loyalty/* page renders inside the Loyalty shell while the paid add-on is active; the
 * dashboard layout drops the ClinicOS sidebar for these routes (see (dashboard)/layout.tsx). Without the add-on only the locked screen is shown
 * and no Loyalty request is made — the server independently enforces the add-on on every /api/loyalty request.
 */
export default function LoyaltyLayout({ children }: { children: ReactNode }) {
  const ent = useLoyaltyEntitlement();
  const clinic = useQuery({ queryKey: ["clinic"], queryFn: async () => (await api.get<Clinic>("/clinic")).data, staleTime: 30_000 });
  if (ent.isLoading) return <LoyaltyBoot />;
  if (!ent.enabled) return <LockedView clinicName={clinic.data?.name ?? "ClinicOS"} status={ent.status} />;
  return <LoyaltyShell>{children}</LoyaltyShell>;
}
