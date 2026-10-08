"use client";
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { IconGift } from "@tabler/icons-react";
import { fmtNum, useLT } from "@/lib/loyalty";
import { StatusOrb } from "./ui/LoyaltyUI";
import { useVisual } from "./shell/loyaltyDesign";

/**
 * RewardObject (Phase 8) — a reward drawn as a physical object: an embossed voucher with a medallion, a perforation and a gold foil edge. It tilts
 * with the pointer (mouse only, full visual mode), is matte when inactive and shows a live preview while a reward is being created / edited.
 * It only draws what it is given — name, description, cost, status, validity chips — nothing is computed or invented here.
 */
export default function RewardObject({
  name,
  description,
  points,
  status = "active",
  chips,
  preview = false,
  index = 0,
  testId,
  children,
}: {
  name: string;
  description?: string;
  /** cost in points; null while a form value isn't valid yet */
  points: number | null;
  status?: "active" | "inactive";
  chips?: ReactNode;
  /** live preview inside the form: placeholders are shown as ghost text, never as fake data */
  preview?: boolean;
  index?: number;
  testId?: string;
  children?: ReactNode;
}) {
  const { t, lang } = useLT();
  const { mode } = useVisual();
  const ref = useRef<HTMLDivElement>(null);
  const active = status === "active";

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (mode !== "full" || e.pointerType !== "mouse" || !active) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty("--rx", `${((0.5 - py) * 9).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((px - 0.5) * 12).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--mx", "30%");
    el.style.setProperty("--my", "10%");
  };

  return (
    <div className="lyx-rwo-wrap" style={{ ["--i" as string]: index } as CSSProperties}>
      <div ref={ref} className="lyx-rwo" data-status={status} data-preview={preview ? "true" : undefined} onPointerMove={move} onPointerLeave={leave} data-testid={testId}>
        <div className="lyx-rwo-sheen" aria-hidden="true" />
        <div className="lyx-rwo-top">
          <span className="lyx-rwo-med" aria-hidden="true">
            <span>
              <IconGift size={22} stroke={1.6} />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <h3 className={`lyx-display lyx-rwo-name ${!name ? "is-ghost" : ""}`} data-testid="rw-name" dir="auto">
              {name || t("Reward name", "اسم الجائزة")}
            </h3>
            {(description || preview) && <p className={`lyx-rwo-desc ${!description ? "is-ghost" : ""}`} dir="auto">{description || t("Description", "الوصف")}</p>}
          </div>
          <StatusOrb status={active ? "active" : "inactive"} pulse={false} label={active ? t("Active", "فعّالة") : t("Inactive", "متوقفة")} />
        </div>
        <div className="lyx-rwo-perf" aria-hidden="true" />
        <div className="lyx-rwo-bottom">
          <div className="lyx-rwo-pts">
            <b className={`lyx-num ${points === null ? "is-ghost" : ""}`} data-testid="rw-points">
              {points === null ? "—" : fmtNum(points)}
            </b>
            <span>{lang === "ar" ? "نقطة مطلوبة" : points === 1 ? "point required" : "points required"}</span>
          </div>
          {chips && <div className="lyx-rwo-chips">{chips}</div>}
        </div>
        {children && <div className="lyx-rwo-actions">{children}</div>}
      </div>
    </div>
  );
}
