"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./brand-mark";
import { ThemeControls } from "./theme-controls";

// 60px left icon rail — shared shell across every route.
// Recipe: catalog 01 §3 (rail), §3b/§8 (the 6 nav-icon SVG paths, verbatim).

type NavKey = "upload" | "pipeline" | "graph" | "ask" | "table" | "doc";

const NAV: { key: NavKey; href: string | null }[] = [
  { key: "upload", href: "/upload" },
  { key: "pipeline", href: "/" },
  { key: "graph", href: "/graph/1" },
  { key: "ask", href: "/ask" },
  { key: "table", href: "/table" },
  { key: "doc", href: null },
];

// Inner-glyph SVG paths, verbatim from catalog 01 §3b. Each renders inside a
// 20×20 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">.
const ICONS: Record<NavKey, React.ReactNode> = {
  upload: (
    <>
      <path d="M12 15V4 M12 4l-4 4 M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  pipeline: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M7 12h3 M14 12h3" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="6" r="2.1" />
      <circle cx="18" cy="9" r="2.1" />
      <circle cx="9" cy="18" r="2.1" />
      <path d="M7.7 7.3l8.4 .9 M7.9 7.8l.9 8.4" />
    </>
  ),
  ask: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M20 20l-4.2-4.2" strokeLinecap="round" />
    </>
  ),
  table: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16 M10.5 10v9" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7l4 4V20.5H7z" strokeLinejoin="round" />
      <path d="M14 3.5V8h4" strokeLinejoin="round" />
    </>
  ),
};

function isActive(key: NavKey, pathname: string): boolean {
  switch (key) {
    case "pipeline":
      return pathname === "/";
    case "graph":
      return pathname.startsWith("/graph");
    case "doc":
      return pathname.startsWith("/doc");
    case "upload":
      return pathname.startsWith("/upload");
    case "ask":
      return pathname.startsWith("/ask");
    case "table":
      return pathname.startsWith("/table");
  }
}

function NavIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`w-10 h-10 rounded-[10px] flex items-center justify-center ${
        active ? "bg-accent-soft text-accent" : "text-text-3"
      }`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        {children}
      </svg>
    </div>
  );
}

export function IconRail() {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="w-[60px] flex-none bg-sidebar border-r border-border flex flex-col items-center py-[14px] gap-[5px]">
      <div className="mb-[10px]">
        <BrandMark size="rail" />
      </div>

      {NAV.map(({ key, href }) => {
        const active = isActive(key, pathname);
        const icon = <NavIcon active={active}>{ICONS[key]}</NavIcon>;
        return href ? (
          <Link key={key} href={href} aria-label={key} aria-current={active ? "page" : undefined}>
            {icon}
          </Link>
        ) : (
          // doc: non-navigating indicator (active only on /doc routes)
          <div key={key} aria-label={key} aria-current={active ? "page" : undefined}>
            {icon}
          </div>
        );
      })}

      <div className="mt-auto">
        <ThemeControls />
      </div>
    </nav>
  );
}
