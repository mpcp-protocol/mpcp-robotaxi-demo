import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      "#0a0a0f",
        surface: "#12121a",
        card:    "#1a1a26",
        border:  "#2a2a3a",
        accent:  "#00d4ff",
        green:   "#00ff88",
        warn:    "#ffaa00",
        danger:  "#ff4444",
        muted:   "#888899",
      },
    },
  },
  plugins: [],
} satisfies Config;
