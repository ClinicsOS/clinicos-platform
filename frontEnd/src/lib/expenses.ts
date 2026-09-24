import {
  IconHome,
  IconWifi,
  IconBolt,
  IconUsers,
  IconFirstAidKit,
  IconDeviceDesktop,
  IconTool,
  IconSpeakerphone,
  IconFileCertificate,
  IconShieldCheck,
  IconCar,
  IconHeartHandshake,
  IconDots,
} from "@tabler/icons-react";
import type { BillStatus } from "@/lib/types";

/**
 * NEW FILE — expense categories & display helpers.
 * IMPORTANT: keep in sync with backEnd/src/config/expenses.ts
 * Labels live in lib/i18n.tsx as `ex.cat.<id>`.
 */
export const EXPENSE_CATEGORIES = [
  { id: "rent", icon: IconHome },
  { id: "internet", icon: IconWifi },
  { id: "utilities", icon: IconBolt },
  { id: "salaries", icon: IconUsers },
  { id: "supplies", icon: IconFirstAidKit },
  { id: "equipment", icon: IconDeviceDesktop },
  { id: "maintenance", icon: IconTool },
  { id: "marketing", icon: IconSpeakerphone },
  { id: "fees", icon: IconFileCertificate },
  { id: "insurance", icon: IconShieldCheck },
  { id: "transport", icon: IconCar },
  { id: "family", icon: IconHeartHandshake },
  { id: "other", icon: IconDots },
] as const;

export type ExpenseCategoryId = (typeof EXPENSE_CATEGORIES)[number]["id"];

export const categoryIcon = (id: string) =>
  (EXPENSE_CATEGORIES.find((c) => c.id === id) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]).icon;

export const EXPENSE_METHODS = ["cash", "cliq", "card", "bank", "other"] as const;

/** Colour language shared by the month ribbon, bill rows and the sidebar dot. */
export const statusStyle: Record<BillStatus, { dot: string; pill: string; ring: string }> = {
  paid: { dot: "bg-teal", pill: "bg-teal/15 text-teal", ring: "border-teal/50" },
  due_soon: { dot: "bg-amber-400", pill: "bg-amber-500/15 text-amber-400", ring: "border-amber-400/60" },
  overdue: { dot: "bg-red-500", pill: "bg-red-500/15 text-red-400", ring: "border-red-500/60" },
  upcoming: { dot: "bg-sky", pill: "bg-sky/15 text-sky", ring: "border-sky/40" },
};

/** Clinic vs personal — used for bars, pills and the split meter. */
export const scopeStyle = {
  clinic: { bar: "bg-teal", text: "text-teal", soft: "bg-teal/15" },
  personal: { bar: "bg-blue", text: "text-sky", soft: "bg-blue/15" },
} as const;

/** 1234.5 → "1,234.5" — JD with up to 3 decimals (fils), no trailing zeros. */
export const jd = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Math.round(n * 1000) / 1000);

const pad = (n: number) => String(n).padStart(2, "0");

export const shiftPeriod = (period: string, n: number) => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export const daysInPeriod = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** "2026-09" → "September 2026" / "أيلول 2026" in the current UI language. */
export const periodLabel = (period: string, lang: "en" | "ar") => {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
};

/** "2026-09-26" → "26 Sep" / "٢٦ أيلول". */
export const shortDate = (date: string, lang: "en" | "ar") => {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Today in Asia/Amman as "YYYY-MM-DD" — matches the server's notion of today. */
export const ammanToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
