import type { Config } from "tailwindcss";
import { LAYERS } from "./src/lib/layers";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // PHASE 6 — the single global z-index scale (src/lib/layers.ts): z-raised, z-dropdown, z-nabd, z-popover, z-drawer, z-modal, z-dialog, z-toast.
      zIndex: Object.fromEntries(Object.entries(LAYERS).map(([k, v]) => [k, String(v)])),
      colors: {
        base: "var(--base)",
        hero: "var(--hero)",
        navy: "#06263F",
        card: "var(--card)",
        card2: "var(--card2)",
        edge: "var(--edge)",
        ink: "var(--ink)",
        mute: "var(--mute)",
        soft: "var(--soft)",
        teal: "#4FC3B8",
        blue: "#3B9DE8",
        sky: "#6FBDF5",
      },
    },
  },
  plugins: [],
};
export default config;
