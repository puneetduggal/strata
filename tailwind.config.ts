import type { Config } from "tailwindcss";

const v = (n: string) => `var(--${n})`;
const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"), app: v("app"), surface: v("surface"), "surface-2": v("surface-2"),
        sidebar: v("sidebar"), border: v("border"), "border-2": v("border-2"),
        text: v("text"), "text-2": v("text-2"), "text-3": v("text-3"),
        accent: v("accent"), "accent-soft": v("accent-soft"), "accent-line": v("accent-line"),
        gap: v("gap"), warn: v("warn"), ok: v("ok"), cyan: v("cyan"),
        "e-system": v("e-system"), "e-feature": v("e-feature"), "e-req": v("e-req"),
        "e-service": v("e-service"), "e-datastore": v("e-datastore"), "e-test": v("e-test"),
        "e-load": v("e-load"), "e-person": v("e-person"), "e-decision": v("e-decision"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Geist", "-apple-system", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "Geist Mono", "monospace"],
      },
      boxShadow: { DEFAULT: v("shadow"), sm: v("shadow-sm") },
    },
  },
  plugins: [],
};
export default config;
