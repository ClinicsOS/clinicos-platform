"use client";
import RewardsTab from "@/components/loyalty/RewardsTab";
import { useLoyaltyRoles } from "@/lib/loyalty";

export default function RewardsPage() {
  const { canConfigure } = useLoyaltyRoles();
  return <RewardsTab canManage={canConfigure} initialView="catalog" />;
}
