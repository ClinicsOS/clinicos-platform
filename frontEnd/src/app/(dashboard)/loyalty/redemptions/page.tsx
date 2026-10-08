"use client";
import RedemptionsTab from "@/components/loyalty/RedemptionsTab";
import { useLoyaltyRoles } from "@/lib/loyalty";

export default function RedemptionsPage() {
  const { canConfigure } = useLoyaltyRoles();
  return <RedemptionsTab canReverse={canConfigure} />;
}
