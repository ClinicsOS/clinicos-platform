import { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success" | "info";
}

const TONES = {
  default: {
    border: "border-red-900/30",
    iconBg: "bg-red-900/30 text-red-300",
    value: "text-white",
  },
  danger: {
    border: "border-red-500/40",
    iconBg: "bg-red-500/20 text-red-400",
    value: "text-red-300",
  },
  warning: {
    border: "border-amber-500/40",
    iconBg: "bg-amber-500/20 text-amber-400",
    value: "text-amber-300",
  },
  success: {
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/20 text-emerald-400",
    value: "text-emerald-300",
  },
  info: {
    border: "border-sky-500/40",
    iconBg: "bg-sky-500/20 text-sky-400",
    value: "text-sky-300",
  },
} as const;

export default function StatCard({ label, value, icon, hint, tone = "default" }: StatCardProps) {
  const t = TONES[tone];
  return (
    <div className={`rounded-lg border ${t.border} bg-[#150606]/60 p-3.5`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-red-200/50">{label}</div>
        {icon && (
          <div className={`flex h-7 w-7 items-center justify-center rounded-md ${t.iconBg}`}>
            {icon}
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold ${t.value}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] text-red-200/40">{hint}</div>}
    </div>
  );
}
