"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/common";
import {
  buildOverviewFacts,
  overviewFallback,
  overviewGroups,
  overviewNodeTitle,
  startNodeId,
} from "@/lib/overview-view";
import { useWorkbenchStore } from "@/store/workbench";

export interface OverviewContentProps {
  /** Id cho tiêu đề "Bức tranh chung"; `null` ⇒ không vẽ tiêu đề (cửa sổ đã có tiêu đề riêng). */
  titleId: string | null;
  /** Chạy sau khi mở bài đầu (cửa sổ dùng để tự đóng). */
  onStarted?: () => void;
}

/**
 * Nhịp 1 của Tổng quan (docs/spec/30_UI.md Mục 6.3), dùng chung cho cột giữa và cửa sổ.
 * Chỉ đọc store: không gọi API nào, không gọi `analyze-overview` (bản thi cắt nhịp 2, B06).
 */
export function OverviewContent({ titleId, onStarted }: OverviewContentProps) {
  const result = useWorkbenchStore((s) => s.result);
  const overview = useWorkbenchStore((s) => s.overview);
  const progress = useWorkbenchStore((s) => s.progress);
  const openNode = useWorkbenchStore((s) => s.openNode);

  const view = useMemo(() => {
    if (!result) return null;
    const facts = buildOverviewFacts(result);
    const startId = startNodeId(result, progress);
    return {
      lead: overviewFallback(result, facts),
      groups: overviewGroups(result, overview),
      startId,
      startTitle: startId ? overviewNodeTitle(result, overview, startId) : null,
    };
  }, [result, overview, progress]);

  if (!view) return <p className="p-4 text-sm text-muted">Chưa có bản đồ để tổng quan.</p>;

  return (
    <div className="max-w-[640px] p-[22px] max-sm:p-4">
      {titleId ? (
        <h2 id={titleId} tabIndex={-1} className="mb-2 text-xl font-bold text-text outline-none">
          Bức tranh chung
        </h2>
      ) : null}
      <p className="mb-4 text-text">{view.lead}</p>
      <div className="mb-[18px] grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {view.groups.map((g) => (
          <div key={g.group_id} className="rounded-[10px] border border-line bg-panel-2 px-3 py-2.5">
            <b className="mb-0.5 block text-text">
              {g.recommended ? "★ " : ""}
              {g.name}
            </b>
            <small className="block break-words text-muted">{g.titles.join(" · ")}</small>
          </div>
        ))}
      </div>
      {view.startId && view.startTitle ? (
        <Button
          variant="primary"
          className="w-full px-[18px] py-[11px] text-[15px]"
          onClick={() => {
            openNode(view.startId as string);
            onStarted?.();
          }}
        >
          Bắt đầu với: {view.startTitle} →
        </Button>
      ) : null}
    </div>
  );
}

/** Cột giữa khi chưa chọn bài (`active_node_id = null`). */
export function RepoOverview() {
  return (
    <div className="h-full overflow-auto">
      <OverviewContent titleId="ovTitle" />
    </div>
  );
}
