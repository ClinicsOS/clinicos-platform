interface ExpiryBadgeProps {
  daysUntilExpiry: number;
  size?: "sm" | "md";
}

/**
 * Colour-coded pill showing how many days a clinic's plan has left.
 *   red   = expired or ≤ 3 days
 *   amber = ≤ 7 days
 *   sky   = normal
 */
export default function ExpiryBadge({ daysUntilExpiry, size = "sm" }: ExpiryBadgeProps) {
  const style = (() => {
    if (daysUntilExpiry < 0) {
      return { cls: "bg-red-500/20 text-red-300 ring-red-500/40", label: "Expired" };
    }
    if (daysUntilExpiry <= 3) {
      return { cls: "bg-red-500/20 text-red-300 ring-red-500/40", label: `${daysUntilExpiry}d left` };
    }
    if (daysUntilExpiry <= 7) {
      return { cls: "bg-amber-500/20 text-amber-300 ring-amber-500/40", label: `${daysUntilExpiry}d left` };
    }
    return { cls: "bg-sky-500/20 text-sky-300 ring-sky-500/40", label: `${daysUntilExpiry}d left` };
  })();

  const sizeCls = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";

  return (
    <span className={`inline-flex items-center rounded-full ring-1 ${style.cls} ${sizeCls} font-medium`}>
      {style.label}
    </span>
  );
}
