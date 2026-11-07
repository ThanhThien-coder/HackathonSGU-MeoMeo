"use client";

// Thẻ lát cắt bài học (.slice) theo prototype.html & TasteSkill 2.5
import type { HybridArchitecturalNode, NodeStatus } from "@/contracts";
import { cardAction } from "@/lib/lesson-map";

const STATUS_CLASS: Record<NodeStatus, string> = {
  LOCKED: "st-locked text-[var(--locked)]",
  AVAILABLE: "st-ready text-[var(--ready)]",
  COMPLETED: "st-done text-[var(--done)]",
  FAILED: "st-fail text-[var(--fail)]",
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
  title: string;
  status: NodeStatus;
  hasWarning: boolean;
  weakNames: string[];
  blockedNames: string[];
  isStart: boolean;
  active: boolean;
  analysis: CardAnalysis;
  onOpen: (nodeId: string) => void;
  onBlocked: (nodeId: string) => void;
  onRetryAnalysis: (nodeId: string) => void;
}

export function LessonCard({
  node,
  title,
  status,
  hasWarning,
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
    <div className="group relative">
      <button
        type="button"
        title={tooltip}
        aria-label={label}
        aria-disabled={action.ariaDisabled || undefined}
        aria-current={active ? "true" : undefined}
        onClick={() => (action.kind === "OPEN" ? onOpen(node.id) : onBlocked(node.id))}
        className={`slice block w-full text-left rounded-[10px] p-3 relative transition-all cursor-pointer ${
          active
            ? "sel bg-[var(--panel2)] shadow-sm before:content-[''] before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:rounded-r-[3px] before:bg-[var(--accent)]"
            : "bg-[var(--panel)] hover:bg-[var(--panel2)] hover:-translate-y-0.5"
        } ${status === "LOCKED" ? "opacity-60" : ""}`}
      >
        <div className="s-top flex items-baseline gap-2 flex-wrap">

          <span className="s-name text-[14px] font-semibold text-[var(--text)]">{title}</span>
          {node.is_capstone ? (
            <span className="star text-[var(--ready)] font-bold text-xs">
              (Trọng tâm)
            </span>
          ) : null}
          {inferred ? (
            <span className="ai-tag text-[10px] font-medium text-[var(--muted)] rounded-full px-2 py-0.5 bg-[var(--panel3)]">
              AI đặt tên
            </span>
          ) : null}
        </div>

        <span className="s-code block font-mono text-[11.5px] text-[var(--muted)] mt-1 word-break-all">
          {node.title_evidence}
        </span>

        <div className={`s-st flex items-center gap-2 mt-2 text-xs font-semibold ${STATUS_CLASS[status]}`}>
          <span
            className={`dot h-2 w-2 rounded-full ${
              status === "AVAILABLE" ? "bg-[var(--ready)] shadow-[0_0_6px_var(--ready)]" : "bg-currentColor"
            }`}
          />
          <span>{STATUS_LABEL[status]}</span>
          {isStart ? (
            <span className="text-[10.5px] rounded-full bg-[var(--hl-step)] text-[var(--accent)] px-2 py-0.5 font-bold">
              Bắt đầu
            </span>
          ) : null}
          {analysis === "PENDING" ? (
            <span className="text-[11px] font-normal text-[var(--muted)]">đang phân tích…</span>
          ) : null}
          {analysis === "FAILED" ? (
            <span className="text-[11px] font-normal text-[var(--fail)]">Chưa phân tích được</span>
          ) : null}
        </div>

        {action.hint ? (
          <div className="need mt-2 text-xs text-[var(--muted)] border-t border-[var(--panel3)] pt-1.5">
            {action.hint}
          </div>
        ) : null}
      </button>

      {analysis === "FAILED" ? (
        <button
          type="button"
          onClick={() => onRetryAnalysis(node.id)}
          className="tbtn mt-1 text-xs py-1 px-2 text-[var(--text)]"
        >
          Thử lại phân tích
        </button>
      ) : null}
    </div>
  );
}
