"use client";
import { ReactNode } from "react";

/** Icon tile with a 3D offset back-layer that slowly rotates. */
export default function DepthIcon({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <div
      className="preserve-3d spin-slow relative h-9 w-9 shrink-0"
      style={{ perspective: 300, animationDelay: `${delay}s` }}
    >
      <span
        className="absolute inset-0 rounded-lg border border-teal/50"
        style={{ transform: "translateZ(-10px) translate(4px,4px)" }}
      />
      <span className="absolute inset-0 flex items-center justify-center rounded-lg border border-blue bg-blue/10 text-sky">
        {children}
      </span>
    </div>
  );
}
