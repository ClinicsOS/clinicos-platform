import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
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
