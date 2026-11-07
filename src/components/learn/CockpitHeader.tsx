"use client";

import { useRouter } from "next/navigation";
import { CONFIG } from "@/contracts/config";
import { ThemeToggle } from "@/components/layout/Navbar";
import { useWorkbenchStore } from "@/store/workbench";

const TBTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-transparent py-1 text-sm text-text transition-colors hover:bg-panel-2 disabled:opacity-60";

function PaneIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
      <rect x={side === "left" ? 2 : 10} y="3" width="4" height="10" fill="currentColor" opacity=".75" />
    </svg>
  );
}

export interface CockpitHeaderProps {
  leftOpen?: boolean;
  rightOpen?: boolean;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}

/** Thanh trên duy nhất của trang học, theo `prototype.html` (Q-12). */
export function CockpitHeader({
  leftOpen = true,
  rightOpen = true,
  onToggleLeft,
  onToggleRight,
}: CockpitHeaderProps = {}) {
  const router = useRouter();
  const result = useWorkbenchStore((s) => s.result);
  const tokensUsed = useWorkbenchStore((s) => s.progress?.tokens_used ?? 0);
  const metrics = useWorkbenchStore((s) => s.ui.metrics);
  const resetSession = useWorkbenchStore((s) => s.resetSession);

  const snapshot = result?.snapshot;
  const sha7 = snapshot?.snapshot_id.slice(0, 7) ?? "";
  const zip = snapshot?.snapshot_id_kind === "ARCHIVE_HASH" ? " zip" : "";
  const repo = result
    ? `${result.repo_name} · ${snapshot?.ref_label ? `${snapshot.ref_label} ` : ""}@ ${sha7}${zip}`
    : null;
  const mapMs = (metrics.ingest_ms ?? 0) + (metrics.engine_ms ?? 0);
  const overQuota = tokensUsed >= CONFIG.SESSION_TOKEN_QUOTA;

  function otherRepo() {
    resetSession();
    try {
      window.localStorage.removeItem("sf.last_session");
    } catch {
      // localStorage bị chặn: bỏ qua.
    }
    router.push("/");
  }

  return (
    <header className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
      <button
        type="button"
        className={`${TBTN} px-2`}
        aria-label="Ẩn hoặc hiện bản đồ bài học"
        title="Ẩn/hiện bản đồ bài học"
        aria-pressed={leftOpen}
        onClick={onToggleLeft}
      >
        <PaneIcon side="left" />
      </button>
      <span className="font-bold text-text max-lg:hidden">SimpliFey</span>
      {repo ? (
        <span
          aria-label="Repo đang học"
          className="rounded-full border border-line-strong bg-panel-2 px-2.5 py-0.5 font-mono text-[13px] text-text"
        >
          {repo}
        </span>
      ) : null}
      <button type="button" className={`${TBTN} px-2.5`} disabled title="Tổng quan (sẽ có ở bước sau)">
        Tổng quan
      </button>
      <span className="flex-1" />
      <span className="text-xs text-muted">Bản đồ {mapMs} ms · 0 token</span>
      <span
        className={overQuota ? "text-xs font-semibold text-st-fail-fg" : "text-xs text-muted"}
        title="Token đã dùng / hạn mức của phiên"
      >
        {overQuota ? "✗ Hết hạn mức: " : ""}
        {tokensUsed} / {CONFIG.SESSION_TOKEN_QUOTA}
      </span>
      <button type="button" className={`${TBTN} px-2.5`} onClick={otherRepo}>
        Repo khác
      </button>
      <ThemeToggle />
      <button
        type="button"
        className={`${TBTN} px-2`}
        aria-label="Ẩn hoặc hiện cột X-Ray và Feynman"
        title="Ẩn/hiện X-Ray và Feynman"
        aria-pressed={rightOpen}
        onClick={onToggleRight}
      >
        <PaneIcon side="right" />
      </button>
    </header>
  );
}
