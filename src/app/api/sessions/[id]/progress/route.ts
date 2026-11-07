import type {
  NodeRunView,
  NodeStateView,
  ProgressResponse,
  RunMode,
  RunQuestion,
  SessionProgress,
} from "@/contracts";
import { deriveNodeStates, type NodeProgressRow } from "@/lib/derive";
import { authenticateRequest } from "@/server/auth";
import { sql } from "@/server/db";
import { toQuestionState } from "@/server/enrich";
import { toErrorResponse } from "@/server/errors";
import { verifySessionOwnership, type SessionRecord } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LastRunRow {
  id: string;
  node_id: string;
  mode: RunMode;
  questions: RunQuestion[] | string;
  started_at: string | number;
  finished_at: string | number | null;
}

// Bản tạm của getSessionProgress (TH-12): khi progress.ts có hàm này thì chuyển sang đó.
// Chỉ đọc DB: không engine, không AI (03 Mục 2, dòng 13).
async function buildSessionProgress(
  session: SessionRecord,
): Promise<SessionProgress> {
  const [progressRows, runRows] = await Promise.all([
    sql<NodeProgressRow[]>`
      select node_id, status, analysis_failed
      from node_progress
      where session_id = ${session.id}
    `,
    // Mỗi node 1 run: run đang mở trước, không có thì run mới nhất.
    sql<LastRunRow[]>`
      select distinct on (node_id)
        id, node_id, mode, questions,
        (extract(epoch from started_at) * 1000)::bigint as started_at,
        (extract(epoch from finished_at) * 1000)::bigint as finished_at
      from node_runs
      where session_id = ${session.id}
      order by node_id, (finished_at is null) desc, started_at desc
    `,
  ]);

  const lastRuns = new Map<string, NodeRunView>();
  for (const row of runRows) {
    const questions: RunQuestion[] =
      typeof row.questions === "string"
        ? (JSON.parse(row.questions) as RunQuestion[])
        : row.questions;
    lastRuns.set(row.node_id, {
      run_id: row.id,
      node_id: row.node_id,
      mode: row.mode,
      started_at: Number(row.started_at),
      finished_at: row.finished_at === null ? null : Number(row.finished_at),
      questions: questions.map(toQuestionState),
    });
  }

  const skeleton = session.graph_skeleton;
  const derived = deriveNodeStates(skeleton, progressRows);
  const nodes: Record<string, NodeStateView> = {};
  for (const [nodeId, state] of Object.entries(derived)) {
    nodes[nodeId] = { ...state, last_run: lastRuns.get(nodeId) ?? null };
  }

  return {
    session_id: session.id,
    nodes,
    tokens_used: session.tokens_used,
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await authenticateRequest(req);
    const { id } = await ctx.params;
    const session = await verifySessionOwnership(id, user.id);
    const progress = await buildSessionProgress(session);
    const body: ProgressResponse = { progress };
    return Response.json(body);
  } catch (error) {
    return toErrorResponse(error);
  }
}
