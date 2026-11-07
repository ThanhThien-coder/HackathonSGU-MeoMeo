import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CONFIG } from "../src/contracts/config";
import type {
  AnalyzeNodeRequest,
  AnalyzeNodeResponse,
  ClientStaticEngineResult,
  EnrichNodeRequest,
  EnrichNodeResponse,
  EvaluateFeynmanRequest,
  EvaluateFeynmanResponse,
  IngestRequest,
  IngestResponse,
  NodeAnalysisView,
  OfflineMockBundle,
  PersonaMode,
  RepoOverviewView,
  RevealRequest,
  RevealResponse,
} from "../src/contracts";

interface CliOptions {
  baseUrl: string;
  repoUrl: string;
  persona: PersonaMode;
  answersFile?: string;
  nodes?: string[];
  outFile: string;
}

export class ScriptApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(`[${path}] HTTP ${status} (${code}): ${message}`);
    this.name = "ScriptApiError";
  }
}

const RETRYABLE_CODES = new Set([
  "ERR_AI_UNAVAILABLE",
  "ERR_AI_REJECTED",
  "ERR_PERSISTENCE_UNAVAILABLE",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function call<T>(
  baseUrl: string,
  token: string,
  endpoint: string,
  body: unknown
): Promise<T> {
  const url = `${baseUrl}${endpoint}`;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      const errMsg = netErr instanceof Error ? netErr.message : String(netErr);
      console.error(`${endpoint} network failure: ${errMsg}`);
      if (attempt < maxRetries) {
        console.log(
          `Đang thử lại sau 2 giây (lần ${attempt + 1}/${maxRetries})...`
        );
        await sleep(2000);
        continue;
      }
      throw new Error(`Không thể kết nối tới ${endpoint}: ${errMsg}`);
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    let code = "UNKNOWN_ERROR";
    let message = res.statusText || "Request failed";
    try {
      const errJson = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (errJson?.error?.code) {
        code = errJson.error.code;
      }
      if (errJson?.error?.message) {
        message = errJson.error.message;
      }
    } catch {
      // Bỏ qua lỗi parse JSON body
    }

    console.error(`${endpoint} status ${res.status}: ${code} - ${message}`);

    if (RETRYABLE_CODES.has(code) && attempt < maxRetries) {
      console.log(
        `Gặp lỗi có thể thử lại (${code}), chờ 2 giây trước khi gọi lại (lần ${attempt + 1}/${maxRetries})...`
      );
      await sleep(2000);
      continue;
    }

    throw new ScriptApiError(endpoint, res.status, code, message);
  }

  throw new Error(
    `Không thể hoàn thành yêu cầu tới ${endpoint} sau ${maxRetries} lần thử lại.`
  );
}

function parseCliArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  let persona: PersonaMode = "NEWBIE";
  let answersFile: string | undefined;
  let nodes: string[] | undefined;
  let outFile = "public/demo/mock_bundle.json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--persona") {
      const val = argv[++i];
      if (val !== "NEWBIE" && val !== "MID_LEVEL" && val !== "SENIOR_RUSTY") {
        console.error(
          `Lỗi: Persona không hợp lệ "${val}". Chỉ chấp nhận: NEWBIE, MID_LEVEL, SENIOR_RUSTY.`
        );
        process.exit(1);
      }
      persona = val;
    } else if (arg.startsWith("--persona=")) {
      const val = arg.slice("--persona=".length);
      if (val !== "NEWBIE" && val !== "MID_LEVEL" && val !== "SENIOR_RUSTY") {
        console.error(
          `Lỗi: Persona không hợp lệ "${val}". Chỉ chấp nhận: NEWBIE, MID_LEVEL, SENIOR_RUSTY.`
        );
        process.exit(1);
      }
      persona = val;
    } else if (arg === "--answers") {
      answersFile = argv[++i];
    } else if (arg.startsWith("--answers=")) {
      answersFile = arg.slice("--answers=".length);
    } else if (arg === "--nodes") {
      const val = argv[++i];
      if (val) {
        nodes = val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } else if (arg.startsWith("--nodes=")) {
      const val = arg.slice("--nodes=".length);
      nodes = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--out") {
      outFile = argv[++i];
    } else if (arg.startsWith("--out=")) {
      outFile = arg.slice("--out=".length);
    } else if (arg.startsWith("-")) {
      console.warn(`Cảnh báo: Tham số không nhận diện: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length < 2) {
    console.error(
      "Cách dùng: npx tsx scripts/record-bundle.ts <base-url> <repo-url> [--persona NEWBIE|MID_LEVEL|SENIOR_RUSTY] [--answers <file>] [--nodes N1,N2] [--out public/demo/mock_bundle.json]"
    );
    process.exit(1);
  }

  const baseUrl = positional[0].replace(/\/+$/, "");
  const repoUrl = positional[1];

  return {
    baseUrl,
    repoUrl,
    persona,
    answersFile,
    nodes,
    outFile,
  };
}

function buildMinimalOverview(result: ClientStaticEngineResult): RepoOverviewView {
  const rootNodeIds = result.nodes
    .filter((n) => n.prerequisites.length === 0)
    .map((n) => n.id);
  const root_node_ids =
    rootNodeIds.length > 0
      ? rootNodeIds
      : result.nodes.slice(0, 1).map((n) => n.id);

  const capstone = result.nodes.find((n) => n.is_capstone);
  const main_path_node_ids = capstone
    ? Array.from(new Set([root_node_ids[0], capstone.id].filter(Boolean)))
    : root_node_ids.slice(0, 6);

  return {
    facts: {
      archetype: result.fingerprint?.archetype ?? "WEB_BACKEND",
      framework: result.fingerprint?.detected_framework ?? null,
      tech_stack: result.fingerprint?.tech_stack ?? [],
      root_node_ids,
      main_path_node_ids,
    },
    ai: null,
  };
}

type AnswersMap = Record<string, string[]>;

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  const token = process.env.SF_DEMO_TOKEN;
  if (!token || token.trim() === "") {
    console.error("Lỗi: Thiếu biến môi trường SF_DEMO_TOKEN.");
    console.error("Vui lòng thiết lập access token Supabase của tài khoản demo:");
    console.error('  Linux/macOS: export SF_DEMO_TOKEN="<token>"');
    console.error('  Windows pwsh: $env:SF_DEMO_TOKEN="<token>"');
    process.exit(1);
  }

  let answersMap: AnswersMap = {};
  if (options.answersFile) {
    try {
      const raw = await fs.readFile(options.answersFile, "utf8");
      answersMap = JSON.parse(raw) as AnswersMap;
      console.log(`Đã nạp file kịch bản trả lời từ: ${options.answersFile}`);
    } catch (err) {
      console.error(
        `Không thể đọc file answers tại ${options.answersFile}:`,
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }
  }

  console.log(`Bắt đầu Ingest repository: ${options.repoUrl}`);
  const ingest = await call<IngestResponse>(
    options.baseUrl,
    token,
    "/api/ingest",
    {
      repo_url: options.repoUrl,
    } satisfies IngestRequest
  );

  const sessionId = ingest.session_id;
  console.log(`Ingest thành công. Session ID: ${sessionId}`);

  const allNodeIds = ingest.result.nodes.map((n) => n.id);
  const targetNodeIds =
    options.nodes && options.nodes.length > 0
      ? options.nodes.filter((id) => allNodeIds.includes(id))
      : allNodeIds;

  if (options.nodes && options.nodes.length > 0) {
    const unknownNodes = options.nodes.filter(
      (id) => !allNodeIds.includes(id)
    );
    if (unknownNodes.length > 0) {
      console.warn(
        `Cảnh báo: Các node sau không tìm thấy trong kết quả ingest: ${unknownNodes.join(", ")}`
      );
    }
  }

  console.log(
    `Tổng node cần xử lý: ${targetNodeIds.length} / ${allNodeIds.length} node`
  );

  const analyses: Record<string, NodeAnalysisView> = {
    ...(ingest.analyses ?? {}),
  };
  const enrich: Record<string, EnrichNodeResponse> = {};
  const scripted_answers: Record<
    string,
    Array<{ answer: string; response: EvaluateFeynmanResponse }>
  > = {};
  const reveals: Record<string, RevealResponse> = {};

  let processedNodesCount = 0;
  let skippedNodesCount = 0;
  let recordedRunsCount = 0;
  let scriptedAnswersCount = 0;
  let revealsCount = 0;

  for (const nodeId of targetNodeIds) {
    console.log(`\n--- [Node ${nodeId}] ---`);

    // 1. Phân tích node
    try {
      const analyzeRes = await call<AnalyzeNodeResponse>(
        options.baseUrl,
        token,
        "/api/analyze-node",
        {
          session_id: sessionId,
          node_id: nodeId,
        } satisfies AnalyzeNodeRequest
      );
      if (analyzeRes.analysis !== null) {
        analyses[nodeId] = analyzeRes.analysis;
        console.log(`  Phân tích node ${nodeId} thành công.`);
      } else {
        console.warn(`  Phân tích node ${nodeId} trả về null.`);
      }
    } catch (err) {
      console.warn(
        `  Lỗi khi gọi /api/analyze-node (${nodeId}):`,
        err instanceof Error ? err.message : String(err)
      );
    }

    // 2. Enrich node
    let enrichRes: EnrichNodeResponse;
    try {
      enrichRes = await call<EnrichNodeResponse>(
        options.baseUrl,
        token,
        "/api/enrich-node",
        {
          session_id: sessionId,
          node_id: nodeId,
          mode: "LEARN",
        } satisfies EnrichNodeRequest
      );
    } catch (err) {
      if (
        err instanceof ScriptApiError &&
        err.code === "ERR_NODE_NOT_AVAILABLE"
      ) {
        console.warn(
          `  Cảnh báo: Node ${nodeId} chưa mở khóa (ERR_NODE_NOT_AVAILABLE), bỏ qua node.`
        );
        skippedNodesCount++;
        continue;
      }
      console.error(
        `  Lỗi khi enrich node ${nodeId}:`,
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }

    const runKey = `${nodeId}:LEARN:${options.persona}`;
    enrich[runKey] = enrichRes;
    recordedRunsCount++;
    processedNodesCount++;
    console.log(`  Enrich node ${nodeId} thành công. Run ID: ${enrichRes.run_id}`);

    // 3. Xử lý các câu hỏi
    for (const question of enrichRes.questions) {
      const qIndex = question.question_index;
      const questionAnswersKey = `${nodeId}:${qIndex}`;
      const scriptAnswers = answersMap[questionAnswersKey];

      if (scriptAnswers && scriptAnswers.length > 0) {
        console.log(
          `  Câu ${qIndex}: Tìm thấy ${scriptAnswers.length} câu trả lời trong kịch bản.`
        );
        let finished = false;
        let attemptNumber = 1;

        for (const answerText of scriptAnswers) {
          console.log(`    Gửi đánh giá câu trả lời lượt ${attemptNumber}...`);
          const evalRes = await call<EvaluateFeynmanResponse>(
            options.baseUrl,
            token,
            "/api/evaluate-feynman",
            {
              session_id: sessionId,
              run_id: enrichRes.run_id,
              question_index: qIndex,
              student_answer: answerText,
              attempt_number: attemptNumber,
            } satisfies EvaluateFeynmanRequest
          );

          const attemptKey = `${runKey}:${qIndex}:${attemptNumber}`;
          if (!scripted_answers[attemptKey]) {
            scripted_answers[attemptKey] = [];
          }
          scripted_answers[attemptKey].push({
            answer: answerText,
            response: evalRes,
          });
          scriptedAnswersCount++;

          if (evalRes.question.finished) {
            console.log(
              `    Câu ${qIndex} đã hoàn thành ở lượt ${attemptNumber}.`
            );
            finished = true;
            break;
          }

          attemptNumber++;
        }

        if (!finished) {
          console.log(
            `    Hết câu trả lời kịch bản nhưng câu ${qIndex} chưa xong ⇒ Gọi /api/reveal.`
          );
          const revRes = await call<RevealResponse>(
            options.baseUrl,
            token,
            "/api/reveal",
            {
              session_id: sessionId,
              run_id: enrichRes.run_id,
              question_index: qIndex,
            } satisfies RevealRequest
          );
          reveals[`${runKey}:${qIndex}`] = revRes;
          revealsCount++;
        }
      } else {
        console.log(
          `  Câu ${qIndex}: Không có câu trả lời trong kịch bản ⇒ Gọi /api/reveal.`
        );
        const revRes = await call<RevealResponse>(
          options.baseUrl,
          token,
          "/api/reveal",
          {
            session_id: sessionId,
            run_id: enrichRes.run_id,
            question_index: qIndex,
          } satisfies RevealRequest
        );
        reveals[`${runKey}:${qIndex}`] = revRes;
        revealsCount++;
      }
    }
  }

  const overview = buildMinimalOverview(ingest.result);

  const recordedFrom = {
    repo: options.repoUrl,
    snapshot_id: ingest.result.snapshot.snapshot_id,
    engine_version: ingest.result.engine_version || CONFIG.ENGINE_VERSION,
    prompt_version: CONFIG.PROMPT_VERSION,
    model: CONFIG.LLM_MODEL,
    recorded_at: Date.now(),
  };

  const outFilePath = path.resolve(options.outFile);
  let finalBundle: OfflineMockBundle;

  try {
    const existingRaw = await fs.readFile(outFilePath, "utf8");
    const existingBundle = JSON.parse(existingRaw) as Partial<OfflineMockBundle>;
    console.log(
      `\nTìm thấy bundle đã có tại ${outFilePath}. Tiến hành gộp dữ liệu các persona...`
    );

    finalBundle = {
      bundle_version: "1",
      recorded_from: recordedFrom,
      ingest,
      overview,
      analyses: {
        ...(existingBundle.analyses ?? {}),
        ...analyses,
      },
      enrich: {
        ...(existingBundle.enrich ?? {}),
        ...enrich,
      },
      scripted_answers: {
        ...(existingBundle.scripted_answers ?? {}),
        ...scripted_answers,
      },
      reveals: {
        ...(existingBundle.reveals ?? {}),
        ...reveals,
      },
    };
  } catch {
    console.log(`\nKhởi tạo bundle mới tại ${outFilePath}...`);
    finalBundle = {
      bundle_version: "1",
      recorded_from: recordedFrom,
      ingest,
      overview,
      analyses,
      enrich,
      scripted_answers,
      reveals,
    };
  }

  await fs.mkdir(path.dirname(outFilePath), { recursive: true });
  await fs.writeFile(
    outFilePath,
    JSON.stringify(finalBundle, null, 2),
    "utf8"
  );

  console.log("\n================ TÓM TẮT GHI BUNDLE ================");
  console.log(`- Persona: ${options.persona}`);
  console.log(`- Số node đã xử lý: ${processedNodesCount} / ${targetNodeIds.length}`);
  console.log(`- Số node bị bỏ qua: ${skippedNodesCount}`);
  console.log(`- Số run đã ghi (enrich): ${recordedRunsCount}`);
  console.log(`- Số câu có kịch bản đã ghi: ${scriptedAnswersCount}`);
  console.log(`- Số câu đã reveal: ${revealsCount}`);
  console.log(`- File kết quả: ${outFilePath}`);
  console.log("====================================================\n");
}

main().catch((err) => {
  console.error("Gặp lỗi nghiêm trọng:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
