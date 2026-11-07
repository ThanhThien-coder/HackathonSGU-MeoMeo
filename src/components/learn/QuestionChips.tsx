"use client";

// Chip câu ①②… của tab Feynman. docs/spec/30_UI.md Mục 6.2: câu `DROPPED` ẩn hẳn, `{k}` đánh lại từ 1,
// làm lần lượt (câu sau tắt tới khi câu trước xong), ✓ đạt · ✗ trượt · 🚩 đã báo sai.
import type { QuestionFocus, QuestionState } from "@/contracts";
import { CONCEPT_CARDS } from "@/components/how-it-works/concept-cards";

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
export const circled = (k: number): string => CIRCLED[k - 1] ?? String(k);

export const FOCUS_LABELS: Record<QuestionFocus, string> = {
  FLOW: "Luồng xử lý",
  ARCHITECTURE: "Kiến trúc",
  WEAKNESS: "Điểm yếu",
  CHANGE: "Thay đổi",
};

export const TIER_LABELS = { NOVICE: "Mới học", PRACTITIONER: "Đang vững", ARCHITECT: "Thành thạo" } as const;

export const skillLabel = (skill: QuestionState["skill"]): string => CONCEPT_CARDS[skill]?.name_vi ?? skill;

/** Câu hiển thị cho người học: bỏ `DROPPED` (D-81). */
export const visibleQuestions = (questions: QuestionState[]): QuestionState[] =>
  questions.filter((q) => q.ended_by !== "DROPPED");

export interface QuestionChipsProps {
  questions: QuestionState[]; // đã lọc `DROPPED`
  activeIndex: number | null;
  onSelect: (questionIndex: number) => void;
}

const BASE =
  "min-w-[46px] rounded-full border bg-panel-2 px-3.5 py-[3px] text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-45";

export function QuestionChips({ questions, activeIndex, onSelect }: QuestionChipsProps) {
  return (
    <div>
      <span className="mb-1 block text-xs text-muted">Câu hỏi (làm lần lượt)</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Danh sách câu hỏi">
        {questions.map((q, i) => {
          const k = i + 1;
          const locked = i > 0 && !questions[i - 1].finished;
          const passed = q.finished && q.outcome !== "FAILED";
          const tone = q.finished
            ? passed
              ? "border-st-done-fg text-st-done-fg"
              : "border-st-fail-fg text-st-fail-fg"
            : "border-line text-text";
          const current = q.question_index === activeIndex;
          const state = q.finished ? (passed ? ", đã đạt" : ", chưa đạt") : locked ? ", chưa mở" : "";
          return (
            <button
              key={q.question_index}
              type="button"
              disabled={locked}
              aria-current={current ? "true" : undefined}
              aria-label={`Câu ${k}${state}${q.disputed ? ", đã báo sai" : ""}`}
              title={`${skillLabel(q.skill)} · ${TIER_LABELS[q.tier]}`}
              onClick={() => onSelect(q.question_index)}
              className={`${BASE} ${tone} ${current ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]" : ""}`}
            >
              {circled(k)}
              {q.finished ? (passed ? " ✓" : " ✗") : ""}
              {q.disputed ? " 🚩" : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
