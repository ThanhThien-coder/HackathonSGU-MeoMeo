"use client";

// Một bước của tour (UI-42), theo prototype `#xray` stage "tour".
// Chưa có chữ của AI ⇒ hiện tên hàm từ `trace_steps` + shimmer: người học vẫn đi tour được (ghi chú 3, 6).
import type { ReactNode } from "react";
import { Button, PlainText } from "@/components/ui/common";
import { rangeLabel, type TourStepView } from "@/lib/role-card";

export interface TourStepProps {
  step: TourStepView;
  /** `true` ⇒ đang chờ AI: shimmer "đang phân tích…" dưới chữ dự phòng. */
  pending?: boolean;
  /** Hàng chip kỹ năng (`SkillChips`), có thể rỗng. */
  chips?: ReactNode;
  onPrev: () => void;
  onNext: () => void;
}

export function TourStep({ step, pending = false, chips, onPrev, onNext }: TourStepProps) {
  const first = step.step === 1;
  const last = step.step === step.total;
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2.5">
        <h2 id="rp-title" tabIndex={-1} className="m-0 flex items-baseline gap-1.5 text-[15px] font-bold outline-none">
          {step.has_weak ? (
            <span
              role="img"
              aria-label="Có điểm dở do AI nhận định"
              title={`Nhận định của AI: ${step.weak_what ?? ""}`}
              className="text-amber"
            >
              ⚠
            </span>
          ) : null}
          Bước {step.step}/{step.total} · {step.layer_label}
        </h2>
        <div className="flex gap-[5px]" aria-hidden="true">
          {Array.from({ length: step.total }, (_, i) => (
            <i
              key={i}
              className={`h-[5px] w-[22px] rounded-[3px] transition-colors ${i < step.step ? "bg-accent" : "bg-line"}`}
            />
          ))}
        </div>
      </div>

      <div className="font-mono text-[11.5px] text-muted">
        {step.file_path} · {rangeLabel(step.line_start, step.line_end)}
      </div>

      {step.text ? (
        <p className="m-0 text-[15px] leading-[1.65]">
          <PlainText text={step.text} />
        </p>
      ) : (
        <div>
          <p className="m-0 font-mono text-[13px] text-muted">{step.function_name}</p>
          {pending ? (
            <div role="status" className="mt-2 grid gap-1.5">
              <span className="h-3 w-full animate-pulse rounded bg-line" />
              <span className="h-3 w-4/5 animate-pulse rounded bg-line" />
              <span className="text-xs text-muted">đang phân tích…</span>
            </div>
          ) : null}
        </div>
      )}

      {chips}

      <div className="flex justify-between gap-2.5">
        <Button onClick={onPrev}>{first ? "← Thẻ vai trò" : "← Bước trước"}</Button>
        <Button variant="primary" onClick={onNext}>
          {last ? "Xem tóm tắt →" : "Bước sau →"}
        </Button>
      </div>
      <p className="m-0 text-xs text-muted">Mẹo: bấm phím ← → để chuyển bước.</p>
    </div>
  );
}
