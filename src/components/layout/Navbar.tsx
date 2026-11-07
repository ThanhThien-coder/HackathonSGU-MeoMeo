"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { BrandMark } from "@/components/layout/BrandMark";
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-sm text-text transition-colors hover:bg-panel-2"
    >
      {theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}
    </button>
  );
}

const LINK_CLASS =
  "rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-text";

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
    <header className="border-b border-line bg-panel">
      <nav
        aria-label="Menu chính"
        className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-3 py-2 sm:px-4"
      >
        <Link href="/" className="mr-2 inline-flex items-center gap-2 font-bold tracking-tight text-text">
          <BrandMark className="size-[22px]" />
          SimpliFey
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
          <span className="rounded-full border border-st-ready-border bg-st-ready-bg px-2.5 py-0.5 text-xs font-semibold text-st-ready-fg">
            Chế độ Offline — dữ liệu ghi lại, không lưu tiến độ
          </span>
        ) : null}
        {account ? <span className="px-2 text-sm text-muted">{account}</span> : null}
        <ThemeToggle />
      </nav>
    </header>
  );
}
