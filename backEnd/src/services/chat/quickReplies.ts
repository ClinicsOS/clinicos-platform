import { PLANS, PLAN_PRICES } from "../../config/plans";

export type QuickReplyKey = "about" | "pricing" | "booking" | "track";
export type ChatLang = "ar" | "en";

export interface QuickReplyOption {
  key: QuickReplyKey;
  label: { ar: string; en: string };
}

/** Shown as pill buttons the moment a visitor opens the chat — before they've typed anything. */
export const QUICK_REPLY_OPTIONS: QuickReplyOption[] = [
  { key: "about", label: { ar: "تعرف على ClinicOS", en: "Learn about ClinicOS" } },
  { key: "pricing", label: { ar: "الأسعار", en: "Pricing" } },
  { key: "booking", label: { ar: "كيف بحجز موعد؟", en: "How do I book?" } },
  { key: "track", label: { ar: "تتبع حجزي", en: "Track my booking" } },
];

function aboutAnswer(lang: ChatLang): string {
  if (lang === "ar") {
    return (
      "ClinicOS منصة إدارة عيادات خاصة بالأردن، بتساعد أي عيادة تدير شغلها من مكان واحد:\n\n" +
      "📅 **جدولة ذكية** — تقويم بدون تعارض مواعيد إطلاقاً\n" +
      "🔗 **صفحة حجز خاصة بالعيادة** — المريض بيحجز بأقل من دقيقة بدون ما يعمل حساب\n" +
      "🗂️ **ملفات مرضى وفواتير** — سجل كامل لكل مريض مع تقارير دخل\n\n" +
      "تحب تعرف عن الأسعار أو تجرب تحجز موعد؟"
    );
  }
  return (
    "ClinicOS is a clinic-management platform for private clinics in Jordan — everything run from one place:\n\n" +
    "📅 **Smart scheduling** — a conflict-free calendar\n" +
    "🔗 **Your own booking page** — patients book in under a minute, no account needed\n" +
    "🗂️ **Patient records & invoicing** — full history with income reports\n\n" +
    "Want to know about pricing, or try booking an appointment?"
  );
}

function pricingAnswer(lang: ChatLang): string {
  if (lang === "ar") {
    return (
      `عنا 3 خطط:\n\n` +
      `🆓 **تجريبي** — مجاني ${PLANS.trial.trialDays} أيام\n` +
      `💼 **Basic** — ${PLAN_PRICES.basic} دينار شهرياً (حتى ${PLANS.basic.maxDoctors} أطباء، ${PLANS.basic.maxInvoicesPerMonth} فاتورة بالشهر)\n` +
      `⭐ **Pro** — ${PLAN_PRICES.pro} دينار شهرياً (أطباء بلا حدود، تقارير شهرية، تصدير Excel/PDF)\n\n` +
      `تحب تجهز حساب عيادتك؟`
    );
  }
  return (
    `We have 3 plans:\n\n` +
    `🆓 **Trial** — free for ${PLANS.trial.trialDays} days\n` +
    `💼 **Basic** — ${PLAN_PRICES.basic} JOD/month (up to ${PLANS.basic.maxDoctors} doctors, ${PLANS.basic.maxInvoicesPerMonth} invoices/month)\n` +
    `⭐ **Pro** — ${PLAN_PRICES.pro} JOD/month (unlimited doctors, monthly reports, Excel/PDF export)\n\n` +
    `Want to set up your clinic's account?`
  );
}

function bookingAnswer(lang: ChatLang): string {
  if (lang === "ar") {
    return (
      "الحجز بسيط وبدون حساب:\n\n" +
      "1️⃣ افتح رابط حجز العيادة (كل عيادة إلها رابط خاص فيها)\n" +
      "2️⃣ اختار الطبيب والتاريخ والوقت المتاح\n" +
      "3️⃣ اكتب اسمك ورقم تلفونك\n" +
      "4️⃣ بتاخد رقم مرجعي (refCode) — احفظه لتتابع أو تلغي حجزك لاحقاً\n\n" +
      "إذا عندك رابط عيادة معينة، ابعتلي إياه وبساعدك تكمل."
    );
  }
  return (
    "Booking is simple, no account needed:\n\n" +
    "1️⃣ Open the clinic's booking link (every clinic has its own)\n" +
    "2️⃣ Pick a doctor, date, and an available time\n" +
    "3️⃣ Enter your name and phone number\n" +
    "4️⃣ You'll get a reference code (refCode) — save it to track or cancel your booking later\n\n" +
    "If you have a specific clinic's link, share it and I can guide you through it."
  );
}

function trackAnswer(lang: ChatLang): string {
  if (lang === "ar") {
    return (
      "لتتابع حجزك، بتحتاج شيئين بس:\n\n" +
      "🔖 الرقم المرجعي (refCode) يلي أخذته وقت الحجز\n" +
      "📱 نفس رقم التلفون يلي حجزت فيه\n\n" +
      "روح لصفحة \"تتبع الحجز\" على موقع العيادة وحطهم فيها، بتقدر من هناك تشوف حالة حجزك أو تلغيه."
    );
  }
  return (
    "To track your booking, you just need two things:\n\n" +
    "🔖 The reference code (refCode) you got when booking\n" +
    "📱 The same phone number you booked with\n\n" +
    "Go to the clinic's \"Track booking\" page and enter them — you'll see your booking's status and can cancel it from there."
  );
}

/** Returns the pre-written answer for a quick-reply key — zero AI tokens spent. */
export function getStaticAnswer(key: QuickReplyKey, lang: ChatLang): string {
  switch (key) {
    case "about":
      return aboutAnswer(lang);
    case "pricing":
      return pricingAnswer(lang);
    case "booking":
      return bookingAnswer(lang);
    case "track":
      return trackAnswer(lang);
  }
}
