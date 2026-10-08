"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import OverviewTab from "@/components/loyalty/OverviewTab";
import { useLoyaltyRoles } from "@/lib/loyalty";
import { legacyTarget, useLoyaltyGo, useLoyaltyUi } from "@/lib/loyaltyNav";

/**
 * /loyalty — the Overview. Also keeps the pre-Phase-8 addresses working: `/loyalty?tab=members`, `?tab=rewards&view=pending` … are redirected to the
 * real section routes (no useSearchParams → no Suspense requirement in the static build).
 */
export default function LoyaltyOverviewPage() {
  const router = useRouter();
  const { canConfigure, canEnroll } = useLoyaltyRoles();
  const go = useLoyaltyGo();
  const setRedemptionsView = useLoyaltyUi((s) => s.setRedemptionsView);
  const [redirecting, setRedirecting] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tab"));

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const target = legacyTarget(q.get("tab"), q.get("view"));
    if (target) {
      if (target.redemptionsView) setRedemptionsView(target.redemptionsView);
      router.replace(target.path);
    } else {
      setRedirecting(false);
    }
  }, [router, setRedemptionsView]);

  if (redirecting) return null;
  return <OverviewTab onGo={go} canConfigure={canConfigure} canEnroll={canEnroll} />;
}
