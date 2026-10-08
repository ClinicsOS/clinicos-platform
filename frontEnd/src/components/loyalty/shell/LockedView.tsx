"use client";
import { IconLock } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import LoyaltyCard3D, { LoyaltyStyles } from "../LoyaltyCard3D";

/** The add-on is not active: a clearly non-functional screen (inside the normal ClinicOS chrome). No Loyalty requests are made. */
export default function LockedView({ clinicName, status }: { clinicName: string; status?: string }) {
  const { t } = useLT();
  const msg =
    status === "suspended"
      ? t("ClinicOS Loyalty is currently suspended for your clinic.", "إضافة ClinicOS Loyalty متوقفة حاليًا لعيادتك.")
      : status === "cancelled"
      ? t("The ClinicOS Loyalty subscription for your clinic has ended.", "انتهى اشتراك ClinicOS Loyalty لعيادتك.")
      : t("ClinicOS Loyalty is not active for your clinic.", "إضافة ClinicOS Loyalty غير مفعّلة لعيادتك.");
  const labels = { points: t("POINTS", "النقاط"), preview: t("PREVIEW", "معاينة"), memberPlaceholder: t("MEMBER NAME", "اسم العضو"), since: t("SINCE", "منذ") };
  return (
    <div className="mx-auto max-w-3xl pt-4" data-testid="loyalty-locked">
      <LoyaltyStyles />
      <div className="lyc-rise relative overflow-hidden rounded-3xl border border-edge bg-gradient-to-br from-[#0d2237] via-[#08131f] to-[#05090f] p-6 text-center sm:p-10">
        <div className="mx-auto mb-6 max-w-[300px] opacity-60 grayscale">
          <LoyaltyCard3D clinicName={clinicName} memberName={null} balance={null} tilt={false} labels={labels} />
        </div>
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-amber-200/30 bg-amber-300/10 text-amber-300">
          <IconLock size={20} />
        </div>
        <h1 className="mb-1 text-lg font-medium text-[#F2F7FC]">{msg}</h1>
        <p className="mx-auto max-w-md text-xs leading-relaxed text-[#9db7cc]">{t("Loyalty is a paid ClinicOS add-on. To enable it, please contact ClinicOS.", "الولاء إضافة مدفوعة في ClinicOS. لتفعيلها يرجى التواصل مع ClinicOS.")}</p>
      </div>
    </div>
  );
}
