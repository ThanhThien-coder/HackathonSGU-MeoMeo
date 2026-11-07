import {
  CONFIG,
  type CognitiveSkillState,
  type EnrichNodeRequest,
  type EnrichNodeResponse,
  type ExecutionTraceStep,
  type GraphSkeletonNode,
  type NodeAnalysis,
  type NodeStateView,
  type QuestionState,
  type QuestionView,
  type RunMode,
  type RunQuestion,
  type RunStepRef,
  type SessionRow,
  type StaticEngineResult,
  type SWESkill,
} from "@/contracts";
import { sql, db } from "@/server/db";
import { ApiHttpError } from "@/server/errors";
import { logAiCall, logger } from "@/server/log";
import { deriveNodeStates, type NodeProgressRow } from "@/lib/derive";
import { planNodeQuestions, type SkillMap } from "@/lib/plan";
import { aiCostUsd, assertGeminiEnv } from "@/server/ai/gemini";
import type { AnalyzeUsage } from "@/server/ai/analyze";
import { generateQuestions } from "@/server/ai/questions";
import { forbiddenKeywords } from "@/server/ai/guard/forbidden";
import { nodeCodeText } from "@/server/ai/guard/text";

// 1 dòng node_runs (spec 03 Mục 3) — CHỈ SERVER, chứa đáp án
export interface RunRecord {
  id: string;
  session_id: string;
  node_id: string;
  mode: RunMode;
  questions: RunQuestion[];
  steps: RunStepRef[];
  forbidden_external_keywords: string[];
  started_at: number;
  finished_at: number | null;
}

interface RunRow {
  id: string;
  session_id: string;
  node_id: string;
  mode: RunMode;
  questions: RunQuestion[];
  steps: RunStepRef[];
  forbidden_external_keywords: string[];
  started_at: Date | string;
  finished_at: Date | string | null;
}

const ms = (v: Date | string) => new Date(v).getTime();

function toRunRecord(r: RunRow): RunRecord {
  return {
    ...r,
    started_at: ms(r.started_at),
    finished_at: r.finished_at === null ? null : ms(r.finished_at),
  };
}

export async function findOpenRun(
  sessionId: string,
  nodeId: string,
): Promise<RunRecord | null> {
  const rows = await sql<RunRow[]>`
    SELECT id, session_id, node_id, mode, questions, steps,
           forbidden_external_keywords, started_at, finished_at
    FROM node_runs
    WHERE session_id = ${sessionId} AND node_id = ${nodeId} AND finished_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? toRunRecord(rows[0]) : null;
}

// API-03 / D-36: câu chưa xong KHÔNG có reference_answer, must_have_points, fix
export function toQuestionState(q: RunQuestion): QuestionState {
  const reveal =
    q.finished && q.ended_by !== "DROPPED"
      ? {
          reference_answer: q.reference_answer,
          must_have_points: q.must_have_points,
          fix: q.fix,
        }
      : null;
  return {
    question_index: q.question_index,
    feynman_question: q.feynman_question,
    skill: q.skill,
    tier: q.tier,
    focus: q.focus,
    attempts_used: q.attempts_used,
    finished: q.finished,
    outcome: q.outcome,
    ended_by: q.ended_by,
    disputed: q.disputed,
    reveal,
  };
}

export function toQuestionView(q: RunQuestion): QuestionView {
  return {
    question_index: q.question_index,
    skill: q.skill,
    tier: q.tier,
    focus: q.focus,
    feynman_question: q.feynman_question,
    state: toQuestionState(q),
  };
}

export interface EnrichProgress {
  node_state: Omit<NodeStateView, "last_run">;
  tokens_used: number;
}

export function buildEnrichResponse(
  run: RunRecord,
  progress: EnrichProgress,
): EnrichNodeResponse {
  return {
    node_id: run.node_id,
    run_id: run.id,
    mode: run.mode,
    questions: run.questions.map(toQuestionView),
    node_state: {
      ...progress.node_state,
      last_run: {
        run_id: run.id,
        node_id: run.node_id,
        mode: run.mode,
        started_at: run.started_at,
        finished_at: run.finished_at,
        questions: run.questions.map(toQuestionState),
      },
    },
    tokens_used: progress.tokens_used,
  };
}

async function loadNodeState(
  sessionId: string,
  userId: string,
  nodeId: string,
): Promise<NodeStateView | null> {
  const sessions = await sql<{ graph_skeleton: GraphSkeletonNode[] }[]>`
    SELECT graph_skeleton FROM learning_sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;
  if (sessions.length === 0) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }
  const progress = await sql<NodeProgressRow[]>`
    SELECT node_id, status, analysis_failed FROM node_progress
    WHERE session_id = ${sessionId}
  `;
  const states = deriveNodeStates(sessions[0].graph_skeleton, [...progress]);
  const s = states[nodeId];
  return s ? { ...s, last_run: null } : null;
}

// Bản thi: chỉ kiểm đơn giản (node có trong phiên và đang AVAILABLE)
export async function checkNodeAvailable(
  sessionId: string,
  userId: string,
  nodeId: string,
): Promise<NodeStateView> {
  const state = await loadNodeState(sessionId, userId, nodeId);
  if (!state || state.status !== "AVAILABLE") {
    throw new ApiHttpError("ERR_NODE_NOT_AVAILABLE");
  }
  return state;
}

// Khóa cache NODE_ANALYSIS theo spec 03 Mục 3.3 (NH-05 ghi cùng khóa)
export function analysisCacheKey(
  s: { source: string; snapshot_id: string; subdir: string; engine_version: string },
  nodeId: string,
): string {
  return [
    "na",
    s.source,
    s.snapshot_id,
    s.subdir,
    s.engine_version,
    nodeId,
    CONFIG.PROMPT_VERSION,
    CONFIG.LLM_MODEL,
  ].join("|");
}

export async function loadNodeAnalysis(
  session: SessionRow,
  nodeId: string,
): Promise<NodeAnalysis> {
  const keys = await sql<
    { source: string; snapshot_id: string; subdir: string; engine_version: string }[]
  >`
    SELECT source, snapshot_id, subdir, engine_version
    FROM learning_sessions WHERE id = ${session.id}
  `;
  if (keys.length === 0) throw new ApiHttpError("ERR_SESSION_NOT_FOUND");

  const rows = await sql<{ payload: NodeAnalysis }[]>`
    SELECT payload FROM ai_cache
    WHERE cache_key = ${analysisCacheKey(keys[0], nodeId)} AND kind = 'NODE_ANALYSIS'
  `;
  if (rows.length === 0) throw new ApiHttpError("ERR_ANALYSIS_NOT_READY");
  return rows[0].payload;
}

export async function loadUserSkills(userId: string): Promise<SkillMap> {
  const rows = await sql<
    {
      skill: SWESkill;
      p_mastery: number;
      last_practiced_at: Date | string;
      practice_count: number;
      correct_count: number;
    }[]
  >`
    SELECT skill::text AS skill, p_mastery, last_practiced_at, practice_count, correct_count
    FROM skill_states WHERE user_id = ${userId}
  `;
  const skills: SkillMap = {};
  for (const r of rows) {
    const state: CognitiveSkillState = {
      skill: r.skill,
      p_mastery: Number(r.p_mastery),
      last_practiced_at: ms(r.last_practiced_at),
      practice_count: r.practice_count,
      correct_count: r.correct_count,
    };
    skills[r.skill] = state;
  }
  return skills;
}

export function createStepRefs(traceSteps: ExecutionTraceStep[]): RunStepRef[] {
  return traceSteps.map((s) => ({
    step_index: s.step_number,
    layer: s.layer,
    file_path: s.file_path,
    function_name: s.function_name,
  }));
}

// TẠM (trước TH-12 lúc 22:00): ghi thẳng bằng db.tx. NH-07 đổi sang saveRunQuestions của progress.ts.
export async function createRun(
  sessionId: string,
  nodeId: string,
  mode: RunMode,
  questions: RunQuestion[],
  steps: RunStepRef[],
  forbiddenExternalKeywords: string[],
): Promise<RunRecord> {
  try {
    return await db.tx(async (tx) => {
      const rows = await tx<RunRow[]>`
        INSERT INTO node_runs (session_id, node_id, mode, questions, steps, forbidden_external_keywords)
        VALUES (
          ${sessionId}, ${nodeId}, ${mode},
          ${tx.json(JSON.parse(JSON.stringify(questions)))},
          ${tx.json(JSON.parse(JSON.stringify(steps)))},
          ARRAY(SELECT jsonb_array_elements_text(${tx.json(forbiddenExternalKeywords)}))
        )
        RETURNING id, session_id, node_id, mode, questions, steps,
                  forbidden_external_keywords, started_at, finished_at
      `;
      await tx`UPDATE learning_sessions SET last_active_at = now() WHERE id = ${sessionId}`;
      return toRunRecord(rows[0]);
    });
  } catch (e) {
    // node_runs_one_open (2 tab cùng lúc) ⇒ trả run đang mở như nhánh idempotent
    if ((e as { code?: string }).code === "23505") {
      const open = await findOpenRun(sessionId, nodeId);
      if (open) return open;
    }
    throw e;
  }
}

async function recordAiUsage(sessionId: string, u: AnalyzeUsage): Promise<void> {
  try {
    await sql`
      INSERT INTO ai_usage (session_id, call_kind, tokens_in, tokens_out, cost_usd)
      VALUES (${sessionId}, 'QUESTIONS', ${u.tokens_in}, ${u.tokens_out},
              ${aiCostUsd(u.tokens_in, u.tokens_out)})
    `;
  } catch {
    // D-66: lỗi ghi L2 chỉ cảnh báo, không làm hỏng request
    logger.warn({ event: "ai_usage_write_failed", call_kind: "QUESTIONS" });
  }
}

// Spec 03 Mục 6.1. Route đã xác thực và đọc session + graph (TH-06, TH-07) rồi gọi hàm này.
export async function enrichNode(
  req: EnrichNodeRequest,
  session: SessionRow,
  graph: StaticEngineResult,
  now: number = Date.now(),
): Promise<EnrichNodeResponse> {
  const open = await findOpenRun(session.id, req.node_id);
  if (open) {
    const state = await loadNodeState(session.id, session.user_id, req.node_id);
    if (!state) throw new ApiHttpError("ERR_NODE_NOT_AVAILABLE");
    return buildEnrichResponse(open, {
      node_state: state,
      tokens_used: session.tokens_used,
    });
  }

  const state = await checkNodeAvailable(session.id, session.user_id, req.node_id);
  const node = graph.nodes.find((n) => n.id === req.node_id);
  if (!node) throw new ApiHttpError("ERR_NODE_NOT_AVAILABLE");
  const analysis = await loadNodeAnalysis(session, req.node_id);
  const skills = await loadUserSkills(session.user_id);

  const plan = planNodeQuestions(analysis, skills, now, node.trace_steps.length);
  const usage: AnalyzeUsage = { tokens_in: 0, tokens_out: 0, retries: 0 };
  const startedAt = Date.now();
  const questions = await generateQuestions(session, graph, node, analysis, plan, usage);

  logAiCall({
    call_kind: "QUESTIONS",
    backend: assertGeminiEnv(),
    model: CONFIG.LLM_MODEL,
    tokens_in: usage.tokens_in,
    tokens_out: usage.tokens_out,
    retries: usage.retries,
    cost_usd: aiCostUsd(usage.tokens_in, usage.tokens_out),
    duration_ms: Date.now() - startedAt,
    session_id: session.id,
    node_id: node.id,
  });
  await recordAiUsage(session.id, usage);

  // K5: mọi câu DROPPED ⇒ không tạo run, UI hiện "Thử lại"
  if (questions.every((q) => q.ended_by === "DROPPED")) {
    throw new ApiHttpError("ERR_AI_REJECTED");
  }

  const run = await createRun(
    session.id,
    node.id,
    req.mode,
    questions,
    createStepRefs(node.trace_steps),
    forbiddenKeywords(graph.fingerprint, nodeCodeText(node)),
  );
  return buildEnrichResponse(run, {
    node_state: state,
    tokens_used: session.tokens_used + usage.tokens_in + usage.tokens_out,
  });
}
