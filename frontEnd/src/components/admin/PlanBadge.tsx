interface PlanBadgeProps {
  plan: "trial" | "basic" | "pro";
}

export default function PlanBadge({ plan }: PlanBadgeProps) {
  const style = {
    trial: { cls: "bg-slate-500/20 text-slate-300 ring-slate-500/40", label: "Trial" },
    basic: { cls: "bg-sky-500/20 text-sky-300 ring-sky-500/40", label: "Basic" },
    pro: { cls: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40", label: "Pro" },
  }[plan];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${style.cls}`}
    >
      {style.label}
    </span>
  );
}
