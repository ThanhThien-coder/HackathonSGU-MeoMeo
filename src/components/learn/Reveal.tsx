"use client";

// Câu xong (UI-54): "Đáp án mẫu" + ý bắt buộc + cách sửa + thanh điểm kỹ năng. Chỉ hiện khi `finished` và có `reveal`:
// server không gửi đáp án trước đó, client cũng không tự dựng. docs/spec/30_UI.md Mục 6.2.
import type { QuestionState, SkillChange } from "@/contracts";
import { PlainText } from "@/components/ui/common";
import { TIER_LABELS, skillLabel } from "@/components/learn/QuestionChips";
import { tierOf } from "@/lib/bkt-engine";

const pct = (p: number) => (p * 100).toFixed(2);

function SkillDelta({ change }: { change: SkillChange }) {
  const lo = Math.min(change.p_before, change.p_after) * 100;
  const diff = Math.abs(change.p_after - change.p_before) * 100;
  const up = change.p_after >= change.p_before;
  const name = skillLabel(change.skill);
  const before = TIER_LABELS[tierOf(change.p_before)];
  const after = TIER_LABELS[tierOf(change.p_after)];
  return (
    <div className="grid gap-1.5" aria-label={`Điểm kỹ năng ${name}`}>
      <div className="text-[13.5px]">
        {name}:{" "}
        <b>
          {pct(change.p_before)}% → {pct(change.p_after)}%
        </b>
        <span className="text-muted">
          {" "}
          · {before}
          {before !== after ? ` → ${after}` : ""}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${name} từ ${pct(change.p_before)} phần trăm ${up ? "lên" : "xuống"} ${pct(change.p_after)} phần trăm`}
        className="relative h-2.5 overflow-hidden rounded-[5px] bg-line"
      >
        <i className="absolute inset-y-0 left-0 block bg-accent" style={{ width: `${lo}%` }} />
        <i
          className={`absolute inset-y-0 block ${up ? "bg-st-done-fg" : "bg-st-fail-fg"}`}
          style={{ left: `${lo}%`, width: `${diff}%` }}
        />
      </div>
    </div>
  );
}

export interface RevealProps {
  question: QuestionState;
  /** `points_covered` của lượt chấm cuối; không có (bỏ qua câu, tải lại) ⇒ hiện "•". */
  pointsCovered?: boolean[] | null;
  change?: SkillChange | null;
}

export function Reveal({ question, pointsCovered, change }: RevealProps) {
  const reveal = question.reveal;
  if (!question.finished || !reveal) return null;
  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-dashed border-st-done-fg bg-hl-good px-3 py-2.5 text-sm">
        <b className="mb-0.5 block text-xs">
          Đáp án mẫu <span className="font-normal text-muted">· do AI viết</span>
        </b>
        <PlainText text={reveal.reference_answer} />
      </div>
      {reveal.must_have_points.length > 0 ? (
        <div className="text-sm">
          <b className="block text-xs text-muted">Ý bắt buộc</b>
          <ul className="m-0 list-none p-0">
            {reveal.must_have_points.map((p, i) => {
              const c = pointsCovered?.[i];
              return (
                <li key={i} className="flex gap-1.5">
                  <span
                    aria-label={c === undefined ? undefined : c ? "đã có" : "chưa có"}
                    className={c === undefined ? "text-muted" : c ? "text-st-done-fg" : "text-st-fail-fg"}
                  >
                    {c === undefined ? "•" : c ? "✓" : "✗"}
                  </span>
                  <PlainText text={p} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {reveal.fix ? (
        <div className="text-sm">
          <b className="block text-xs text-muted">Cách sửa</b>
          <PlainText text={reveal.fix} />
        </div>
      ) : null}
      {change ? <SkillDelta change={change} /> : null}
    </div>
  );
}
