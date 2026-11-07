"use client";

import clsx from "clsx";
import type { HybridArchitecturalNode, NodeStatus } from "@/contracts";
import { StatusPill } from "@/components/ui/Page";
import { Chip } from "@/components/ui/common";
import { cardAction } from "@/lib/lesson-map";

/**
 * Vạch màu bên trái + viền theo trạng thái (INV-11); chữ trạng thái luôn kèm theo trong `StatusPill`.
 * Đổi trạng thái (xong bài, mở khóa, chưa đạt) chỉ đổi màu có `transition`, không hiệu ứng phóng node (B20).
 */
const STATUS_CARD: Record<NodeStatus, string> = {
  LOCKED: "border-st-lock-border border-dashed border-l-st-lock-fg opacity-80",
  AVAILABLE: "border-st-ready-border border-l-st-ready-fg",
  COMPLETED: "border-st-done-border border-l-st-done-fg",
  FAILED: "border-st-fail-border border-l-st-fail-fg",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  LOCKED: "Khóa",
  AVAILABLE: "Sẵn sàng",
  COMPLETED: "Đã xong",
  FAILED: "Chưa đạt",
};

export type CardAnalysis = "PENDING" | "FAILED" | "READY" | "NONE";

export interface LessonCardProps {
  node: Pick<
    HybridArchitecturalNode,
    "id" | "title_evidence" | "title_source" | "node_type" | "is_capstone"
  >;
  /** Tên hiển thị đã qua `displayTitle` (có "~", đã cắt). */
  title: string;
  status: NodeStatus;
  hasWarning: boolean;
  /** Tên các node cha FAILED / phân tích lỗi (tooltip ⚠). */
  weakNames: string[];
  /** Tên các node cha chưa thông (dòng "Cần xong: …" của bài khóa). */
  blockedNames: string[];
  isStart: boolean;
  active: boolean;
  analysis: CardAnalysis;
  onOpen: (nodeId: string) => void;
  /** Bấm bài `LOCKED`: chỉ báo, 0 request. */
  onBlocked: (nodeId: string) => void;
  onRetryAnalysis: (nodeId: string) => void;
}

export function LessonCard({
  node,
  title,
  status,
  hasWarning,
  weakNames,
  blockedNames,
  isStart,
  active,
  analysis,
  onOpen,
  onBlocked,
  onRetryAnalysis,
}: LessonCardProps) {
  const action = cardAction(status, blockedNames);
  const inferred = ["DOMAIN_TERMS", "DIRECTORY", "FILE_BASENAME"].includes(node.title_source);
  const tooltip =
    action.hint ??
    [
      title,
      node.title_evidence,
      inferred ? "Tên suy ra — gần đúng" : null,
      node.title_source === "VIRTUAL"
        ? "Chặng tách từ hàm dài — code thật, engine chia theo vai trò câu lệnh"
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const label = [
    `${title} — ${STATUS_LABEL[status]}`,
    hasWarning ? "có cảnh báo" : null,
    analysis === "PENDING" ? "đang phân tích" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="group">
      <button
        type="button"
        title={tooltip}
        aria-label={label}
        aria-disabled={action.ariaDisabled || undefined}
        aria-current={active ? "true" : undefined}
        onClick={() => (action.kind === "OPEN" ? onOpen(node.id) : onBlocked(node.id))}
        className={clsx(
          "block w-full rounded-[10px] border border-l-4 bg-panel px-3 py-2 text-left transition-[color,background-color,border-color,opacity] duration-300 ease-out motion-reduce:transition-none hover:border-muted",
          STATUS_CARD[status],
          active && "outline-2 outline-offset-0 outline-ink",
        )}
      >
        <span className="flex flex-wrap items-baseline gap-2">
          {hasWarning ? (
            <span
              role="img"
              aria-label={`Node trước chưa vững: ${weakNames.join(", ")}`}
              title={`Node trước chưa vững: ${weakNames.join(", ")}`}
              className="text-amber"
            >
              ⚠
            </span>
          ) : null}
          <span className="text-[15px] font-semibold text-text">{title}</span>
          {node.is_capstone ? (
            <span role="img" aria-label="bài quan trọng" className="text-amber">
              ★
            </span>
          ) : null}
          {node.node_type === "ALGORITHMIC_CORE" ? <Chip tone="violet">Thuật toán</Chip> : null}
        </span>
        <span className="mt-0.5 block font-mono text-[11.5px] text-muted">{node.title_evidence}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {isStart ? <Chip tone="accent">Bắt đầu</Chip> : null}
          {analysis === "PENDING" ? <span className="text-xs text-muted">đang phân tích…</span> : null}
          {analysis === "FAILED" ? <span className="text-xs text-st-fail-fg">Chưa phân tích được</span> : null}
        </span>
        {action.hint ? (
          <span className="mt-1.5 hidden border-t border-dashed border-line pt-1 text-xs text-muted group-focus-within:block group-hover:block">
            {action.hint}
          </span>
        ) : null}
      </button>
      {analysis === "FAILED" ? (
        <button
          type="button"
          onClick={() => onRetryAnalysis(node.id)}
          className="mt-1 rounded-md border border-line-strong bg-btn px-2.5 py-1 text-xs font-semibold text-text transition-colors hover:bg-btn-hover"
        >
          Thử lại phân tích
        </button>
      ) : null}
    </div>
  );
}
