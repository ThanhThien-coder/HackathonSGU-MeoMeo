import { CONFIG } from "@/contracts/config";
import type {
  EvaluateFeynmanResponse,
  FollowUp,
  FollowUpType,
  GradeContext,
  GradingRaw,
  GuardIssue,
  NodeStateView,
  QuestionState,
  RunQuestion,
  SessionRow,
  SkillChange,
} from "@/contracts";
import type { GoogleGenAI } from "@google/genai";
import { ApiHttpError } from "@/server/errors";
import { checkTokenQuota } from "@/server/quota";
import { callLLMWithRetry } from "./gemini";
import {
  expectedFollowUpType,
  gradeRequest,
  type GradeExtras,
} from "./prompts/grade";
import { firstSentences, normText } from "./guard/text";
import { logGuardBlock } from "./guard/log";
import { verifyFollowUp } from "./guard/followup";

export {
  expectedFollowUpType,
  HINT_RULE,
  gradeSchema,
  parseGradingRaw,
  gradeRequest,
  type GradeExtras,
} from "./prompts/grade";
export { leaksNumbers, verifyFollowUp } from "./guard/followup";

export interface GradeUsage {
  tokens_in: number;
  tokens_out: number;
  retries?: number;
}

export const INJECTION_MARKER = "__INJECTION__";

export const injectionGrading = (
  t: Pick<RunQuestion, "must_have_points">,
): GradingRaw => ({
  core_accuracy: 0,
  simplicity: 0,
  intent: "OFF_TOPIC",
  points: t.must_have_points.map((_, i) => ({
    index: i + 1,
    covered: false,
    quote: "",
  })),
  misconception: INJECTION_MARKER,
  follow_up_question: null,
  follow_up_type: null,
  follow_up_step_index: null,
  feedback:
    "Câu trả lời có câu lệnh gửi cho hệ thống chấm nên không được chấm. Hãy giải thích đoạn code bằng lời của bạn.",
  detected_jargons: [],
});

export function normalizeGrading(
  raw: GradingRaw,
  t: GradeContext,
  answer: string,
): GradingRaw {
  let coreAccuracy = Math.max(
    0,
    Math.min(100, Math.round(raw.core_accuracy ?? 0)),
  );
  const simplicity = Math.max(
    0,
    Math.min(100, Math.round(raw.simplicity ?? 0)),
  );

  const n = t.must_have_points.length;
  let points: Array<{ index: number; covered: boolean; quote: string }> = [];
  for (let i = 1; i <= n; i++) {
    const found = raw.points?.find((p) => p.index === i);
    if (found) {
      points.push({
        index: i,
        covered: Boolean(found.covered),
        quote: typeof found.quote === "string" ? found.quote : "",
      });
    } else {
      points.push({
        index: i,
        covered: false,
        quote: "",
      });
    }
  }

  if (raw.intent !== "ANSWER") {
    coreAccuracy = 0;
    points = points.map((p) => ({ ...p, covered: false, quote: "" }));
  }

  const followUpStepIndex =
    typeof raw.follow_up_step_index === "number" &&
    Number.isInteger(raw.follow_up_step_index)
      ? raw.follow_up_step_index
      : null;

  const normAns = normText(answer);
  const seenJargons = new Set<string>();
  const detectedJargons: string[] = [];
  for (const j of raw.detected_jargons ?? []) {
    if (typeof j !== "string") continue;
    const nj = normText(j);
    if (nj.length > 0 && normAns.includes(nj)) {
      if (!seenJargons.has(nj)) {
        seenJargons.add(nj);
        detectedJargons.push(j);
      }
    }
  }

  return {
    core_accuracy: coreAccuracy,
    simplicity: simplicity,
    intent: raw.intent,
    points,
    misconception: raw.misconception ?? "",
    follow_up_type: raw.follow_up_type ?? null,
    follow_up_step_index: followUpStepIndex,
    follow_up_question: raw.follow_up_question ?? null,
    feedback: raw.feedback ?? "",
    detected_jargons: detectedJargons,
  };
}

export function coveredFlags(
  g: GradingRaw,
  mustHave: string[],
  answer: string,
): boolean[] {
  if (g.intent !== "ANSWER") {
    return mustHave.map(() => false);
  }

  const a = normText(answer);
  const highAccuracy =
    typeof g.core_accuracy === "number" &&
    g.core_accuracy >= CONFIG.PASS_CORE_ACCURACY;

  return mustHave.map((_, i) => {
    const p = g.points?.find((x) => x.index === i + 1);
    if (!p || !p.covered) return false;

    // K3: ý được tính khi AI báo covered VÀ (trích dẫn khớp câu trả lời sau chuẩn hóa HOẶC core_accuracy >= CONFIG.PASS_CORE_ACCURACY)
    if (highAccuracy) {
      return true;
    }

    const rawQuote = p.quote ?? "";
    const parts = rawQuote
      .split(/…|\.\.\./)
      .map((x) =>
        normText(x).replace(
          /^[\s"'“”‘’«».,;:!?]+|[\s"'“”‘’«».,;:!?]+$/gu,
          "",
        ),
      )
      .filter((x) => x.length > 0);

    return (
      parts.length > 0 &&
      parts.join("").length >= CONFIG.GRADING_QUOTE_MIN_CHARS &&
      parts.every((x) => a.includes(x))
    );
  });
}

export const decidePass = (
  g: GradingRaw,
  mustHave: string[],
  answer: string,
): boolean =>
  g.intent === "ANSWER" &&
  g.core_accuracy >= CONFIG.PASS_CORE_ACCURACY &&
  coveredFlags(g, mustHave, answer).every(Boolean);

export function staticHint(
  type: FollowUpType,
  t: GradeContext,
  aiStep?: number | null,
): FollowUp {
  if (type === "CONCEPT") {
    let question =
      "Hãy suy nghĩ thêm về khái niệm cốt lõi trong câu hỏi này để hoàn thiện câu trả lời.";
    if (t.focus === "WEAKNESS") {
      question =
        "Đoạn code này có thể gặp vấn đề gì khi khối lượng dữ liệu hoặc số lượng yêu cầu tăng lên?";
    } else if (t.focus === "FLOW") {
      question =
        "Dữ liệu được tiếp nhận, xử lý và chuyển tiếp qua các thành phần theo luồng như thế nào?";
    } else if (t.focus === "ARCHITECTURE") {
      question =
        "Các tầng trong đoạn code này phân chia trách nhiệm và tương tác với nhau như thế nào?";
    } else if (t.focus === "CHANGE") {
      question =
        "Nếu cần thay đổi logic xử lý hoặc dữ liệu, những thành phần nào sẽ bị ảnh hưởng?";
    }
    return {
      type: "CONCEPT",
      question,
      step_index: null,
    };
  }

  let s: number;
  const stepIndices = t.step_indices ?? [];
  if (
    typeof aiStep === "number" &&
    Number.isInteger(aiStep) &&
    stepIndices.includes(aiStep)
  ) {
    s = aiStep;
  } else if (stepIndices.length > 0) {
    s = stepIndices[Math.floor((stepIndices.length - 1) / 2)];
  } else {
    s = 1;
  }

  const step = (t.steps ?? []).find((x) => x.step_index === s);
  const where = step?.function_name
    ? `hàm \`${step.function_name}\` ở bước ${s}`
    : `bước ${s}`;
  // Câu hỏi mồi: tình huống nhỏ cụ thể + 1 việc đếm/lần theo được. Số ví dụ tránh số có trong đáp án (leaksNumbers).
  const secret = `${t.reference_answer ?? ""} ${(t.must_have_points ?? []).join(" ")}`;
  const n = ["3", "2", "4", "5"].find((x) => !new RegExp(`(^|\\D)${x}(\\D|$)`).test(secret)) ?? "vài";
  const QUESTIONS: Record<GradeContext["focus"], string> = {
    WEAKNESS: `Giả sử chỉ có ${n} phần tử đi qua ${where}. Mỗi phần tử khiến code gọi ra ngoài (cơ sở dữ liệu, hàm khác) mấy lần, và tổng cộng là bao nhiêu lần?`,
    FLOW: `Giả sử chỉ có ${n} phần tử. Hãy lần theo ${where}: dữ liệu vào từ đâu, và kết quả được trả cho bước nào?`,
    ARCHITECTURE: `Hãy xem ${where}: phần việc nào nó tự làm, và phần nào nó gọi hàm khác làm thay?`,
    CHANGE: `Hãy xem ${where}: nếu yêu cầu trong câu hỏi thay đổi, dòng nào ở đây phải sửa, và dòng nào giữ nguyên?`,
  };
  const question = QUESTIONS[t.focus] ?? QUESTIONS.WEAKNESS;

  return {
    type: "CODE_POINTER",
    question,
    step_index: s,
  };
}

export function staticFeedback(
  isPassed: boolean,
  attempt: number,
  maxAttempts: number,
): string {
  if (isPassed) {
    return "Chính xác! Bạn đã nắm vững bản chất của đoạn code này.";
  }
  if (attempt < maxAttempts) {
    return "Câu trả lời chưa đủ ý. Hãy xem gợi ý bên dưới để hoàn thiện câu trả lời.";
  }
  return "Bạn đã dùng hết số lượt nộp. Hãy xem đáp án mẫu bên dưới để đối chiếu với câu trả lời của mình.";
}

export function decideFollowUp(
  g: GradingRaw,
  attempt: number,
  maxAttempts: number,
  isPassed: boolean,
  t: GradeContext,
  answer: string,
): FollowUp | null {
  if (isPassed || g.misconception === INJECTION_MARKER) return null;
  if (attempt >= maxAttempts) return null;

  // K4: OFF_TOPIC và GIVE_UP (không phải chèn lệnh) chưa phải lượt cuối ⇒ luôn có gợi ý CODE_POINTER.
  // Câu mồi của AI qua cổng gác thì dùng (cụ thể hơn); không thì dùng mẫu tĩnh.
  if (g.intent === "OFF_TOPIC" || g.intent === "GIVE_UP") {
    const aiOk =
      g.follow_up_type === "CODE_POINTER" &&
      g.follow_up_question !== null &&
      verifyFollowUp(g, t, answer, isPassed).follow_up_ok;
    return aiOk
      ? { type: "CODE_POINTER", question: g.follow_up_question!, step_index: g.follow_up_step_index }
      : staticHint("CODE_POINTER", t, g.follow_up_step_index);
  }

  const expected = expectedFollowUpType(attempt, maxAttempts, t.tier);
  if (expected === null) return null;

  const ok =
    g.follow_up_type === expected &&
    g.follow_up_question !== null &&
    verifyFollowUp(g, t, answer, isPassed).follow_up_ok;

  return ok
    ? {
        type: expected,
        question: g.follow_up_question!,
        step_index:
          expected === "CODE_POINTER" ? g.follow_up_step_index : null,
      }
    : staticHint(expected, t, g.follow_up_step_index);
}

export async function gradeWithAI(
  t: GradeContext,
  answer: string,
  attempt: number,
  maxAttempts: number,
  session: SessionRow,
  opts?: {
    usage?: GradeUsage;
    sleepFn?: (ms: number) => Promise<void>;
    client?: GoogleGenAI;
    env?: Record<string, string | undefined>;
    extras?: GradeExtras;
  },
): Promise<GradingRaw> {
  checkTokenQuota(session.tokens_used);

  const req = gradeRequest(
    t,
    answer,
    attempt,
    maxAttempts,
    session,
    opts?.extras,
  );
  const outcome = await callLLMWithRetry(
    req,
    opts?.sleepFn,
    opts?.client,
    opts?.env,
  );

  if (opts?.usage) {
    opts.usage.tokens_in = (opts.usage.tokens_in ?? 0) + outcome.tokens_in;
    opts.usage.tokens_out = (opts.usage.tokens_out ?? 0) + outcome.tokens_out;
  }

  if (!outcome.ok) {
    throw new ApiHttpError(
      "ERR_AI_UNAVAILABLE",
      "Hệ thống AI hiện không thể chấm bài, vui lòng thử lại sau.",
    );
  }

  const g = normalizeGrading(outcome.value, t, answer);
  const isPassed = decidePass(g, t.must_have_points, answer);
  const check = verifyFollowUp(g, t, answer, isPassed);

  const issues: GuardIssue[] = [];
  if (!isPassed && attempt < maxAttempts && !check.follow_up_ok) {
    issues.push({ code: "G1" });
    const expected = expectedFollowUpType(attempt, maxAttempts, t.tier);
    if (expected) {
      const hint = staticHint(expected, t, g.follow_up_step_index);
      g.follow_up_type = hint.type;
      g.follow_up_question = hint.question;
      g.follow_up_step_index = hint.step_index;
    }
  }

  if (!check.feedback_ok) {
    issues.push({ code: "G2" });
    g.feedback = staticFeedback(isPassed, attempt, maxAttempts);
  }

  if (issues.length > 0) {
    logGuardBlock(
      "grade",
      attempt,
      (t as { node_id?: string }).node_id ?? null,
      issues,
    );
  }

  g.feedback = firstSentences(g.feedback, CONFIG.FEEDBACK_MAX_SENTENCES);
  return g;
}

export interface EvaluateResponseExtra {
  question: QuestionState;
  skill_change: SkillChange | null;
  node_state: NodeStateView;
  unlocked_node_ids: string[];
  tokens_used: number;
}

export function toEvaluateResponse(
  g: GradingRaw,
  t: GradeContext,
  answer: string,
  attempt: number,
  maxAttempts: number,
  extra: EvaluateResponseExtra,
): EvaluateFeynmanResponse {
  const is_passed = decidePass(g, t.must_have_points, answer);
  const points_covered = coveredFlags(g, t.must_have_points, answer);
  const follow_up = decideFollowUp(
    g,
    attempt,
    maxAttempts,
    is_passed,
    t,
    answer,
  );

  const finished = is_passed || attempt >= maxAttempts;

  const questionState: QuestionState = {
    ...extra.question,
    attempts_used: attempt,
    finished,
    reveal: finished
      ? extra.question.reveal ?? {
          reference_answer: t.reference_answer,
          must_have_points: t.must_have_points,
          fix: t.fix,
        }
      : null,
  };

  return {
    question_index: t.question_index,
    attempt_number: attempt,
    core_accuracy: g.core_accuracy,
    simplicity: g.simplicity,
    intent: g.intent,
    is_passed,
    points_covered,
    feedback: g.feedback,
    detected_jargons: g.detected_jargons,
    follow_up,
    question: questionState,
    skill_change: extra.skill_change,
    node_state: extra.node_state,
    unlocked_node_ids: extra.unlocked_node_ids,
    tokens_used: extra.tokens_used,
  };
}
