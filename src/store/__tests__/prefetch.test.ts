import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalyzeNodeResponse,
  ClientStaticEngineResult,
  EnrichNodeResponse,
  IngestResponse,
  NodeStateView,
} from "@/contracts";
import { analyzeNodeSafe, enrichNodeSafe, ingestRepoSafe } from "@/lib/api";
import { useWorkbenchStore } from "../workbench";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  analyzeNodeSafe: vi.fn(),
  enrichNodeSafe: vi.fn(),
  ingestRepoSafe: vi.fn(),
}));

const analyze = vi.mocked(analyzeNodeSafe);
const enrich = vi.mocked(enrichNodeSafe);
const ingestApi = vi.mocked(ingestRepoSafe);

// n1, n2, n4, n5 mở khóa; n3 bị khóa (cần n1). Thứ tự tô-pô: n1, n2, n3, n4, n5.
const SPEC: Array<{ id: string; prerequisites: string[]; status: NodeStateView["status"] }> = [
  { id: "n1", prerequisites: [], status: "AVAILABLE" },
  { id: "n2", prerequisites: [], status: "AVAILABLE" },
  { id: "n3", prerequisites: ["n1"], status: "LOCKED" },
  { id: "n4", prerequisites: [], status: "AVAILABLE" },
  { id: "n5", prerequisites: [], status: "AVAILABLE" },
];

const stateOf = (nodeId: string, status: NodeStateView["status"]) =>
  ({ node_id: nodeId, status, last_run: null }) as unknown as NodeStateView;

let sessionSeq = 0;
const nextSession = () => `p${++sessionSeq}`;

function ingestResponse(sessionId: string, statuses?: Record<string, NodeStateView["status"]>): IngestResponse {
  const nodes: Record<string, NodeStateView> = {};
  for (const n of SPEC) nodes[n.id] = stateOf(n.id, statuses?.[n.id] ?? n.status);
  return {
    session_id: sessionId,
    result: {
      nodes: SPEC.map((n) => ({ id: n.id, prerequisites: n.prerequisites })),
      edges: [],
      groups: [],
      ingestion_report: { ingest_ms: 1, engine_ms: 1 },
    } as unknown as ClientStaticEngineResult,
    progress: { session_id: sessionId, nodes, tokens_used: 0 },
    analyses: {},
    resumed: false,
    from_cache: false,
  };
}

function analyzeResponse(nodeId: string, status: NodeStateView["status"] = "AVAILABLE") {
  const data: AnalyzeNodeResponse = {
    node_id: nodeId,
    analysis: { node_id: nodeId } as never,
    node_state: stateOf(nodeId, status),
    unlocked_node_ids: [],
    tokens_used: 1,
  };
  return { ok: true as const, data };
}

function enrichResponse(nodeId: string) {
  const data: EnrichNodeResponse = {
    node_id: nodeId,
    run_id: `run-${nodeId}`,
    mode: "LEARN",
    questions: [{ question_index: 1, state: { finished: false, ended_by: null, attempts_used: 0 } }] as never,
    node_state: stateOf(nodeId, "AVAILABLE"),
    tokens_used: 2,
  };
  return { ok: true as const, data };
}

/** Lời gọi `analyze-node` treo cho tới khi test gọi `resolve`. */
interface Call {
  nodeId: string;
  resolve: () => void;
}
let calls: Call[];

const tick = () => new Promise((r) => setTimeout(r, 0));
const analyzedIds = () => analyze.mock.calls.map((c) => c[1]);

beforeEach(() => {
  calls = [];
  analyze.mockReset();
  enrich.mockReset();
  ingestApi.mockReset();
  analyze.mockImplementation(
    (_sessionId, nodeId) =>
      new Promise((resolve) => {
        calls.push({ nodeId, resolve: () => resolve(analyzeResponse(nodeId)) });
      }),
  );
  enrich.mockImplementation((_sessionId, nodeId) => Promise.resolve(enrichResponse(nodeId)));
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
});

async function ingestOk(statuses?: Record<string, NodeStateView["status"]>) {
  const sessionId = nextSession();
  ingestApi.mockResolvedValue({ ok: true, data: ingestResponse(sessionId, statuses) });
  await useWorkbenchStore.getState().ingest({ repo_url: "https://github.com/a/b" });
  await tick();
  return sessionId;
}

describe("tính trước sau khi quét repo", () => {
  it("ingest ok ⇒ đúng 3 lời gọi analyze-node cho 3 bài AVAILABLE đầu, không có bài LOCKED", async () => {
    await ingestOk();

    expect(analyzedIds()).toEqual(["n1", "n2", "n4"]);
    expect(analyzedIds()).not.toContain("n3");
    expect(analyzedIds()).not.toContain("n5"); // quá 3 bài
    const { analyses } = useWorkbenchStore.getState();
    expect(analyses.n1).toBe("PENDING");
    expect(analyses.n3).toBeUndefined();
  });

  it("không có bài nào mở khóa ⇒ 0 lời gọi", async () => {
    await ingestOk({ n1: "LOCKED", n2: "LOCKED", n4: "LOCKED", n5: "LOCKED" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("ingest lỗi ⇒ 0 lời gọi", async () => {
    ingestApi.mockResolvedValue({ ok: false, code: "ERR_SESSION_NOT_FOUND", message: "lỗi", retryable: false });
    await useWorkbenchStore.getState().ingest({ repo_url: "https://github.com/a/b" });
    await tick();
    expect(analyze).not.toHaveBeenCalled();
  });
});
