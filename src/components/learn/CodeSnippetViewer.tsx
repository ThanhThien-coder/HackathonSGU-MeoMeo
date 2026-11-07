"use client";

// Khung code cột giữa: hàng tab file (.ftab), dòng đường dẫn (.fpath), Monaco của bước đang xem.
// docs/spec/30_UI.md Mục 5, docs/prototype.html `.ftabs` / `.fpath`. Không có hàng chip bước, không nút "Xem cả file".
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { CONFIG } from "@/contracts/config";
import { SelectionPopover } from "@/components/code/SelectionPopover";
import { buildFileTabs, findStep, type CodeSelection } from "@/components/code/slice-model";
import { explanationKey } from "@/lib/selection-explain";
import { useWorkbenchStore } from "@/store/workbench";

// Monaco chỉ tải khi vào /learn và mở một bài (chunk riêng, không SSR).
const MonacoPane = dynamic(() => import("@/components/code/MonacoPane"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted">Đang tải khung code…</p>,
});

const BASE_FONT_SIZE = 13;
const PRESENTATION_FONT_SIZE = Math.round(BASE_FONT_SIZE * CONFIG.UI_PRESENTATION_FONT_SCALE);

const FRAME_CSS = `
.sf-code{--code-bg:#0b1016;--code-text:#d6deea;--gutter:#5f6c80}
html[data-theme="light"] .sf-code{--code-bg:#f8f9fb;--code-text:#1f2733;--gutter:#8a95a6}
`;

const MONO = "font-mono";

export function CodeSnippetViewer() {
  const result = useWorkbenchStore((s) => s.result);
  const activeNodeId = useWorkbenchStore((s) => s.active_node_id);
  const analyses = useWorkbenchStore((s) => s.analyses);
  const storeStep = useWorkbenchStore((s) => s.active_step);
  const hl = useWorkbenchStore((s) => s.ui.hl);
  const xrayStage = useWorkbenchStore((s) => s.ui.xray_stage);
  const activeTab = useWorkbenchStore((s) => s.active_tab);
  const setActiveStep = useWorkbenchStore((s) => s.setActiveStep);
  const setXrayStage = useWorkbenchStore((s) => s.setXrayStage);

  const [zoomed, setZoomed] = useState(false);
  // Tab "Kiểu dữ liệu" mở cho đúng (bài, bước) này; đổi bước hay bài ⇒ tự về tab file của bước.
  const [dtoKey, setDtoKey] = useState<string | null>(null);
  // Vùng chọn mới nhất do MonacoPane phát (kể cả vùng không hợp lệ: nút Giải thích hiện nhưng tắt, ghi chú 4).
  const [selection, setSelection] = useState<CodeSelection | null>(null);
  const closeSelection = useCallback(() => setSelection(null), []);

  const node = useMemo(() => result?.nodes.find((n) => n.id === activeNodeId) ?? null, [result, activeNodeId]);
  const analysis = activeNodeId ? analyses[activeNodeId] : undefined;
  const tabs = useMemo(() => (node ? buildFileTabs(node, analysis) : []), [node, analysis]);

  if (!node) {
    return <p className="p-4 text-sm text-muted">Chọn một bài ở bản đồ bên trái để bắt đầu.</p>;
  }
  if (node.trace_steps.length === 0) {
    return <p className="p-4 text-sm text-muted">Bài này chưa có code để hiển thị.</p>;
  }

  const step = findStep(node, storeStep) ?? node.trace_steps[0];
  const stateKey = `${node.id}:${step.step_number}`;
  const showDto = dtoKey === stateKey;
  const activeTabKey = showDto
    ? "dto"
    : (tabs.find((t) => t.kind === "FILE" && t.steps.includes(step.step_number))?.key ?? null);

  const openTab = (key: string) => {
    const tab = tabs.find((t) => t.key === key);
    if (!tab) return;
    if (tab.kind === "DTO") {
      setDtoKey(stateKey); // Không đổi active_step.
      return;
    }
    if (tab.first_step === null) return;
    setDtoKey(null);
    setActiveStep(tab.first_step);
    if (activeTab === "XRAY") setXrayStage("TOUR");
  };

  const beforeLines = showDto ? 0 : step.line_start - 1;
  const fontSize = zoomed ? PRESENTATION_FONT_SIZE : BASE_FONT_SIZE;


  return (
    <div className="sf-code flex h-full min-h-0 flex-col bg-[var(--code-bg)] text-[var(--code-text)]">
      <style>{FRAME_CSS}</style>

      <div className="flex flex-none items-stretch border-b border-line bg-panel-2">
        <div role="tablist" aria-label="Các file trong bài" className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((t) => {
            const selected = t.key === activeTabKey;
            const disabled = t.kind === "FILE" && t.first_step === null;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                title={t.kind === "FILE" ? t.path : t.name}
                onClick={() => openTab(t.key)}
                className={`${MONO} inline-flex flex-none items-center gap-[7px] whitespace-nowrap border-0 border-r border-b-2 border-r-line px-3.5 py-[9px] text-[12.5px] transition-colors hover:text-text ${
                  selected
                    ? "border-b-accent bg-[var(--code-bg)] text-text"
                    : "border-b-transparent bg-transparent text-muted"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {t.name}
                {t.has_weak ? (
                  <span
                    role="img"
                    aria-label="Có điểm dở do AI nhận định"
                    title="Có điểm dở do AI nhận định"
                    className="size-[7px] rounded-full bg-st-fail-fg"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={zoomed}
          onClick={() => setZoomed((z) => !z)}
          className="flex-none border-l border-line px-3 text-xs font-semibold text-muted transition-colors hover:text-text"
        >
          {zoomed ? "Thu nhỏ" : "Trình chiếu"}
        </button>
      </div>

      <div
        className={`${MONO} flex-none border-b border-line bg-[var(--code-bg)] px-3.5 py-[5px] text-[11.5px] text-muted`}
      >
        {showDto ? "Kiểu dữ liệu mà các bước dùng" : step.file_path}
        {!showDto && step.origin_note ? <span className="ml-2 text-subtle">· {step.origin_note}</span> : null}
      </div>

      {beforeLines > 0 ? (
        <p className={`${MONO} flex-none bg-[var(--code-bg)] py-0.5 pl-14 text-xs italic text-[var(--gutter)]`}>
          ⋯ dòng 1–{beforeLines} không thuộc bài học
        </p>
      ) : null}

      <div className="min-h-0 flex-1" role="region" aria-label={`Code của ${step.file_path.split("/").pop()}`}>
        <MonacoPane
          node={node}
          analysis={analysis}
          activeStep={step.step_number}
          hl={hl}
          showDto={showDto}
          fontSize={fontSize}
          onSelect={setSelection}
          tourTint={xrayStage === "TOUR"}
        />
      </div>

      {!showDto ? (
        <p className={`${MONO} flex-none bg-[var(--code-bg)] py-0.5 pl-14 text-xs italic text-[var(--gutter)]`}>
          ⋯ phần còn lại của file
        </p>
      ) : null}

      {/* Portal vào document.body: không nằm trong khung có transform/filter nên `position: fixed` không lệch. */}
      {selection && selection.step_number === step.step_number ? (
        <SelectionPopover
          key={`${node.id}:${explanationKey(node.id, selection.step_number, selection.range)}`}
          node={node}
          selection={selection}
          onClose={closeSelection}
        />
      ) : null}
    </div>
  );
}
