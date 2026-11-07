import { create } from "zustand";
import type {
  AnalyzeNodeResponse,
  ClientStaticEngineResult,
  ClientWorkbenchState,
  EnrichNodeResponse,
  EvaluateFeynmanResponse,
  ExplainSelectionResponse,
  IngestRequest,
  IngestResponse,
  ErrorCode,
  LearningSessionSummary,
  MeResponse,
  NodeStateView,
  PersonaMode,
  SkillChange,
  StaticEngineResult,
} from "@/contracts";
import {
  analyzeNodeSafe,
  enrichNodeSafe,
  evaluateFeynmanSafe,
  explainSelectionSafe,
  getMeSafe,
  getSessionProgressSafe,
  getSessionsSafe,
  ingestRepoSafe,
  revealSafe,
  switchPersonaSafe,
  type ApiResult,
} from "@/lib/api";
import { CONFIG } from "@/contracts/config";
import { deriveNodeStates } from "@/lib/derive";
import { formatErrorMessage } from "@/lib/messages";

// ---------- Kiểu của slice `ui` (docs/spec/30_UI.md Mục 7.1) ----------

export type XrayStage = "ROLE" | "TOUR" | "SUMMARY";
export type ActiveTab = ClientWorkbenchState["active_tab"];

export interface HighlightRange {
  step: number;
  line_start: number;
  line_end: number;
  kind: "FOCUS" | "GOOD" | "BAD";
}

export interface UiError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface UiToast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

export interface UiState {
  auth: "UNKNOWN" | "SIGNED_IN" | "SIGNED_OUT";
  user: { id: string; display_name: string | null } | null;
  boot_error: UiError | null;
  pending: Record<string, true>; // VD `enrich:{node_id}`, `submit:{run_id}:{question_index}`
  last_evaluations: Record<string, EvaluateFeynmanResponse>;
  attempt_log: Record<string, Array<{ answer: string; response: EvaluateFeynmanResponse }>>;
  last_changes: Record<string, SkillChange>;
  drafts: Record<string, string>;
  sessions: LearningSessionSummary[] | null;
  metrics: Record<string, number>;
  presentation: boolean;
  xray_stage: XrayStage;
  hl: HighlightRange[];
  return_question: boolean;
  open_groups: string[];
  explanations: Record<string, ExplainSelectionResponse>;
  offline_persona: PersonaMode;
  toasts: UiToast[];
  overview_open: boolean;
  ingest_error: UiError | null;
  ingesting: boolean;
  submit_error: UiError | null;
  newly_unlocked: string[];
  quota_stopped: boolean;
  fixture: boolean;
}

export interface WorkbenchActions {
  loadMe: (options?: { force?: boolean }) => Promise<ApiResult<MeResponse>>;
  loadSessions: () => Promise<void>;
  ingest: (req: IngestRequest | FormData) => Promise<ApiResult<IngestResponse>>;
  applyIngest: (res: IngestResponse) => void;
  resetSession: () => void;
  openNode: (nodeId: string) => void;
  requestAnalysis: (nodeId: string, retry?: boolean) => Promise<void>;
  loadRun: (nodeId: string) => Promise<void>;
  submitAnswer: (
    nodeId: string,
    questionIndex: number,
    answer: string,
  ) => Promise<ApiResult<EvaluateFeynmanResponse> | null>;
  skipQuestion: (nodeId: string, questionIndex: number) => Promise<void>;
  applyNodeState: (state: NodeStateView, unlockedNodeIds?: string[]) => void;
  refreshProgress: () => Promise<void>;
  setActiveStep: (step: number | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setXrayStage: (stage: XrayStage) => void;
  tourNext: () => void;
  tourPrev: () => void;
  openHintStep: (step: number) => void;
  setHl: (hl: HighlightRange[]) => void;
  setDraft: (key: string, text: string) => void;
  explainSelection: (
    nodeId: string,
    stepNumber: number,
    range: { line_start: number; col_start: number; line_end: number; col_end: number },
    selectedText: string,
  ) => Promise<ApiResult<ExplainSelectionResponse> | null>;
  setOfflineMode: (enabled: boolean) => void;
  setOfflinePersona: (p: PersonaMode) => void;
  switchPersona: (mode: PersonaMode) => Promise<ApiResult<MeResponse>>;
  pushToast: (text: string, kind?: UiToast["kind"]) => void;
  dismissToast: (id: number) => void;
}

export type WorkbenchStore = ClientWorkbenchState & { ui: UiState } & WorkbenchActions;

// ---------- Trạng thái đầu ----------

const initialUi = (): UiState => ({
  auth: "UNKNOWN",
  user: null,
  boot_error: null,
  pending: {},
  last_evaluations: {},
  attempt_log: {},
  last_changes: {},
  drafts: {},
  sessions: null,
  metrics: {},
  presentation: false,
  xray_stage: "ROLE",
  hl: [],
  return_question: false,
  open_groups: [],
  explanations: {},
  offline_persona: "NEWBIE",
  toasts: [],
  overview_open: false,
  ingest_error: null,
  ingesting: false,
  submit_error: null,
  newly_unlocked: [],
  quota_stopped: false,
  fixture: false,
});

/** Phần thuộc 1 phiên học: đổi phiên ⇒ xóa sạch (Mục 7.1). */
const emptySession = () => ({
  session_id: null as string | null,
  result: null as ClientWorkbenchState["result"],
  progress: null as ClientWorkbenchState["progress"],
  analyses: {} as ClientWorkbenchState["analyses"],
  overview: null as ClientWorkbenchState["overview"],
  runs: {} as ClientWorkbenchState["runs"],
  active_node_id: null as string | null,
  active_tab: "XRAY" as ActiveTab,
  active_question_index: null as number | null,
  active_step: null as number | null,
  last_failed_answers: {} as Record<string, string>,
});

const toUiError = (r: { code: ErrorCode; message: string; retryable: boolean }): UiError => ({
  code: r.code,
  message: r.message || formatErrorMessage(r.code),
  retryable: r.retryable,
});

const answerKey = (runId: string, questionIndex: number) => `${runId}:${questionIndex}`;
const FIRST_UNFINISHED = (run: EnrichNodeResponse): number | null =>
  run.questions.find((q) => !q.state.finished && q.state.ended_by !== "DROPPED")?.question_index ?? null;

let toastSeq = 1;
let mePromise: Promise<ApiResult<MeResponse>> | null = null;

/** `?fixture=1`: không gọi API. Dữ liệu fixture nối ở PH-03 (shop-api.json) và NH-02. */
function isFixtureMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("fixture") === "1";
}

const FIXTURE_NOT_READY: ApiResult<never> = {
  ok: false,
  code: "ERR_CLIENT_NETWORK",
  message: "Chế độ fixture chưa có dữ liệu cho thao tác này.",
  retryable: false,
};

function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

/**
 * Thứ tự tô-pô (Kahn), hòa theo `id` tăng dần (Mục 7.3). Có chu trình ⇒ phần còn lại nối theo `id`.
 * Dùng cho "1–2 bài kế tiếp" của hàng phân tích.
 */
export function topoOrderOf(nodes: Array<{ id: string; prerequisites: string[] }>): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    const parents = [...new Set(n.prerequisites)].filter((p) => ids.has(p) && p !== n.id);
    indegree.set(n.id, parents.length);
    for (const p of parents) children.set(p, [...(children.get(p) ?? []), n.id]);
  }
  const ready = [...ids].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const c of children.get(id) ?? []) {
      const left = (indegree.get(c) ?? 1) - 1;
      indegree.set(c, left);
      if (left === 0) {
        ready.push(c);
        ready.sort();
      }
    }
  }
  const seen = new Set(order);
  return [...order, ...[...ids].filter((id) => !seen.has(id)).sort()];
}

/** Số bài kế tiếp (sau bài đang mở) được tải trước, D-46. */
const ANALYZE_LOOKAHEAD = 2;

/** Bài đã có kết quả phân tích (bản đủ hoặc lỗi) thì không đưa vào hàng nữa. */
const analysisSettled = (a: ClientWorkbenchState["analyses"][string] | undefined) => a !== undefined && a !== "PENDING";

/** Một lời gọi `analyze-node` đang chờ hoặc đang chạy; `done` xong khi lời gọi kết thúc hoặc bị bỏ khỏi hàng. */
interface AnalysisJob {
  sessionId: string;
  nodeId: string;
  done: Promise<void>;
  finish: () => void;
}

function newAnalysisJob(sessionId: string, nodeId: string): AnalysisJob {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return { sessionId, nodeId, done, finish };
}

export const FIXTURE_SESSION_ID = "fixture-shop-api";
/** Chỉ để thấy đồng hồ quét chạy khi dùng fixture; server thật không dùng số này. */
const FIXTURE_INGEST_DELAY_MS = 1500;

/** Dựng `IngestResponse` từ `shop-api.json`, cùng hình dạng server trả (bỏ trường chỉ-server). */
async function buildFixtureIngest(): Promise<IngestResponse> {
  const { default: raw } = await import("@/server/engine/__fixtures__/shop-api.json");
  const full = raw as unknown as StaticEngineResult;
  const result: ClientStaticEngineResult = {
    ...omit(full, ["symbol_whitelist", "readme_excerpt", "manifest_description", "ingestion_report"]),
    ingestion_report: omit(full.ingestion_report, ["suspicious_instruction_files"]),
  };

  const derived = deriveNodeStates(
    result.nodes.map((n) => ({
      node_id: n.id,
      title: n.title,
      prerequisites: n.prerequisites,
      is_capstone: n.is_capstone,
    })),
    [],
  );
  const nodes: Record<string, NodeStateView> = {};
  for (const [id, s] of Object.entries(derived)) nodes[id] = { ...s, last_run: null };

  return {
    session_id: FIXTURE_SESSION_ID,
    result,
    progress: { session_id: FIXTURE_SESSION_ID, nodes, tokens_used: 0 },
    analyses: {},
    resumed: false,
    from_cache: false,
  };
}

export const useWorkbenchStore = create<WorkbenchStore>()((set, get) => {
  /** Chỉ nhận response nếu vẫn đang ở đúng phiên đã gửi (Mục 7.1). */
  const sameSession = (sessionId: string) => get().session_id === sessionId;

  const setPending = (key: string, on: boolean) =>
    set((s) => {
      const pending = { ...s.ui.pending };
      if (on) pending[key] = true;
      else delete pending[key];
      return { ui: { ...s.ui, pending } };
    });

  /** Mục 7.5: `node_state` → progress; `tokens_used` → progress. */
  const mergeNodeState = (state: NodeStateView, tokensUsed?: number) =>
    set((s) =>
      s.progress
        ? {
            progress: {
              ...s.progress,
              tokens_used: tokensUsed ?? s.progress.tokens_used,
              nodes: { ...s.progress.nodes, [state.node_id]: state },
            },
          }
        : {},
    );

  const applyProfile = (res: MeResponse) =>
    set((s) => ({
      profile: res.profile,
      server_clock_offset_ms: res.server_now - Date.now(),
      ui: {
        ...s.ui,
        auth: "SIGNED_IN",
        user: { id: res.profile.user_id, display_name: res.profile.display_name },
        boot_error: null,
      },
    }));

  /** Mục 7.5: có `skill_change` ⇒ làm mới hồ sơ bằng `GET /api/me`. */
  const afterAnswer = async (
    sessionId: string,
    r: { skill_change?: SkillChange | null; unlocked_node_ids: string[]; node_state: NodeStateView },
    statusBefore: NodeStateView["status"] | undefined,
  ) => {
    if (r.skill_change) void get().loadMe({ force: true });
    if (r.unlocked_node_ids.length > 0 || (statusBefore && statusBefore !== r.node_state.status)) {
      if (sameSession(sessionId)) {
        set((s) => ({ ui: { ...s.ui, newly_unlocked: r.unlocked_node_ids } }));
        await get().refreshProgress();
      }
    }
  };

  // ---- Hàng phân tích (Mục 7.3): hàng chờ + các lời gọi đang chạy, theo phiên ----
  let analysisQueue: AnalysisJob[] = [];
  const analysisRunning = new Map<string, AnalysisJob>();
  const analysisKey = (j: Pick<AnalysisJob, "sessionId" | "nodeId">) => `${j.sessionId}::${j.nodeId}`;

  /** Lấy việc từ đầu hàng cho tới khi đủ `CONFIG.ANALYZE_CONCURRENCY` lời gọi đang chạy của phiên hiện tại. */
  const pumpAnalysis = () => {
    const sessionId = get().session_id;
    // Mục của phiên khác không còn ý nghĩa: bỏ, trả lời các bên đang chờ.
    const stale = analysisQueue.filter((j) => j.sessionId !== sessionId);
    analysisQueue = analysisQueue.filter((j) => j.sessionId === sessionId);
    for (const job of stale) job.finish();
    if (!sessionId) return;

    const runningNow = () => [...analysisRunning.values()].filter((j) => j.sessionId === sessionId).length;
    while (analysisQueue.length > 0 && runningNow() < CONFIG.ANALYZE_CONCURRENCY && !get().ui.quota_stopped) {
      const job = analysisQueue.shift() as AnalysisJob;
      analysisRunning.set(analysisKey(job), job);
      void runAnalysis(job).finally(() => {
        analysisRunning.delete(analysisKey(job));
        job.finish();
        pumpAnalysis();
      });
    }
  };

  /** `ERR_TOKEN_QUOTA_EXCEEDED` ⇒ dừng hàng: bài đang chờ ⇒ `"FAILED"` (Mục 7.3). */
  const stopAnalysisQueue = (sessionId: string) => {
    const waiting = analysisQueue.filter((j) => j.sessionId === sessionId);
    analysisQueue = analysisQueue.filter((j) => j.sessionId !== sessionId);
    if (waiting.length > 0 && sameSession(sessionId)) {
      set((s) => {
        const analyses = { ...s.analyses };
        for (const job of waiting) if (analyses[job.nodeId] === "PENDING") analyses[job.nodeId] = "FAILED";
        return { analyses };
      });
    }
    for (const job of waiting) job.finish();
  };

  const runAnalysis = async ({ sessionId, nodeId }: AnalysisJob) => {
    const res = await analyzeNodeSafe(sessionId, nodeId);
    if (!sameSession(sessionId)) return;

    if (!res.ok) {
      // Lỗi khác hạn mức ⇒ chỉ bài này `"FAILED"`, hàng chạy tiếp.
      const quota = res.code === "ERR_TOKEN_QUOTA_EXCEEDED";
      set((s) => ({
        analyses: { ...s.analyses, [nodeId]: "FAILED" },
        ui: { ...s.ui, quota_stopped: s.ui.quota_stopped || quota },
      }));
      if (quota) stopAnalysisQueue(sessionId);
      return;
    }
    const data: AnalyzeNodeResponse = res.data;
    const before = get().progress?.nodes[nodeId]?.status;
    set((s) => ({ analyses: { ...s.analyses, [nodeId]: data.analysis ?? "FAILED" } }));
    mergeNodeState(data.node_state, data.tokens_used);
    await afterAnswer(sessionId, { ...data, skill_change: null }, before);
    // Phân tích về sau khi người học đã mở bài ⇒ gọi `enrich-node` (7.4 bước 2).
    if (get().active_node_id === nodeId && data.analysis) void get().loadRun(nodeId);
  };

  return {
    ...emptySession(),
    profile: null,
    is_offline_mode: false,
    server_clock_offset_ms: 0,
    ui: initialUi(),

    // ---- Hồ sơ, danh sách phiên ----
    loadMe: (options) => {
      if (mePromise) return mePromise; // đang chờ ⇒ trả lại đúng promise đó
      const { profile, server_clock_offset_ms } = get();
      if (profile && !options?.force) {
        return Promise.resolve({ ok: true, data: { profile, server_now: Date.now() + server_clock_offset_ms } });
      }
      if (get().ui.fixture) return Promise.resolve(FIXTURE_NOT_READY);

      mePromise = getMeSafe()
        .then((res) => {
          if (res.ok) {
            applyProfile(res.data);
          } else if (res.code === "ERR_UNAUTHENTICATED") {
            set((s) => ({ ui: { ...s.ui, auth: "SIGNED_OUT", boot_error: null } }));
          } else {
            set((s) => ({ ui: { ...s.ui, boot_error: toUiError(res) } }));
          }
          return res;
        })
        .finally(() => {
          mePromise = null;
        });
      return mePromise;
    },

    loadSessions: async () => {
      if (get().ui.fixture) return;
      const res = await getSessionsSafe();
      if (res.ok) set((s) => ({ ui: { ...s.ui, sessions: res.data.sessions } }));
      else if (res.code === "ERR_UNAUTHENTICATED") set((s) => ({ ui: { ...s.ui, auth: "SIGNED_OUT" } }));
    },

    // ---- Nạp repo ----
    ingest: async (req) => {
      set((s) => ({ ui: { ...s.ui, ingesting: true, ingest_error: null } }));
      let res: ApiResult<IngestResponse>;
      if (get().ui.fixture) {
        // `?fixture=1`: không gọi API, trả bản đồ shop-api sau một khoảng ngắn để thấy đồng hồ quét.
        await new Promise((resolve) => setTimeout(resolve, FIXTURE_INGEST_DELAY_MS));
        res = { ok: true, data: await buildFixtureIngest() };
      } else {
        res = await ingestRepoSafe(req);
      }
      if (res.ok) get().applyIngest(res.data);
      else set((s) => ({ ui: { ...s.ui, ingesting: false, ingest_error: toUiError(res) } }));
      return res;
    },

    applyIngest: (res) =>
      set((s) => ({
        ...emptySession(),
        session_id: res.session_id,
        result: res.result,
        progress: res.progress,
        analyses: res.analyses,
        overview: null,
        runs: {},
        ui: {
          ...s.ui,
          ingesting: false,
          ingest_error: null,
          xray_stage: "ROLE",
          hl: [],
          return_question: false,
          submit_error: null,
          newly_unlocked: [],
          quota_stopped: false,
          last_evaluations: {},
          attempt_log: {},
          last_changes: {},
          explanations: {},
          metrics: {
            ingest_ms: res.result.ingestion_report.ingest_ms,
            engine_ms: res.result.ingestion_report.engine_ms,
          },
        },
      })),

    resetSession: () =>
      set((s) => ({
        ...emptySession(),
        ui: { ...s.ui, xray_stage: "ROLE", hl: [], return_question: false, submit_error: null, newly_unlocked: [] },
      })),

    // ---- Bấm node (Mục 7.4) ----
    openNode: (nodeId) => {
      const s = get();
      const node = s.progress?.nodes[nodeId];
      if (!s.result || node?.status === "LOCKED") return;
      const groupId = s.result.nodes.find((n) => n.id === nodeId)?.group_id;
      set({
        active_node_id: nodeId,
        active_step: 1,
        active_question_index: null,
        active_tab: "XRAY",
        ui: {
          ...s.ui,
          xray_stage: "ROLE",
          hl: [],
          return_question: false,
          submit_error: null,
          overview_open: false,
          open_groups: groupId && !s.ui.open_groups.includes(groupId) ? [...s.ui.open_groups, groupId] : s.ui.open_groups,
        },
      });
      const analysis = get().analyses[nodeId];
      if (!analysis) void get().requestAnalysis(nodeId);
      else if (analysis !== "PENDING" && analysis !== "FAILED") void get().loadRun(nodeId);
    },

    /**
     * Hàng phân tích (Mục 7.3, D-46): chỉ bài `nodeId` và 1–2 bài kế tiếp theo thứ tự tô-pô, tối đa
     * `CONFIG.ANALYZE_CONCURRENCY` lời gọi `analyzeNodeSafe` cùng lúc. Bài vào hàng ⇒ `"PENDING"`.
     * Gọi lại với bài khác ⇒ chuyển ưu tiên: bài chưa chạy mà không còn trong nhóm ưu tiên bị bỏ khỏi hàng
     * (hết nhãn). `retry` ("Thử lại phân tích") đưa bài `"FAILED"` lên đầu hàng. Trả về khi bài `nodeId` xong.
     */
    requestAnalysis: (nodeId, retry) => {
      const { session_id: sessionId, ui, analyses, result } = get();
      if (!sessionId || ui.fixture || ui.quota_stopped) return Promise.resolve();

      const own = analyses[nodeId];
      const wantsOwn = own === undefined || own === "PENDING" || (retry === true && own === "FAILED");
      const topo = result ? topoOrderOf(result.nodes) : [];
      const after = topo.indexOf(nodeId) >= 0 ? topo.slice(topo.indexOf(nodeId) + 1) : [];
      const next = after.filter((id) => !analysisSettled(analyses[id])).slice(0, ANALYZE_LOOKAHEAD);
      const wanted = [...(wantsOwn ? [nodeId] : []), ...next];
      const wantedSet = new Set(wanted);

      // Chuyển ưu tiên: mục của phiên khác hoặc không còn được cần ⇒ bỏ khỏi hàng.
      const kept = new Map<string, AnalysisJob>();
      const dropped: AnalysisJob[] = [];
      for (const job of analysisQueue) {
        if (job.sessionId === sessionId && wantedSet.has(job.nodeId)) kept.set(job.nodeId, job);
        else dropped.push(job);
      }
      analysisQueue = [];
      let ownJob: AnalysisJob | undefined;
      for (const id of wanted) {
        const running = analysisRunning.get(analysisKey({ sessionId, nodeId: id }));
        if (running) {
          if (id === nodeId) ownJob = running;
          continue;
        }
        const job = kept.get(id) ?? newAnalysisJob(sessionId, id);
        analysisQueue.push(job);
        if (id === nodeId) ownJob = job;
      }

      set((s) => {
        const updated = { ...s.analyses };
        for (const job of dropped) {
          if (job.sessionId === sessionId && updated[job.nodeId] === "PENDING" && !analysisRunning.has(analysisKey(job))) {
            delete updated[job.nodeId];
          }
        }
        for (const job of analysisQueue) updated[job.nodeId] = "PENDING";
        return { analyses: updated };
      });
      for (const job of dropped) job.finish();

      pumpAnalysis();
      return ownJob?.done ?? Promise.resolve();
    },


    loadRun: async (nodeId) => {
      const { session_id: sessionId, ui, runs, analyses, progress } = get();
      const key = `enrich:${nodeId}`;
      if (!sessionId || ui.fixture || ui.pending[key]) return;
      const analysis = analyses[nodeId];
      if (!analysis || analysis === "PENDING" || analysis === "FAILED") return;
      const state = progress?.nodes[nodeId];
      const openRun = runs[nodeId] && runs[nodeId].questions.some((q) => !q.state.finished);
      const needRun = !openRun && (state?.status === "AVAILABLE" || state?.last_run?.finished_at === null);
      if (!needRun) return;

      setPending(key, true);
      const res = await enrichNodeSafe(sessionId, nodeId, "LEARN");
      setPending(key, false);
      if (!sameSession(sessionId)) return;
      if (!res.ok) {
        set((s) => ({ ui: { ...s.ui, submit_error: toUiError(res) } }));
        return;
      }
      set((s) => ({
        runs: { ...s.runs, [nodeId]: res.data },
        active_question_index: s.active_node_id === nodeId ? FIRST_UNFINISHED(res.data) : s.active_question_index,
      }));
      mergeNodeState(res.data.node_state, res.data.tokens_used);
    },

    // ---- Nộp / bỏ qua câu (Mục 7.5) ----
    submitAnswer: async (nodeId, questionIndex, answer) => {
      const { session_id: sessionId, runs, ui } = get();
      const run = runs[nodeId];
      if (!sessionId || !run || ui.fixture) return null;
      const question = run.questions.find((q) => q.question_index === questionIndex);
      if (!question) return null;

      const key = answerKey(run.run_id, questionIndex);
      setPending(`submit:${key}`, true);
      set((s) => ({ ui: { ...s.ui, submit_error: null } }));
      const before = get().progress?.nodes[nodeId]?.status;
      const res = await evaluateFeynmanSafe({
        session_id: sessionId,
        run_id: run.run_id,
        question_index: questionIndex,
        student_answer: answer,
        attempt_number: question.state.attempts_used + 1,
      });
      setPending(`submit:${key}`, false);
      if (!sameSession(sessionId)) return null;

      if (!res.ok) {
        set((s) => ({ ui: { ...s.ui, submit_error: toUiError(res) } }));
        if (res.code === "ERR_ATTEMPT_OUT_OF_SYNC" || res.code === "ERR_QUESTION_FINISHED") {
          get().pushToast("Câu này vừa được nộp ở tab khác", "info");
          void get().loadRun(nodeId);
        }
        return res;
      }

      const r = res.data;
      set((s) => ({
        runs: {
          ...s.runs,
          [nodeId]: {
            ...run,
            questions: run.questions.map((q) => (q.question_index === questionIndex ? { ...q, state: r.question } : q)),
          },
        },
        last_failed_answers: r.is_passed
          ? s.last_failed_answers
          : { ...s.last_failed_answers, [key]: answer },
        ui: {
          ...s.ui,
          last_evaluations: { ...s.ui.last_evaluations, [key]: r },
          attempt_log: { ...s.ui.attempt_log, [key]: [...(s.ui.attempt_log[key] ?? []), { answer, response: r }] },
          last_changes: r.skill_change ? { ...s.ui.last_changes, [key]: r.skill_change } : s.ui.last_changes,
        },
      }));
      mergeNodeState(r.node_state, r.tokens_used);
      await afterAnswer(sessionId, r, before);
      return res;
    },

    skipQuestion: async (nodeId, questionIndex) => {
      const { session_id: sessionId, runs, ui } = get();
      const run = runs[nodeId];
      if (!sessionId || !run || ui.fixture) return;
      const key = answerKey(run.run_id, questionIndex);
      const before = get().progress?.nodes[nodeId]?.status;

      setPending(`submit:${key}`, true);
      const res = await revealSafe({ session_id: sessionId, run_id: run.run_id, question_index: questionIndex });
      setPending(`submit:${key}`, false);
      if (!sameSession(sessionId)) return;

      if (!res.ok) {
        set((s) => ({ ui: { ...s.ui, submit_error: toUiError(res) } }));
        if (res.code === "ERR_QUESTION_FINISHED") void get().loadRun(nodeId);
        return;
      }
      const r = res.data;
      set((s) => ({
        runs: {
          ...s.runs,
          [nodeId]: {
            ...run,
            questions: run.questions.map((q) => (q.question_index === questionIndex ? { ...q, state: r.question } : q)),
          },
        },
        ui: { ...s.ui, last_changes: { ...s.ui.last_changes, [key]: r.skill_change } },
      }));
      mergeNodeState(r.node_state);
      await afterAnswer(sessionId, r, before);
    },

    applyNodeState: (state, unlockedNodeIds = []) => {
      mergeNodeState(state);
      if (unlockedNodeIds.length > 0) {
        set((s) => ({ ui: { ...s.ui, newly_unlocked: unlockedNodeIds } }));
        void get().refreshProgress();
      }
    },

    refreshProgress: async () => {
      const { session_id: sessionId, ui } = get();
      if (!sessionId || ui.fixture) return;
      const res = await getSessionProgressSafe(sessionId);
      if (res.ok && sameSession(sessionId)) set({ progress: res.data.progress });
    },

    // ---- Điều khiển giao diện ----
    setActiveStep: (step) => set({ active_step: step }),
    setActiveTab: (tab) => set({ active_tab: tab }),
    setXrayStage: (stage) => set((s) => ({ ui: { ...s.ui, xray_stage: stage } })),

    tourNext: () => {
      const { ui, active_step, active_node_id, result } = get();
      const total = result?.nodes.find((n) => n.id === active_node_id)?.trace_steps.length ?? 0;
      if (ui.xray_stage === "ROLE") {
        set({ active_step: 1, ui: { ...ui, xray_stage: "TOUR" } });
      } else if (ui.xray_stage === "TOUR") {
        const step = active_step ?? 1;
        if (step >= total) set({ ui: { ...ui, xray_stage: "SUMMARY" } });
        else set({ active_step: step + 1 });
      }
    },

    tourPrev: () => {
      const { ui, active_step } = get();
      if (ui.xray_stage === "SUMMARY") {
        const total = get().result?.nodes.find((n) => n.id === get().active_node_id)?.trace_steps.length ?? 1;
        set({ active_step: total, ui: { ...ui, xray_stage: "TOUR" } });
      } else if (ui.xray_stage === "TOUR") {
        const step = active_step ?? 1;
        if (step <= 1) set({ ui: { ...ui, xray_stage: "ROLE" } });
        else set({ active_step: step - 1 });
      }
    },

    /** UI-32b: "Mở Bước {n} trong tour" từ gợi ý `CODE_POINTER`. */
    openHintStep: (step) =>
      set((s) => ({
        active_tab: "XRAY",
        active_step: step,
        ui: { ...s.ui, xray_stage: "TOUR", return_question: true },
      })),

    setHl: (hl) => set((s) => ({ ui: { ...s.ui, hl } })),
    setDraft: (key, text) => set((s) => ({ ui: { ...s.ui, drafts: { ...s.ui.drafts, [key]: text } } })),

    explainSelection: async (nodeId, stepNumber, range, selectedText) => {
      const { session_id: sessionId, ui } = get();
      if (!sessionId || ui.fixture) return null;
      const res = await explainSelectionSafe({
        session_id: sessionId,
        node_id: nodeId,
        step_number: stepNumber,
        range,
        selected_text: selectedText,
      });
      if (!sameSession(sessionId)) return null;
      if (res.ok) {
        const key = `${nodeId}:${stepNumber}:${range.line_start}:${range.col_start}:${range.line_end}:${range.col_end}`;
        set((s) => ({
          ui: { ...s.ui, explanations: { ...s.ui.explanations, [key]: res.data } },
          progress: s.progress
            ? { ...s.progress, tokens_used: res.data.tokens_used }
            : s.progress,
        }));
      }
      return res;
    },

    // ---- Offline, persona ----
    setOfflineMode: (enabled) => {
      // Tắt Offline ⇒ xóa store, chạy lại khởi động (Mục 8). Dữ liệu bundle nối ở PH-12 / NH-10.
      set((s) => ({ ...emptySession(), profile: null, is_offline_mode: enabled, ui: { ...initialUi(), offline_persona: s.ui.offline_persona } }));
    },

    setOfflinePersona: (p) =>
      set((s) => ({
        runs: {},
        active_node_id: null,
        ui: { ...s.ui, offline_persona: p },
      })),

    switchPersona: async (mode) => {
      const res = await switchPersonaSafe(mode);
      if (res.ok) {
        applyProfile(res.data);
      } else if (res.code === "ERR_DEMO_MODE_DISABLED") {
        get().pushToast(formatErrorMessage(res.code, res.message), "error");
      }
      return res;
    },

    // ---- Toast ----
    pushToast: (text, kind = "info") =>
      set((s) => ({ ui: { ...s.ui, toasts: [...s.ui.toasts, { id: toastSeq++, kind, text }] } })),
    dismissToast: (id) => set((s) => ({ ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) } })),
  };
});

/** Gọi 1 lần ở `Boot` khi URL có `?fixture=1`. */
export function enableFixtureModeFromUrl(): boolean {
  if (!isFixtureMode()) return false;
  useWorkbenchStore.setState((s) => ({ ui: { ...s.ui, fixture: true } }));
  return true;
}
