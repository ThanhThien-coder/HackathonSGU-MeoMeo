"use client";

// Kết quả nộp hiện ngay trong cột (không hộp thoại, ghi chú 5): mỗi lượt 1 khối `<details>` "Lượt {k}",
// lượt mới nhất mở sẵn. docs/spec/30_UI.md Mục 6.2 (kết quả nộp, UI-32b, K4).
import type { EvaluateFeynmanResponse } from "@/contracts";
import { CONFIG } from "@/contracts/config";
import { Button, PlainText } from "@/components/ui/common";
import { useWorkbenchStore } from "@/store/workbench";

export interface AttemptEntry {
  answer: string;
  response: EvaluateFeynmanResponse;
}

function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="grid gap-1">
      <div className="text-[13px]">
        Độ chính xác: <b>{Math.round(value)}</b>
        <span className="text-muted"> / 100 · cần ≥ {CONFIG.PASS_CORE_ACCURACY} để đạt</span>
      </div>
      <div
        role="img"
        aria-label={`Độ chính xác ${Math.round(value)} trên 100, ngưỡng đạt ${CONFIG.PASS_CORE_ACCURACY}`}
        className="relative h-2.5 overflow-hidden rounded-[5px] bg-line"
      >
        <i
          className={`absolute inset-y-0 left-0 block ${pct >= CONFIG.PASS_CORE_ACCURACY ? "bg-st-done-fg" : "bg-st-ready-fg"}`}
          style={{ width: `${pct}%` }}
        />
        <i
          className="absolute inset-y-0 block w-0.5 bg-text"
          style={{ left: `${CONFIG.PASS_CORE_ACCURACY}%` }}
          title={`Ngưỡng đạt ${CONFIG.PASS_CORE_ACCURACY}`}
        />
      </div>
    </div>
  );
}

function intentNote(r: EvaluateFeynmanResponse): string | null {
  if (r.intent === "OFF_TOPIC") return "Câu trả lời bị coi là lạc đề — mất 1 lượt.";
  if (r.intent === "GIVE_UP") return "Đã tính 1 lượt chưa đạt.";
  return null;
}

function Attempt({ index, entry, latest }: { index: number; entry: AttemptEntry; latest: boolean }) {
  const openHintStep = useWorkbenchStore((s) => s.openHintStep);
  const r = entry.response;
  const note = intentNote(r);
  const step = r.follow_up?.type === "CODE_POINTER" ? r.follow_up.step_index : null;

  return (
    <details open={latest} className="rounded-lg border border-line bg-bg px-2.5 py-1.5">
      <summary className="cursor-pointer text-[13px] font-semibold">
        Lượt {index}{" "}
        <span
          className={`ml-1.5 inline-block rounded-full border border-current px-2 text-[11.5px] font-semibold ${
            r.is_passed ? "text-st-done-fg" : "text-st-fail-fg"
          }`}
        >
          {r.is_passed ? "Đạt" : "Chưa đạt"}
        </span>
      </summary>
      <div className="mt-1.5 grid gap-2 text-sm">
        <div className="whitespace-pre-wrap break-words border-l-[3px] border-line px-2.5 py-1.5 text-muted">
          {entry.answer}
        </div>
        <ScoreBar value={r.core_accuracy} />
        <div className="text-xs text-muted">Đơn giản: {Math.round(r.simplicity)} (không ảnh hưởng Đạt)</div>
        {note ? <p className="m-0 text-[13px] text-muted">{note}</p> : null}
        <p className="m-0">
          <PlainText text={r.feedback} />
        </p>
        {r.detected_jargons.length > 0 ? (
          <p className="m-0 text-[13px] text-muted">Thuật ngữ bạn dùng: {r.detected_jargons.join(", ")}</p>
        ) : null}
        {r.points_covered.length > 0 ? (
          <p
            className="m-0 text-[13px]"
            aria-label={`Ý bắt buộc: ${r.points_covered.map((c, i) => `ý ${i + 1} ${c ? "đã có" : "chưa có"}`).join(", ")}`}
          >
            Ý bắt buộc:{" "}
            {r.points_covered.map((c, i) => (
              <span key={i} className={c ? "text-st-done-fg" : "text-muted"} aria-hidden="true">
                {c ? "●" : "○"}{" "}
              </span>
            ))}
          </p>
        ) : null}
        {/* K4: lạc đề / bỏ cuộc có gợi ý thì hiện gợi ý như mọi lượt khác. */}
        {r.follow_up ? (
          <div className="rounded-lg bg-hl-focus px-2.5 py-2 text-[13.5px]">
            <b>Gợi ý:</b> <PlainText text={r.follow_up.question} />
            {latest && step !== null ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button variant="small" onClick={() => openHintStep(step)}>
                  Mở Bước {step} trong tour
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export interface EvalProps {
  entries: AttemptEntry[];
}

export function Eval({ entries }: EvalProps) {
  if (entries.length === 0) return null;
  return (
    <div className="grid gap-2" aria-label="Lịch sử các lượt">
      {entries.map((entry, i) => (
        <Attempt key={entry.response.attempt_number} index={i + 1} entry={entry} latest={i === entries.length - 1} />
      ))}
    </div>
  );
}
