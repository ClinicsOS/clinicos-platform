"use client";
import { IconPlus } from "@tabler/icons-react";
import { CSSProperties } from "react";

export default function FloatingPlus({ style, delay = 0 }: { style: CSSProperties; delay?: number }) {
  return (
    <span
      aria-hidden
      className="float-plus pointer-events-none absolute text-sky/40"
      style={{ ...style, animationDelay: `${delay}s` }}
    >
      <IconPlus size={15} />
    </span>
  );
}
