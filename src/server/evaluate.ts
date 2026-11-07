import type postgres from "postgres";
import { CONFIG } from "@/contracts/config";
import type {
  CognitiveSkillState,
  EvaluateFeynmanRequest,
  EvaluateFeynmanResponse,
  GradeContext,
  GradingRaw,
  GraphSkeletonNode,
  NodeOutcome,
  NodeStateView,
  RunQuestion,
  RunStepRef,
  SessionRow,
  SkillChange,
  SWESkill,
} from "@/contracts";
import { db, sql, type TransactionSql } from "@/server/db";
import { ApiHttpError } from "@/server/errors";
import { logger } from "@/server/log";
import {
  getSessionStaticResult,
  verifyRunOwnership,
  type RunRecord,
  type SessionRecord,
} from "@/server/session";
import { toQuestionState } from "@/server/enrich";
import { aiCostUsd } from "@/server/ai/gemini";
import {
  coveredFlags,
  decidePass,
  gradeWithAI,
  injectionGrading,
  toEvaluateResponse,
  type GradeUsage,
} from "@/server/ai/grade";
import { isInjection } from "@/server/ai/guard/injection";
import {
  findReferencedSteps,
  loadPreviousAttempt,
  type PreviousAttempt,
  type ReferencedStep,
} from "@/server/ai/history";
import { deriveNodeStates, type NodeProgressRow } from "@/lib/derive";
import { computeSkillChange, outcomeOf } from "@/lib/bkt-engine";
import { similarity, validateAnswerLength } from "@/lib/similarity";
import { hasInappropriateWords, maskSensitive } from "@/lib/moderation";

export function toEvaluateRequest(body: unknown): EvaluateFeynmanRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }
  const r = body as Record<string, unknown>;

  if (typeof r.session_id !== "string" || r.session_id.trim().length === 0) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }
  if (typeof r.run_id !== "string" || r.run_id.trim().length === 0) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }

  if (
    typeof r.question_index !== "number" ||
    !Number.isInteger(r.question_index) ||
    r.question_index < 1
  ) {
    throw new ApiHttpError("ERR_ATTEMPT_OUT_OF_SYNC");
  }

  if (
    typeof r.attempt_number !== "number" ||
    !Number.isInteger(r.attempt_number) ||
    r.attempt_number < 1
  ) {
    throw new ApiHttpError("ERR_ATTEMPT_OUT_OF_SYNC");
  }

  if (typeof r.student_answer !== "string") {
    throw new ApiHttpError("ERR_ANSWER_TOO_SHORT");
  }

  return {
    session_id: r.session_id.trim(),
    run_id: r.run_id.trim(),
    question_index: r.question_index,
    student_answer: r.student_answer,
    attempt_number: r.attempt_number,
  };
}

export function checkAnswerInput(studentAnswer: string): string {
  const lengthErr = validateAnswerLength(studentAnswer);
  if (lengthErr) {
    throw new ApiHttpError(lengthErr);
  }
  if (hasInappropriateWords(studentAnswer)) {
    throw new ApiHttpError("ERR_ANSWER_INAPPROPRIATE");
  }
  // TODO: redactSecrets khi engine có
  return maskSensitive(studentAnswer);
}

export function findQuestion(
  run: RunRecord,
  questionIndex: number,
): RunQuestion {
  if (
    !Array.isArray(run.questions) ||
    questionIndex < 1 ||
    questionIndex > run.questions.length
  ) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }
  const q = run.questions[questionIndex - 1];
  if (!q) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }
  return q;
}

export async function readRunQuestion(
  req: { session_id: string; run_id: string; question_index: number },
  userId: string,
): Promise<{ run: RunRecord; session: SessionRecord; question: RunQuestion }> {
  const { run, session } = await verifyRunOwnership(req.run_id, userId);
  if (run.session_id !== req.session_id) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }
  const question = findQuestion(run, req.question_index);
  return { run, session, question };
}

// ============================================================================
// TẠM (NH-07): đổi sang src/server/progress.ts khi TH-12 merge
// ============================================================================

export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = CONFIG.DB_RETRY_DELAYS_MS;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiHttpError) {
        throw err;
      }
      if (attempt < delays.length) {
        const delay = delays[attempt];
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new ApiHttpError("ERR_PERSISTENCE_UNAVAILABLE");
      }
    }
  }
}

export async function lockRun(
  tx: TransactionSql,
  runId: string,
): Promise<RunRecord> {
  const rows = await tx<RunRecord[]>`
    select * from node_runs where id = ${runId} for update
  `;
  if (rows.length === 0) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }
  const run = rows[0];
  if (typeof run.questions === "string") {
    run.questions = JSON.parse(run.questions) as RunQuestion[];
  }
  if (typeof run.steps === "string") {
    run.steps = JSON.parse(run.steps) as RunStepRef[];
  }
  return run;
}

export async function insertAttempt(
  tx: TransactionSql,
  runId: string,
  q: RunQuestion,
  attemptNumber: number,
  grading: GradingRaw,
  isPassed: boolean,
  flags: boolean[],
  studentAnswer: string,
): Promise<void> {
  const flagsStr = `{${flags.map((f) => (f ? "true" : "false")).join(",")}}`;
  await tx`
    insert into question_attempts (
      run_id,
      question_index,
      attempt_number,
      skill,
      core_accuracy,
      simplicity,
      intent,
      is_passed,
      points_covered,
      student_answer
    ) values (
      ${runId},
      ${q.question_index},
      ${attemptNumber},
      ${q.skill}::swe_skill,
      ${grading.core_accuracy},
      ${grading.simplicity},
      ${grading.intent},
      ${isPassed},
      ${flagsStr}::text::boolean[],
      ${studentAnswer}
    )
  `;
}

export async function applyBkt(
  tx: TransactionSql,
  userId: string,
  skill: SWESkill,
  outcome: NodeOutcome,
  now: number,
): Promise<SkillChange> {
  const rows = await tx<
    {
      skill: SWESkill;
      p_mastery: number;
      last_practiced_at: Date | string | number;
      practice_count: number;
      correct_count: number;
    }[]
  >`
    select skill::text as skill, p_mastery, last_practiced_at, practice_count, correct_count
    from skill_states
    where user_id = ${userId} and skill = ${skill}::swe_skill
  `;

  let state: CognitiveSkillState | undefined;
  if (rows.length > 0) {
    const r = rows[0];
    const lpMs =
      typeof r.last_practiced_at === "number"
        ? r.last_practiced_at
        : new Date(r.last_practiced_at).getTime();
    state = {
      skill: r.skill,
      p_mastery: Number(r.p_mastery),
      last_practiced_at: lpMs,
      practice_count: Number(r.practice_count),
      correct_count: Number(r.correct_count),
    };
  }

  const { next, change } = computeSkillChange(skill, state, outcome, now);

  await tx`
    insert into skill_states (
      user_id,
      skill,
      p_mastery,
      last_practiced_at,
      practice_count,
      correct_count
    ) values (
      ${userId},
      ${skill}::swe_skill,
      ${next.p_mastery},
      to_timestamp(${next.last_practiced_at} / 1000.0),
      ${next.practice_count},
      ${next.correct_count}
    )
    on conflict (user_id, skill) do update set
      p_mastery = excluded.p_mastery,
      last_practiced_at = excluded.last_practiced_at,
      practice_count = excluded.practice_count,
      correct_count = excluded.correct_count
  `;

  return change;
}

export async function saveRunQuestions(
  tx: TransactionSql,
  run: RunRecord,
): Promise<void> {
  await tx`
    update node_runs
    set questions = ${tx.json(run.questions as unknown as postgres.JSONValue)}
    where id = ${run.id}
  `;
}

export async function loadNodeStateTx(
  tx: TransactionSql,
  sessionId: string,
  nodeId: string,
): Promise<NodeStateView> {
  const sessions = await tx<
    { graph_skeleton: GraphSkeletonNode[] | string }[]
  >`
    select graph_skeleton from learning_sessions where id = ${sessionId}
  `;
  if (sessions.length === 0) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }

  let skeleton = sessions[0].graph_skeleton;
  if (typeof skeleton === "string") {
    skeleton = JSON.parse(skeleton) as GraphSkeletonNode[];
  }

  const progressRows = await tx<NodeProgressRow[]>`
    select node_id, status, analysis_failed
    from node_progress
    where session_id = ${sessionId}
  `;

  const derived = deriveNodeStates(skeleton, progressRows);
  const st = derived[nodeId];
  if (!st) {
    throw new ApiHttpError("ERR_NODE_NOT_AVAILABLE");
  }
  return {
    ...st,
    last_run: null,
  };
}

export async function finalizeRunIfDone(
  tx: TransactionSql,
  run: RunRecord,
  now: number,
): Promise<string[]> {
  if (!run.questions.every((q) => q.finished)) {
    return [];
  }

  const activeQuestions = run.questions.filter(
    (q) => q.ended_by !== "DROPPED" && !q.disputed,
  );
  const nodeStatus: "COMPLETED" | "FAILED" = activeQuestions.some(
    (q) => q.outcome === "FAILED",
  )
    ? "FAILED"
    : "COMPLETED";

  const sessions = await tx<
    { graph_skeleton: GraphSkeletonNode[] | string }[]
  >`
    select graph_skeleton from learning_sessions where id = ${run.session_id}
  `;
  if (sessions.length === 0) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }

  let skeleton = sessions[0].graph_skeleton;
  if (typeof skeleton === "string") {
    skeleton = JSON.parse(skeleton) as GraphSkeletonNode[];
  }

  const beforeProgress = await tx<NodeProgressRow[]>`
    select node_id, status, analysis_failed
    from node_progress
    where session_id = ${run.session_id}
  `;
  const beforeStates = deriveNodeStates(skeleton, beforeProgress);

  await tx`
    update node_runs
    set finished_at = to_timestamp(${now} / 1000.0)
    where id = ${run.id}
  `;

  await tx`
    insert into node_progress (session_id, node_id, status)
    values (${run.session_id}, ${run.node_id}, ${nodeStatus})
    on conflict (session_id, node_id) do update set
      status = excluded.status,
      updated_at = now()
  `;

  const afterProgress = await tx<NodeProgressRow[]>`
    select node_id, status, analysis_failed
    from node_progress
    where session_id = ${run.session_id}
  `;
  const afterStates = deriveNodeStates(skeleton, afterProgress);

  const unlocked: string[] = [];
  for (const [nodeId, afterState] of Object.entries(afterStates)) {
    const beforeStatus = beforeStates[nodeId]?.status ?? "LOCKED";
    if (beforeStatus === "LOCKED" && afterState.status === "AVAILABLE") {
      unlocked.push(nodeId);
    }
  }

  return unlocked;
}

// ============================================================================
// Nghiệp vụ chính: evaluateFeynman
// ============================================================================

export async function evaluateFeynman(
  req: EvaluateFeynmanRequest,
  userId: string,
  now: number = Date.now(),
): Promise<EvaluateFeynmanResponse> {
  // Step 1: kiểm đầu vào (0 token, 0 DB)
  const clean = checkAnswerInput(req.student_answer);

  // Step 2: đọc không khóa
  const { run, session, question: q } = await readRunQuestion(req, userId);
  if (run.finished_at || q.finished) {
    throw new ApiHttpError("ERR_QUESTION_FINISHED");
  }
  if (req.attempt_number !== q.attempts_used + 1) {
    throw new ApiHttpError("ERR_ATTEMPT_OUT_OF_SYNC");
  }
  if (
    q.last_answer &&
    similarity(clean, q.last_answer) >= CONFIG.ANSWER_DUPLICATE_SIMILARITY
  ) {
    throw new ApiHttpError("ERR_ANSWER_DUPLICATE");
  }

  let previous: PreviousAttempt | null = null;
  if (req.attempt_number >= 2) {
    try {
      previous = await loadPreviousAttempt(run.id, req.question_index);
    } catch {
      previous = null;
    }
  }

  let referenced: ReferencedStep[] = [];
  try {
    const graph = await getSessionStaticResult(session, userId);
    referenced = findReferencedSteps(
      graph,
      run.node_id,
      clean,
      run.steps.map((s) => s.function_name),
    );
  } catch {
    referenced = [];
  }

  // Step 3: chấm ngoài transaction
  const t: GradeContext = {
    ...q,
    steps: run.steps,
    forbidden_external_keywords: run.forbidden_external_keywords,
  };
  const maxAttempts = CONFIG.MAX_ATTEMPTS_PER_QUESTION;

  let grading: GradingRaw;
  if (isInjection(clean)) {
    grading = injectionGrading(t);
  } else {
    const usage: GradeUsage = { tokens_in: 0, tokens_out: 0 };
    grading = await gradeWithAI(
      t,
      clean,
      req.attempt_number,
      maxAttempts,
      session as unknown as SessionRow,
      {
        usage,
        extras: { previous: previous ?? undefined, referenced },
      },
    );

    const totalTokens = (usage.tokens_in ?? 0) + (usage.tokens_out ?? 0);
    if (totalTokens > 0) {
      try {
        await sql`
          insert into ai_usage (session_id, call_kind, tokens_in, tokens_out, cost_usd)
          values (
            ${session.id},
            'GRADE',
            ${usage.tokens_in},
            ${usage.tokens_out},
            ${aiCostUsd(usage.tokens_in, usage.tokens_out)}
          )
        `;
      } catch {
        logger.warn({ event: "ai_usage_write_failed", call_kind: "GRADE" });
      }
    }
  }

  const isPassed = decidePass(grading, q.must_have_points, clean);

  // Step 4: transaction ngắn
  const { q2, skillChange, unlocked, nodeState } = await withDbRetry(() =>
    db.tx(async (tx) => {
      const run2 = await lockRun(tx, run.id);
      const q2 = findQuestion(run2, req.question_index);
      if (q2.finished || q2.attempts_used !== req.attempt_number - 1) {
        throw new ApiHttpError("ERR_ATTEMPT_OUT_OF_SYNC");
      }

      const flags = coveredFlags(grading, q2.must_have_points, clean);
      await insertAttempt(
        tx,
        run2.id,
        q2,
        req.attempt_number,
        grading,
        isPassed,
        flags,
        clean,
      );

      q2.attempts_used += 1;
      q2.last_answer = clean;

      let skillChange: SkillChange | null = null;
      if (isPassed || q2.attempts_used >= maxAttempts) {
        q2.finished = true;
        q2.ended_by = "ANSWER";
        q2.outcome = outcomeOf(isPassed, q2.attempts_used);
        skillChange = await applyBkt(tx, userId, q2.skill, q2.outcome, now);
        q2.p_before = skillChange.p_before;
        q2.p_after = skillChange.p_after;
      }

      await saveRunQuestions(tx, run2);
      const unlocked = await finalizeRunIfDone(tx, run2, now);
      const nodeState = await loadNodeStateTx(
        tx,
        run2.session_id,
        run2.node_id,
      );

      return { q2, skillChange, unlocked, nodeState };
    }),
  );

  const sessionRows = await sql<{ tokens_used: number }[]>`
    select tokens_used from learning_sessions where id = ${session.id}
  `;
  const tokensUsed = sessionRows[0]?.tokens_used ?? session.tokens_used;

  return toEvaluateResponse(
    grading,
    t,
    clean,
    req.attempt_number,
    maxAttempts,
    {
      question: toQuestionState(q2),
      skill_change: skillChange,
      node_state: nodeState,
      unlocked_node_ids: unlocked,
      tokens_used: tokensUsed,
    },
  );
}
