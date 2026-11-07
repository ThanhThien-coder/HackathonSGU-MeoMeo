"use client";

// Ô trả lời Feynman. docs/spec/30_UI.md Mục 6.2 (UI-52), ghi chú 6 (K1, K2, K8).
// Không khóa cứng: Nộp KHÔNG tắt vì câu ngắn (chỉ nhắc nhẹ, 0 request, không tính lượt); câu giống lần trước chỉ
// cảnh báo vàng (server mới chặn); chỉ tắt khi đang chờ kết quả, chưa hết `SUBMIT_DEBOUNCE_MS`, hoặc hết hạn mức AI.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { QuestionState } from "@/contracts";
import { CONFIG } from "@/contracts/config";
import { waitingLabel } from "@/components/learn/waiting-label";
import { Button } from "@/components/ui/common";
import { similarity, validateAnswerLength } from "@/lib/similarity";
import { ERROR_MESSAGES, formatErrorMessage } from "@/lib/messages";
import { useWorkbenchStore } from "@/store/workbench";

const EMPTY_MESSAGE = "Hãy viết vài câu trước khi nộp.";
const AI_BUSY_MESSAGE = "AI chấm bài đang bận — bài chưa được chấm, không tính lượt.";
const QUOTA_MESSAGE = "Hết hạn mức AI của phiên — không chấm được bài mới.";

interface Notice {
  text: string;
  retry: boolean;
}

/** Cha đặt `key={run_id:question_index}` để mỗi câu có trạng thái nhắc/chờ riêng; nháp theo câu nằm ở `ui.drafts`. */
export interface AnswerBoxProps {
  nodeId: string;
  runId: string;
  question: QuestionState;
}

export function AnswerBox({ nodeId, runId, question }: AnswerBoxProps) {
  const key = `${runId}:${question.question_index}`;
  const draft = useWorkbenchStore((s) => s.ui.drafts[key] ?? "");
  const lastFailed = useWorkbenchStore((s) => s.last_failed_answers[key]);
  const pending = useWorkbenchStore((s) => Boolean(s.ui.pending[`submit:${key}`]));
  const quotaOut = useWorkbenchStore((s) => (s.progress?.tokens_used ?? 0) >= CONFIG.SESSION_TOKEN_QUOTA);
  const setDraft = useWorkbenchStore((s) => s.setDraft);
  const submitAnswer = useWorkbenchStore((s) => s.submitAnswer);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [cooling, setCooling] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Đang chấm ⇒ đếm thời gian đã chờ để đổi chữ nút (PH-17). Hết `pending` hoặc gỡ component ⇒ dọn bộ hẹn giờ.
  const [waitedMs, setWaitedMs] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    setWaitedMs(0);
    const tick = setInterval(() => setWaitedMs(Date.now() - startedAt), 500);
    return () => clearInterval(tick);
  }, [pending]);

  const duplicate =
    lastFailed !== undefined &&
    draft.trim() !== "" &&
    similarity(draft, lastFailed) >= CONFIG.ANSWER_DUPLICATE_SIMILARITY;

  const submit = async () => {
    if (pending || cooling || quotaOut) return;
    if (draft.trim() === "") {
      setNotice({ text: EMPTY_MESSAGE, retry: false });
      area.current?.focus();
      return;
    }
    const invalid = validateAnswerLength(draft);
    if (invalid) {
      // K1: nhắc nhẹ dưới ô, 0 request, không tính lượt, nút vẫn bấm được.
      setNotice({ text: ERROR_MESSAGES[invalid], retry: false });
      area.current?.focus();
      return;
    }
    setNotice(null);
    setCooling(true);
    timer.current = setTimeout(() => setCooling(false), CONFIG.SUBMIT_DEBOUNCE_MS);
    const res = await submitAnswer(nodeId, question.question_index, draft);
    if (res && !res.ok) {
      const busy = res.code === "ERR_AI_UNAVAILABLE";
      setNotice({
        text: busy ? AI_BUSY_MESSAGE : formatErrorMessage(res.code, res.message),
        retry: busy || res.code === "ERR_PERSISTENCE_UNAVAILABLE" || res.retryable,
      });
    }
    area.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const locked = pending || cooling || quotaOut;
  const count = [...draft].length;

  return (
    <div>
      <label htmlFor={`ans-${key}`} className="mb-1 block text-xs text-muted">
        Câu trả lời của bạn
      </label>
      <textarea
        id={`ans-${key}`}
        ref={area}
        rows={5}
        value={draft}
        maxLength={CONFIG.ANSWER_MAX_CHARS}
        disabled={quotaOut}
        placeholder="Viết bằng lời của bạn…"
        aria-describedby={`ans-note-${key}`}
        onChange={(e) => {
          setDraft(key, e.target.value);
          if (notice) setNotice(null);
        }}
        onKeyDown={onKeyDown}
        className="min-h-[110px] w-full resize-y rounded-lg border border-line bg-bg px-[11px] py-[9px] leading-[1.55] text-text focus:border-accent focus:outline-2 focus:outline-accent disabled:opacity-60"
      />
      <div id={`ans-note-${key}`} className="mt-1 grid gap-1 text-[12.5px]">
        <span className="text-right text-muted">
          {count}/{CONFIG.ANSWER_MAX_CHARS}
        </span>
        {quotaOut ? (
          <p role="alert" className="m-0 text-st-fail-fg">
            {QUOTA_MESSAGE}
          </p>
        ) : null}
        {notice ? (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-st-fail-fg">
            <span>{notice.text}</span>
            {notice.retry ? (
              <Button variant="small" onClick={() => void submit()} disabled={locked}>
                Thử lại
              </Button>
            ) : null}
          </p>
        ) : null}
        {duplicate && !notice ? (
          <p role="status" className="m-0 rounded-md bg-hl-focus px-2 py-1 text-text">
            Câu này giống lần trước — hãy diễn giải khác hoặc chi tiết hơn. Bạn vẫn có thể nộp.
          </p>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <Button variant="primary" onClick={() => void submit()} disabled={locked}>
          {pending ? <span role="status">{waitingLabel(waitedMs)}</span> : "Nộp câu trả lời"}
        </Button>
        <span className="text-sm text-muted">
          Lượt {question.attempts_used + 1}/{CONFIG.MAX_ATTEMPTS_PER_QUESTION}
        </span>
        <span className="text-xs text-subtle">Ctrl+Enter để nộp</span>
      </div>
    </div>
  );
}
