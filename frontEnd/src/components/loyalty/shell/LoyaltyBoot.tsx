"use client";
import { IconDiamond } from "@tabler/icons-react";

/** Dark placeholder shown for a moment while we learn whether the Loyalty add-on is active (no ClinicOS chrome flashes in between). */
export default function LoyaltyBoot() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(70% 55% at 50% 42%,#14110a 0%,#07080c 75%)" }} aria-busy="true" role="status" aria-label="ClinicOS Loyalty" data-testid="lyx-boot">
      <style>{`@keyframes lyxBoot{0%,100%{opacity:.45;transform:scale(.96)}50%{opacity:1;transform:scale(1.04)}}@media (prefers-reduced-motion:reduce){.lyx-boot-i{animation:none!important}}`}</style>
      <span className="lyx-boot-i" style={{ color: "#e8c76a", animation: "lyxBoot 1.6s ease-in-out infinite", display: "inline-flex" }}>
        <IconDiamond size={34} stroke={1.5} />
      </span>
    </div>
  );
}
