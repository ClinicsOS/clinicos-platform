"use client";
import CheckInTab from "@/components/loyalty/CheckInTab";
import { useLoyaltyRoles } from "@/lib/loyalty";
import { useLoyaltyGo } from "@/lib/loyaltyNav";

export default function CheckInsPage() {
  const { canConfigure } = useLoyaltyRoles();
  const go = useLoyaltyGo();
  return <CheckInTab onGo={go} canConfigure={canConfigure} />;
}
