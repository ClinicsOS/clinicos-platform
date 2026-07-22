interface StatusBadgeProps {
  status: "active" | "suspended" | "expired";
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const style = {
    active: { cls: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40", label: "Active" },
    suspended: { cls: "bg-amber-500/20 text-amber-300 ring-amber-500/40", label: "Suspended" },
    expired: { cls: "bg-red-500/20 text-red-300 ring-red-500/40", label: "Expired" },
  }[status];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${style.cls}`}
    >
      {style.label}
    </span>
  );
}
