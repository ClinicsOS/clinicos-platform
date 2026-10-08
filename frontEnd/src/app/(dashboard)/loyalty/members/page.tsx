"use client";
import MembersTab from "@/components/loyalty/MembersTab";
import { useLoyaltyBrand, useLoyaltyRoles } from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";

export default function MembersPage() {
  const { canEnroll, canAdjust } = useLoyaltyRoles();
  const { clinicName, programName } = useLoyaltyBrand();
  const enrollRequest = useLoyaltyUi((s) => s.enrollRequest);
  const clearEnroll = useLoyaltyUi((s) => s.clearEnroll);
  return <MembersTab canEnroll={canEnroll} canAdjust={canAdjust} openEnroll={enrollRequest} onEnrollHandled={clearEnroll} clinicName={clinicName} programName={programName} />;
}
