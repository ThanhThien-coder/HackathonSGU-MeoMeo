"use client";

// Tóm tắt bài (UI-44): điểm hay, điểm dở bấm được để tô dòng; nút cuối X-Ray (UI-47).
// Cấm hiện cách sửa, con số tình huống, biên (INV-06): `buildSummary` không trả những trường đó.
import { useState } from "react";
import type { HybridArchitecturalNode } from "@/contracts";
import { Button, Chip, PlainText } from "@/components/ui/common";
import { PREPARE_QUESTIONS_HINT } from "@/components/learn/waiting-label";
import { buildSummary, rangeLabel, type AnalysisSlot, type SummaryItem } from "@/lib/role-card";
import { useWorkbenchStore } from "@/store/workbench";

export interface LessonSummaryProps {
  node: HybridArchitecturalNode;
  analysis: AnalysisSlot;
  /** "← Về Bước {n}". */
  onBack: () => void;
}

const ITEM =
  "block w-full rounded-lg border border-line border-l-4 bg-bg px-3 py-2 text-left transition-colors hover:bg-panel";

function Item({ item, tone, onPick }: { item: SummaryItem; tone: "good" | "bad"; onPick: (i: SummaryItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      className={`${ITEM} ${tone === "good" ? "border-l-st-done-fg" : "border-l-st-fail-fg"}`}
    >
      <PlainText text={item.text} />
      <small className="block text-xs text-muted">
        Bước {item.step}
        {item.hl ? ` · ${rangeLabel(item.hl.line_start, item.hl.line_end)}` : ""}
      </small>
    </button>
  );
}

/** Nút cuối X-Ray: chuyển sang tab Feynman, hoặc dòng kết quả khi bài đã xong (không ôn tập, D-35). */
function NextAction({ nodeId }: { nodeId: string }) {
  const status = useWorkbenchStore((s) => s.progress?.nodes[nodeId]?.status);
  const run = useWorkbenchStore((s) => s.runs[nodeId]);
  const preparing = useWorkbenchStore((s) => Boolean(s.ui.pending[`enrich:${nodeId}`]));
  const error = useWorkbenchStore((s) => s.ui.submit_error);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const loadRun = useWorkbenchStore((s) => s.loadRun);

  if (status === "COMPLETED" || status === "FAILED") {
    return (
      <div role="status" className="grid gap-1 text-sm">
        <p className="m-0 font-semibold">{status === "COMPLETED" ? "✓ Đã hoàn thành bài này." : "✗ Bài này chưa đạt."}</p>
        <p className="m-0 text-muted">Xem lại câu hỏi ở tab Feynman. Không có ôn tập: bài giữ nguyên màu.</p>
      </div>
    );
  }
  if (status !== "AVAILABLE") return null;

  if (preparing) {
    return (
      <div className="grid gap-1.5">
        <Button variant="primary" disabled className="w-full py-2.5 text-[15px]">
          Đang chuẩn bị câu hỏi…
        </Button>
        {run ? null : (
          <p role="status" className="m-0 text-center text-xs text-muted">
            {PREPARE_QUESTIONS_HINT}
          </p>
        )}
      </div>
    );
  }
  if (!run && error) {
    return (
      <div role="alert" className="grid gap-2 text-sm">
        <p className="m-0 text-st-fail-fg">{error.message}</p>
        <Button className="w-full" onClick={() => void loadRun(nodeId)}>
          Thử lại
        </Button>
      </div>
    );
  }
  const left = run?.questions.filter((q) => !q.state.finished && q.state.ended_by !== "DROPPED").length;
  return (
    <Button variant="primary" className="w-full py-2.5 text-[15px]" onClick={() => setActiveTab("FEYNMAN")}>
      Bắt đầu trả lời{left !== undefined ? ` (${left} câu)` : ""} →
    </Button>
  );
}

export function LessonSummary({ node, analysis, onBack }: LessonSummaryProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const setHl = useWorkbenchStore((s) => s.setHl);
  const setActiveStep = useWorkbenchStore((s) => s.setActiveStep);
  const { good, bad } = buildSummary(node, analysis);

  const pick = (item: SummaryItem) => {
    // Đổi bước trước rồi mới gán `hl`; `XRayPanel` chỉ xóa `hl` mà bước không khớp, nên vùng tô này được giữ.
    setActiveStep(item.step);
    if (item.hl) setHl([item.hl]);
  };

  return (
    <div className="grid gap-3">
      <h2 id="rp-title" tabIndex={-1} className="m-0 text-base font-bold outline-none">
        Tóm tắt bài
      </h2>

      <div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-st-done-fg">Điểm hay</div>
        {good.length > 0 ? (
          <div className="grid gap-1.5">
            {good.map((g) => (
              <Item key={g.key} item={g} tone="good" onPick={pick} />
            ))}
          </div>
        ) : (
          <p className="m-0 text-sm text-muted">AI chưa nêu điểm hay nào ở bài này.</p>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-st-fail-fg">
          Điểm dở <Chip>Nhận định của AI</Chip>
        </div>
        {bad.length > 0 ? (
          <div className="grid gap-2">
            {bad.map((b) => (
              <div key={b.key}>
                <Item item={b} tone="bad" onPick={pick} />
                <button
                  type="button"
                  aria-expanded={Boolean(expanded[b.key])}
                  onClick={() => setExpanded((e) => ({ ...e, [b.key]: !e[b.key] }))}
                  className="mt-1 border-0 bg-transparent p-0 text-[13px] text-accent underline"
                >
                  {expanded[b.key] ? "Thu gọn" : "Xem thêm"}
                </button>
                {expanded[b.key] && b.consequence ? (
                  <div className="mt-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] leading-relaxed">
                    <b>Hậu quả:</b> <PlainText text={b.consequence} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-sm text-muted">AI không thấy điểm dở đáng kể ở bài này.</p>
        )}
      </div>

      <NextAction nodeId={node.id} />

      <div className="flex justify-between">
        <Button onClick={onBack}>← Về Bước {node.trace_steps.length}</Button>
      </div>
    </div>
  );
}
