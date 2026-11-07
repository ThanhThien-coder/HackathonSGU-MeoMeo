"use client";

// Nút "Giải thích" cạnh vùng bôi đen + popover kết quả — docs/spec/30_UI.md Mục 5 (UI-34), D-82, ghi chú 4.
// Gắn vào `document.body` bằng portal: khung cha có `transform` / `filter` làm `position: fixed` lệch khỏi vùng nhìn.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExplainSelectionResponse, HybridArchitecturalNode } from "@/contracts";
import type { ErrorCode } from "@/contracts/errors";
import { CONCEPT_CARDS } from "@/components/how-it-works/concept-cards";
import type { CodeSelection } from "@/components/code/slice-model";
import { explainButtonState, explainErrorText, explanationKey, shortSelection } from "@/lib/selection-explain";
import { useWorkbenchStore } from "@/store/workbench";

export interface SelectionPopoverProps {
  node: HybridArchitecturalNode;
  selection: CodeSelection | null;
  onClose: () => void;
}

type Phase =
  | { kind: "IDLE" }
  | { kind: "LOADING" }
  | { kind: "DONE"; data: ExplainSelectionResponse }
  | { kind: "ERROR"; code: ErrorCode | undefined };

const GAP = 6;
const MARGIN = 8;
const BUTTON_W = 112;
const BUTTON_H = 32;
const PANEL_W = 360;
const PANEL_MAX_H = 380;

/** Phiên đã hết lượt giải thích (`ERR_EXPLAIN_LIMIT`): nút tắt, vùng đã nhớ vẫn hiện. */
const limitReached = new Set<string>();

/** Đặt khung `w × h` cạnh `rect`: ưu tiên bên dưới, hết chỗ thì lật lên trên, luôn nằm trong vùng nhìn. */
function place(rect: DOMRect, w: number, h: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(rect.left, MARGIN), Math.max(vw - w - MARGIN, MARGIN));
  const below = rect.bottom + GAP;
  const above = rect.top - GAP - h;
  const top = below + h <= vh - MARGIN ? below : above >= MARGIN ? above : Math.max(vh - h - MARGIN, MARGIN);
  return { left, top };
}

export function SelectionPopover({ node, selection, onClose }: SelectionPopoverProps) {
  const offline = useWorkbenchStore((s) => s.is_offline_mode);
  const sessionId = useWorkbenchStore((s) => s.session_id);
  const result = useWorkbenchStore((s) => s.result);
  const progress = useWorkbenchStore((s) => s.progress);
  const explainSelection = useWorkbenchStore((s) => s.explainSelection);
  const openNode = useWorkbenchStore((s) => s.openNode);
  const setActiveStep = useWorkbenchStore((s) => s.setActiveStep);

  const key = selection ? explanationKey(node.id, selection.step_number, selection.range) : null;
  const cached = useWorkbenchStore((s) => (key ? s.ui.explanations[key] : undefined));

  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "IDLE" });
  const [, bumpLimit] = useState(0);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const requestSeq = useRef(0);

  const buttonState = useMemo(() => explainButtonState(selection, offline), [selection, offline]);
  const outOfQuota = !!sessionId && limitReached.has(sessionId);

  const close = useCallback(() => {
    requestSeq.current += 1; // Bỏ kết quả đang bay: không vẽ lên popover đã đóng.
    const target = returnFocus.current;
    returnFocus.current = null;
    onClose();
    if (target && target.isConnected) target.focus({ preventScroll: true });
  }, [onClose]);

  const run = useCallback(async () => {
    if (!selection) return;
    const seq = ++requestSeq.current;
    setPhase({ kind: "LOADING" });
    const res = await explainSelection(node.id, selection.step_number, selection.range, selection.selected_text);
    if (seq !== requestSeq.current) return;
    if (!res) {
      setPhase({ kind: "ERROR", code: "ERR_CLIENT_NETWORK" });
    } else if (res.ok) {
      setPhase({ kind: "DONE", data: res.data });
    } else {
      if (res.code === "ERR_EXPLAIN_LIMIT" && sessionId) {
        limitReached.add(sessionId);
        bumpLimit((n) => n + 1);
      }
      setPhase({ kind: "ERROR", code: res.code });
    }
  }, [explainSelection, node.id, selection, sessionId]);

  const onButtonClick = () => {
    if (buttonState.disabled || (outOfQuota && !cached)) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpened(true);
    // Chỉ bấm mới gọi API; vùng đã nhớ thì hiện liền, 0 request.
    if (cached) setPhase({ kind: "DONE", data: cached });
    else void run();
  };

  // Esc ở bất kỳ đâu ⇒ đóng. Bấm ngoài popover ⇒ đóng (khi đã mở).
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!opened) return;
      const t = e.target as Node | null;
      if (t && (panelRef.current?.contains(t) || buttonRef.current?.contains(t))) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [selection, opened, close]);

  // Mở popover ⇒ đưa focus vào khung để bàn phím dùng được.
  useLayoutEffect(() => {
    if (opened) panelRef.current?.focus({ preventScroll: true });
  }, [opened]);

  if (typeof document === "undefined" || !selection || !buttonState.visible) return null;

  // ---- Nút "Giải thích" (chưa bấm) ----
  if (!opened) {
    const disabled = buttonState.disabled || (outOfQuota && !cached);
    const tooltip = buttonState.tooltip ?? (disabled ? explainErrorText("ERR_EXPLAIN_LIMIT") : "Giải thích đoạn đang chọn");
    const pos = place(selection.rect, BUTTON_W, BUTTON_H);
    return createPortal(
      <button
        ref={buttonRef}
        type="button"
        title={tooltip}
        aria-disabled={disabled || undefined}
        // Giữ focus ở khung code khi bấm (không làm mất vùng chọn, focus trả về được).
        onPointerDown={(e) => e.preventDefault()}
        onClick={onButtonClick}
        style={{ position: "fixed", left: pos.left, top: pos.top, height: BUTTON_H, zIndex: 60 }}
        className={`glass sf-fade-in inline-flex items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
          disabled ? "cursor-not-allowed text-subtle opacity-70" : "cursor-pointer text-accent hover:text-text"
        }`}
      >
        <span aria-hidden>✨</span>
        Giải thích
      </button>,
      document.body,
    );
  }

  // ---- Popover kết quả ----
  const shown: Phase = cached ? { kind: "DONE", data: cached } : phase;
  const pos = place(selection.rect, PANEL_W, PANEL_MAX_H);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Giải thích đoạn chọn"
      tabIndex={-1}
      style={{ position: "fixed", left: pos.left, top: pos.top, width: PANEL_W, maxHeight: PANEL_MAX_H, zIndex: 60 }}
      className="glass sf-fade-in flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl text-text outline-none"
    >
      <div className="flex flex-none items-start gap-2 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12.5px] font-semibold" title={selection.selected_text}>
            {shortSelection(selection.selected_text)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">AI giải thích — có thể chưa chính xác</p>
        </div>
        <button
          type="button"
          aria-label="Đóng"
          onClick={close}
          className="flex-none rounded px-1.5 text-sm text-muted transition-colors hover:text-text"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-[13px] leading-relaxed" aria-live="polite">
        {shown.kind === "LOADING" || shown.kind === "IDLE" ? <p className="text-muted">Đang giải thích…</p> : null}

        {shown.kind === "ERROR" ? (
          <div className="space-y-2.5">
            <p role="alert">{explainErrorText(shown.code)}</p>
            {shown.code !== "ERR_EXPLAIN_LIMIT" ? (
              <button
                type="button"
                onClick={() => void run()}
                className="rounded-lg border border-line px-3 py-1 text-[12.5px] font-semibold text-accent transition-colors hover:text-text"
              >
                Thử lại
              </button>
            ) : null}
          </div>
        ) : null}

        {shown.kind === "DONE" && !shown.data.explanation ? (
          <p className="text-muted">Chưa giải thích được đoạn này.</p>
        ) : null}

        {shown.kind === "DONE" && shown.data.explanation ? (
          <ExplanationBody
            data={shown.data}
            nodeTitle={(id) => result?.nodes.find((n) => n.id === id)?.title ?? id}
            isLocked={(id) => progress?.nodes[id]?.status === "LOCKED"}
            onOpenReference={(nodeId, step) => {
              openNode(nodeId);
              setActiveStep(step);
              close();
            }}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function ExplanationBody({
  data,
  nodeTitle,
  isLocked,
  onOpenReference,
}: {
  data: ExplainSelectionResponse;
  nodeTitle: (nodeId: string) => string;
  isLocked: (nodeId: string) => boolean;
  onOpenReference: (nodeId: string, step: number) => void;
}) {
  const e = data.explanation;
  if (!e) return null;
  const skill = e.skill ? CONCEPT_CARDS[e.skill] : null;
  return (
    <div className="space-y-3">
      <section>
        <h4 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Là gì</h4>
        <p>{e.what}</p>
      </section>
      <section>
        <h4 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Ở đây</h4>
        <p>{e.here}</p>
      </section>
      {e.analogy.trim() !== "" ? (
        <section>
          <h4 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Ví dụ đời thường</h4>
          <p>{e.analogy}</p>
        </section>
      ) : null}
      {skill ? (
        <p>
          <span
            title={skill.what}
            className="inline-block rounded-full border border-line px-2.5 py-0.5 text-[11.5px] font-semibold text-accent"
          >
            {skill.name_vi}
          </span>
        </p>
      ) : null}
      {data.references.length > 0 ? (
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Còn dùng ở</h4>
          <div className="flex flex-wrap gap-1.5">
            {data.references.map((r) => {
              const locked = isLocked(r.node_id);
              return (
                <button
                  key={`${r.node_id}:${r.step_number}`}
                  type="button"
                  disabled={locked}
                  title={locked ? "Bài này chưa mở khóa" : undefined}
                  onClick={() => onOpenReference(r.node_id, r.step_number)}
                  className="max-w-full rounded-2xl border border-line px-2.5 py-0.5 text-left text-[11.5px] transition-colors enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {r.name} · {nodeTitle(r.node_id)} · Bước {r.step_number}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
