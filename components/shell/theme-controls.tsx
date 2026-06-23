"use client";

import { useEffect, useState } from "react";

// Light/dark toggle + accent picker, pinned to the bottom of the rail.
// The no-flash script in layout.tsx applies stored prefs before paint; on mount
// we read the current state straight off <html> and mirror it here.
//
// Theme model (CSS has :root = light and [data-theme="dark"] only — no
// [data-theme="light"] block):
//   dark  -> setAttribute('data-theme','dark')   + strata-theme = 'dark'
//   light -> removeAttribute('data-theme')        + strata-theme = 'light'
// Accent model (override only --accent):
//   named   -> setAttribute('data-accent', name)  + strata-accent = name
//   default -> removeAttribute('data-accent')     + remove strata-accent

const ACCENTS: { key: string; name: string | null; color: string }[] = [
  { key: "default", name: null, color: "#5b54e6" },
  { key: "violet", name: "violet", color: "#7c5cff" },
  { key: "blue", name: "blue", color: "#2f74e8" },
  { key: "emerald", name: "emerald", color: "#0fa674" },
];

export function ThemeControls() {
  const [isDark, setIsDark] = useState(false);
  const [accent, setAccent] = useState<string>("default");

  // Mirror state from <html> after hydration.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    setIsDark(el.getAttribute("data-theme") === "dark");
    setAccent(el.getAttribute("data-accent") ?? "default");
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    if (next) {
      el.setAttribute("data-theme", "dark");
    } else {
      el.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem("strata-theme", next ? "dark" : "light");
    } catch {
      /* SSR / storage-disabled */
    }
  };

  const pickAccent = (key: string, name: string | null) => {
    setAccent(key);
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    if (name) {
      el.setAttribute("data-accent", name);
    } else {
      el.removeAttribute("data-accent");
    }
    try {
      if (name) {
        localStorage.setItem("strata-accent", name);
      } else {
        localStorage.removeItem("strata-accent");
      }
    } catch {
      /* SSR / storage-disabled */
    }
  };

  return (
    <div className="flex flex-col items-center gap-[10px]">
      {/* Accent dots */}
      <div className="flex items-center gap-[7px]">
        {ACCENTS.map((a) => {
          const active = accent === a.key;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => pickAccent(a.key, a.name)}
              aria-label={`Accent ${a.key}`}
              aria-pressed={active}
              className="rounded-full"
              style={{
                width: 9,
                height: 9,
                background: a.color,
                cursor: "pointer",
                border: "none",
                padding: 0,
                boxShadow: active
                  ? `0 0 0 3px color-mix(in srgb, ${a.color} 22%, var(--surface))`
                  : "none",
              }}
            />
          );
        })}
      </div>

      {/* Theme toggle (compact: dot only, full recipe lives in the header variant) */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        title={isDark ? "Dark" : "Light"}
        className="flex items-center justify-center rounded-[9px] border border-border-2 bg-surface shadow-sm"
        style={{ width: 38, height: 38, cursor: "pointer" }}
      >
        <span
          className="rounded-full bg-accent"
          style={{
            width: 9,
            height: 9,
            boxShadow: "0 0 0 3px var(--accent-soft)",
          }}
        />
      </button>
    </div>
  );
}
