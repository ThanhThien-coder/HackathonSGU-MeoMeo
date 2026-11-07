"use client";

// Cột phải: 2 tab X-Ray / Feynman (`active_tab`). docs/spec/30_UI.md Mục 6.
// Nội dung tab Feynman do PH-08 nối; ở đây chỉ giữ chỗ và cổng bật/tắt.
import type { KeyboardEvent } from "react";
import { XRayPanel } from "@/components/learn/XRayPanel";
import { displayTitle } from "@/lib/derive";
import { mainPathOf } from "@/lib/lesson-map";
import { analysisOf } from "@/lib/role-card";
import { useWorkbenchStore } from "@/store/workbench";

const TAB =
  "border-0 border-b-2 bg-transparent px-3.5 py-[11px] font-semibold transition-colors hover:text-text aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export function LearnSidePanel() {
  const result = useWorkbenchStore((s) => s.result);
  const overview = useWorkbenchStore((s) => s.overview);
  const progress = useWorkbenchStore((s) => s.progress);
  const activeNodeId = useWorkbenchStore((s) => s.active_node_id);
  const activeTab = useWorkbenchStore((s) => s.active_tab);
  const analyses = useWorkbenchStore((s) => s.analyses);
  const run = useWorkbenchStore((s) => (s.active_node_id ? s.runs[s.active_node_id] : undefined));
  const preparing = useWorkbenchStore((s) => Boolean(s.active_node_id && s.ui.pending[`enrich:${s.active_node_id}`]));
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);

  if (!result || !activeNodeId) {
    const first = result
      ? (result.nodes.find((n) => n.id === mainPathOf(result.nodes, result.edges)[0]) ??
        result.nodes.find((n) => progress?.nodes[n.id]?.status === "AVAILABLE"))
      : undefined;
    return (
      <div className="p-6 text-muted">
        <h2 id="rp-title" tabIndex={-1} className="mb-1.5 text-base font-bold text-text outline-none">
          Chưa chọn bài
        </h2>
        <p className="m-0">
          Chọn một bài ở bản đồ bên trái{first ? `, hoặc bấm “Bắt đầu với: ${displayTitle(first, overview === "PENDING" ? null : overview)}”` : ""}.
        </p>
      </div>
    );
  }

  const feynmanReady = analysisOf(analyses[activeNodeId]) !== null;
  // Tab Feynman tắt khi chưa có bản phân tích ⇒ luôn rơi về X-Ray, không để cột trống.
  const tab = activeTab === "FEYNMAN" && feynmanReady ? "FEYNMAN" : "XRAY";
  const left = run?.questions.filter((q) => !q.state.finished && q.state.ended_by !== "DROPPED").length;

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "XRAY" ? "FEYNMAN" : "XRAY";
    if (next === "FEYNMAN" && !feynmanReady) return;
    setActiveTab(next);
    requestAnimationFrame(() => document.getElementById(`rtab-${next}`)?.focus());
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="X-Ray và Feynman"
        onKeyDown={onTabKey}
        className="sticky top-0 z-[3] flex border-b border-line bg-panel px-2"
      >
        <button
          id="rtab-XRAY"
          type="button"
          role="tab"
          aria-selected={tab === "XRAY"}
          onClick={() => setActiveTab("XRAY")}
          className={`${TAB} ${tab === "XRAY" ? "border-b-accent text-text" : "border-b-transparent text-muted"}`}
        >
          X-Ray
        </button>
        <button
          id="rtab-FEYNMAN"
          type="button"
          role="tab"
          aria-selected={tab === "FEYNMAN"}
          aria-disabled={!feynmanReady || undefined}
          title={feynmanReady ? undefined : "Cần bản phân tích trước khi đặt câu hỏi"}
          onClick={() => {
            if (feynmanReady) setActiveTab("FEYNMAN");
          }}
          className={`${TAB} ${tab === "FEYNMAN" ? "border-b-accent text-text" : "border-b-transparent text-muted"}`}
        >
          Feynman
          {left !== undefined ? ` (${left})` : ""}
          {preparing ? (
            <span role="status" aria-label="Đang chuẩn bị câu hỏi" className="ml-1.5 inline-block animate-spin">
              ⟳
            </span>
          ) : null}
        </button>
      </div>
      <div role="tabpanel" aria-labelledby={`rtab-${tab}`}>
        {tab === "XRAY" ? (
          <XRayPanel />
        ) : (
          <p className="m-0 p-4 text-sm text-muted">Câu hỏi Feynman sẽ hiện ở bước sau.</p>
        )}
      </div>
    </div>
  );
}
