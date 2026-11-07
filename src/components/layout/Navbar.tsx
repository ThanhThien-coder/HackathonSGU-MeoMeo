"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text";
import { BrandLogo } from "@/components/ui/brand-logo";
import { NAV_EXTRA_LINKS } from "@/lib/nav";
import { useWorkbenchStore } from "@/store/workbench";

type Theme = "dark" | "light";

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const readTheme = (): Theme =>
  document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

/** Nút đổi chủ đề: `theme-script.ts` đã gán `data-theme` trước khi vẽ, ở đây chỉ đọc và đổi. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => "dark");

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      const raw = window.localStorage.getItem("sf.prefs");
      const prefs: unknown = raw ? JSON.parse(raw) : {};
      const base = prefs && typeof prefs === "object" ? prefs : {};
      window.localStorage.setItem("sf.prefs", JSON.stringify({ ...base, theme: next }));
    } catch {
      // localStorage bị chặn: chủ đề vẫn đổi cho phiên này.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Đổi chủ đề sáng hoặc tối"
      className="tbtn inline-flex items-center gap-1.5 rounded-xl bg-panel-2 px-3 py-1.5 text-xs font-semibold text-text ring-1 ring-inset ring-border transition-all hover:bg-panel3"
    >
      <span aria-hidden="true" className="text-accent">
        {theme === "dark" ? "☀" : "☾"}
      </span>
      <span>{theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}</span>
    </button>
  );
}

const LINK_CLASS =
  "rounded-xl px-3 py-1.5 text-sm font-medium text-muted transition-all hover:bg-panel-2 hover:text-text";

/**
 * Thanh menu cho các trang khác `/learn` (trang học có `CockpitHeader`).
 * Chỉ đọc store, không gọi API.
 */
export function Navbar() {
  const sessionId = useWorkbenchStore((s) => s.session_id);
  const offline = useWorkbenchStore((s) => s.is_offline_mode);
  const user = useWorkbenchStore((s) => s.ui.user);
  const tier = useWorkbenchStore((s) => s.profile?.overall_tier);

  const sessionQuery = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  const account = offline ? "Offline" : user ? [user.display_name, tier].filter(Boolean).join(" · ") : null;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-panel/85 backdrop-blur-xl">
      <nav
        aria-label="Menu chính"
        className="mx-auto flex max-w-6xl flex-wrap items-center gap-1.5 px-4 py-2.5 sm:px-6"
      >
        <Link
          href="/"
          className="mr-3 inline-flex items-center gap-2 font-extrabold tracking-tight text-text transition-opacity hover:opacity-90"
        >
          <BrandLogo size={22} />
          <AnimatedGradientText className="text-[15px] font-extrabold tracking-tight">
            SimpliFey
          </AnimatedGradientText>
        </Link>
        <Link href="/" className={LINK_CLASS}>
          Trang chủ
        </Link>
        {sessionId ? (
          <Link href={`/learn${sessionQuery}`} className={LINK_CLASS}>
            Trang học
          </Link>
        ) : null}
        {NAV_EXTRA_LINKS.filter((l) => l.enabled).map((l) => (
          <Link
            key={l.href}
            href={l.href === "/history" ? `${l.href}${sessionQuery}` : l.href}
            className={LINK_CLASS}
          >
            {l.label}
          </Link>
        ))}
        <span className="flex-1" />
        {offline ? (
          <span className="rounded-full bg-st-ready-bg px-3 py-1 text-xs font-semibold text-st-ready-fg ring-1 ring-inset ring-ready/30">
            Chế độ Offline — dữ liệu ghi lại, không lưu tiến độ
          </span>
        ) : null}
        {account ? (
          <span className="rounded-lg bg-panel-2/70 px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-inset ring-border">
            {account}
          </span>
        ) : null}
        <ThemeToggle />
      </nav>
    </header>
  );
}
