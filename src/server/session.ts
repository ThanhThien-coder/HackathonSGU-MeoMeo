import { CONFIG } from "@/contracts";
import type {
  GraphSkeletonNode,
  RunMode,
  RunQuestion,
  RunStepRef,
  StaticEngineResult,
} from "@/contracts";
import { getEngineResultCache, setEngineResultCache } from "./cache";
import { sql } from "./db";
import { ApiHttpError } from "./errors";
import { logger } from "./log";

export interface SessionRecord {
  id: string;
  user_id: string;
  source: "GITHUB" | "ZIP";
  repo_key: string;
  snapshot_id: string;
  snapshot_id_kind: "COMMIT_SHA" | "ARCHIVE_HASH";
  subdir: string;
  ref_label: string | null;
  repo_name: string;
  engine_version: string;
  graph_skeleton: GraphSkeletonNode[];
  tokens_used: number;
  explain_count: number;
  created_at: Date;
  last_active_at: Date;
}

export interface RunRecord {
  id: string;
  session_id: string;
  node_id: string;
  mode: RunMode;
  questions: RunQuestion[];
  steps: RunStepRef[];
  forbidden_external_keywords: string[];
  started_at: Date;
  finished_at: Date | null;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export async function verifySessionOwnership(
  sessionId: string,
  userId: string,
): Promise<SessionRecord> {
  if (!isUuid(sessionId) || !isUuid(userId)) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }

  const rows = await sql<SessionRecord[]>`
    select * from learning_sessions where id = ${sessionId} and user_id = ${userId}
  `;
  if (rows.length === 0) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }

  const session = rows[0];
  if (typeof session.graph_skeleton === "string") {
    session.graph_skeleton = JSON.parse(
      session.graph_skeleton,
    ) as GraphSkeletonNode[];
  }
  return session;
}

export async function verifyRunOwnership(
  runId: string,
  userId: string,
): Promise<{ run: RunRecord; session: SessionRecord }> {
  if (!isUuid(runId) || !isUuid(userId)) {
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }

  const rows = await sql<RunRecord[]>`
    select * from node_runs where id = ${runId}
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

  const session = await verifySessionOwnership(run.session_id, userId);
  return { run, session };
}

export async function getSessionStaticResult(
  sessionOrId: SessionRecord | string,
  userId: string,
): Promise<StaticEngineResult> {
  let session: SessionRecord;
  if (typeof sessionOrId === "string") {
    session = await verifySessionOwnership(sessionOrId, userId);
  } else {
    if (sessionOrId.user_id !== userId) {
      throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
    }
    session = sessionOrId;
  }

  if (session.engine_version !== CONFIG.ENGINE_VERSION) {
    throw new ApiHttpError("ERR_SESSION_ENGINE_OUTDATED");
  }

  const cached = getEngineResultCache(
    session.snapshot_id,
    session.subdir,
    session.engine_version,
  );
  if (cached) {
    return cached;
  }

  const rows = await sql<Array<{ result: StaticEngineResult | string }>>`
    select result from session_snapshots where session_id = ${session.id}
  `;
  if (rows.length === 0) {
    logger.error({ event: "session_snapshot_missing", session_id: session.id });
    throw new ApiHttpError("ERR_SESSION_NOT_FOUND");
  }

  let result = rows[0].result;
  if (typeof result === "string") {
    result = JSON.parse(result) as StaticEngineResult;
  }

  setEngineResultCache(
    session.snapshot_id,
    session.subdir,
    session.engine_version,
    result,
  );
  return result;
}

export function toGraphSkeleton(
  result: StaticEngineResult,
): GraphSkeletonNode[] {
  return result.nodes.map((n) => ({
    node_id: n.id,
    title: n.title,
    prerequisites: n.prerequisites,
    is_capstone: n.is_capstone,
  }));
}
