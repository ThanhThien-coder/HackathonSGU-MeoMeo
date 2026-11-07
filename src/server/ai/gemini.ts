import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type Schema,
} from "@google/genai";
import { CONFIG } from "@/contracts";
import { ApiHttpError } from "@/server/errors";
import { logAiCall, logger } from "@/server/log";
import { addSessionTokens } from "@/server/quota";

export type GeminiBackend = "vertex" | "studio";

function hasValue(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

export function assertGeminiEnv(
  env: Record<string, string | undefined> = process.env
): GeminiBackend {
  const backend = env.GEMINI_BACKEND;
  if (backend !== "vertex" && backend !== "studio") {
    throw new Error(
      "GEMINI_BACKEND không hợp lệ. Chỉ chấp nhận 'vertex' hoặc 'studio'."
    );
  }

  if (backend === "vertex") {
    // Vertex express: có GEMINI_API_KEY thì gọi Vertex bằng key, không cần project.
    if (hasValue(env.GEMINI_API_KEY)) return "vertex";
    if (!hasValue(env.GOOGLE_CLOUD_PROJECT)) {
      throw new Error(
        "Thiếu biến môi trường GOOGLE_CLOUD_PROJECT cho GEMINI_BACKEND='vertex'."
      );
    }
    return "vertex";
  }

  if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === "") {
    throw new Error(
      "Thiếu biến môi trường GEMINI_API_KEY cho GEMINI_BACKEND='studio'."
    );
  }
  return "studio";
}

export function isAiDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.AI_DISABLED === "true";
}

export function createGeminiClient(
  env: Record<string, string | undefined> = process.env
): GoogleGenAI {
  const backend = assertGeminiEnv(env);
  if (backend === "vertex") {
    if (hasValue(env.GEMINI_API_KEY)) {
      return new GoogleGenAI({
        vertexai: true,
        apiKey: env.GEMINI_API_KEY.trim(),
      });
    }
    return new GoogleGenAI({
      vertexai: true,
      project: env.GOOGLE_CLOUD_PROJECT!.trim(),
      location: "global",
    });
  }
  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY!.trim(),
  });
}

export interface LlmRequest<T> {
  kind: keyof typeof CONFIG.LLM_MAX_OUTPUT_TOKENS;
  system: string;
  user: string;
  schema: Schema;
  sessionId: string;
  parse: (json: unknown) => T | null;
}

declare module "@/server/log" {
  interface AiCallLogEntry {
    fell_back?: boolean;
  }
}

export type LlmOutcome<T> = (
  | { ok: true; value: T }
  | {
      ok: false;
      kind: "TRANSIENT" | "INVALID_JSON" | "FATAL";
      retry_after_ms?: number;
    }
) & {
  tokens_in: number;
  tokens_out: number;
  model: string;
  fell_back: boolean;
  cost_usd?: number;
};

export function aiCostUsd(
  tokensIn: number,
  tokensOut: number,
  model: string = CONFIG.LLM_MODEL
): number {
  const prices = (
    CONFIG.LLM_PRICES_USD_PER_M as Record<
      string,
      { readonly INPUT: number; readonly OUTPUT: number } | undefined
    >
  )[model];
  const priceIn = prices?.INPUT ?? CONFIG.LLM_PRICE_INPUT_USD_PER_M;
  const priceOut = prices?.OUTPUT ?? CONFIG.LLM_PRICE_OUTPUT_USD_PER_M;
  return (tokensIn * priceIn) / 1_000_000 + (tokensOut * priceOut) / 1_000_000;
}

function cleanJsonString(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }
  return text.trim();
}

function extractErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err.status === "number") return err.status;
    if (typeof err.statusCode === "number") return err.statusCode;
    if (typeof err.status === "string" && /^\d+$/.test(err.status)) {
      return parseInt(err.status, 10);
    }
    if (err.response && typeof err.response === "object") {
      const resp = err.response as Record<string, unknown>;
      if (typeof resp.status === "number") return resp.status;
    }
  }
  if (error instanceof Error) {
    const m = error.message.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
    if (m) return parseInt(m[1], 10);
  }
  return undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err.retry_after_ms === "number") return err.retry_after_ms;
    if (typeof err.retryAfter === "number") return err.retryAfter * 1000;
    if (typeof err.retryDelay === "number") return err.retryDelay;
    if (typeof err.retryDelay === "string") {
      const match = err.retryDelay.match(/^(\d+(?:\.\d+)?)(s|ms)?$/i);
      if (match) {
        const val = parseFloat(match[1]);
        return match[2]?.toLowerCase() === "ms" ? val : val * 1000;
      }
    }
    if (Array.isArray(err.errorDetails)) {
      for (const d of err.errorDetails) {
        if (d && typeof d === "object" && "retryDelay" in d) {
          const rd = (d as { retryDelay?: string | number }).retryDelay;
          if (typeof rd === "number") return rd;
          if (typeof rd === "string") {
            const match = rd.match(/^(\d+(?:\.\d+)?)(s|ms)?$/i);
            if (match) {
              const val = parseFloat(match[1]);
              return match[2]?.toLowerCase() === "ms" ? val : val * 1000;
            }
          }
        }
      }
    }
  }
  if (error instanceof Error) {
    const match = error.message.match(
      /retry[- ]after[:\s]+(\d+(?:\.\d+)?)\s*(s|ms)?/i
    );
    if (match) {
      const val = parseFloat(match[1]);
      return match[2]?.toLowerCase() === "ms" ? val : val * 1000;
    }
    const match2 = error.message.match(
      /retry (?:after|in)\s+(\d+(?:\.\d+)?)\s*(s|ms)?/i
    );
    if (match2) {
      const val = parseFloat(match2[1]);
      return match2[2]?.toLowerCase() === "ms" ? val : val * 1000;
    }
  }
  return undefined;
}

function classifyError(error: unknown): {
  kind: "TRANSIENT" | "FATAL";
  status?: number;
  retry_after_ms?: number;
} {
  const status = extractErrorStatus(error);
  const retry_after_ms = extractRetryAfterMs(error);

  if (status !== undefined) {
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      return { kind: "FATAL", status, retry_after_ms };
    }
    if (
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      return { kind: "TRANSIENT", status, retry_after_ms };
    }
  }

  if (error instanceof Error) {
    if (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.message.toLowerCase().includes("timeout")
    ) {
      return { kind: "TRANSIENT", status, retry_after_ms };
    }
    const msg = error.message.toLowerCase();
    if (
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("fetch failed")
    ) {
      return { kind: "TRANSIENT", status, retry_after_ms };
    }
  }

  return { kind: "FATAL", status, retry_after_ms };
}

type SingleModelResult<T> =
  | { ok: true; value: T; tokens_in: number; tokens_out: number }
  | {
      ok: false;
      kind: "TRANSIENT" | "INVALID_JSON" | "FATAL";
      retry_after_ms?: number;
      tokens_in: number;
      tokens_out: number;
    };

async function executeSingleModelCall<T>(
  req: LlmRequest<T>,
  ai: GoogleGenAI,
  model: string,
  timeoutMs: number
): Promise<SingleModelResult<T>> {
  let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      config: {
        systemInstruction: req.system,
        temperature: CONFIG.LLM_TEMPERATURE,
        maxOutputTokens: CONFIG.LLM_MAX_OUTPUT_TOKENS[req.kind],
        safetySettings: [
          HarmCategory.HARM_CATEGORY_HARASSMENT,
          HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        ].map((category) => ({
          category,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        })),
        // Luôn gửi: budget 0 phải gửi rõ, không thì model tự nghĩ theo mặc định và có thể cắt JSON.
        thinkingConfig: { thinkingBudget: CONFIG.LLM_THINKING_BUDGET },
        responseMimeType: "application/json",
        responseSchema: req.schema,
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
  } catch (err: unknown) {
    const { kind, status, retry_after_ms } = classifyError(err);
    logger.warn({
      call_kind: req.kind,
      kind,
      status,
      retry_after_ms,
      model,
    });
    return {
      ok: false,
      kind,
      retry_after_ms,
      tokens_in: 0,
      tokens_out: 0,
    };
  }

  const usage = response.usageMetadata;
  const tokens_in = usage?.promptTokenCount ?? 0;
  const tokens_out =
    (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);

  if (req.sessionId && (tokens_in + tokens_out > 0)) {
    try {
      await addSessionTokens(req.sessionId, tokens_in, tokens_out);
    } catch {
      // Bỏ qua lỗi cập nhật quota ngoài transaction
    }
  }

  const candidate = response.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    logger.warn({
      call_kind: req.kind,
      kind: "INVALID_JSON",
      status: candidate.finishReason,
      model,
    });
    return {
      ok: false,
      kind: "INVALID_JSON",
      tokens_in,
      tokens_out,
    };
  }

  const rawText =
    response.text ?? candidate?.content?.parts?.[0]?.text ?? "";
  const cleaned = cleanJsonString(rawText);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    logger.warn({
      call_kind: req.kind,
      kind: "INVALID_JSON",
      model,
    });
    return {
      ok: false,
      kind: "INVALID_JSON",
      tokens_in,
      tokens_out,
    };
  }

  const parsedValue = req.parse(parsedJson);
  if (parsedValue === null) {
    logger.warn({
      call_kind: req.kind,
      kind: "INVALID_JSON",
      model,
    });
    return {
      ok: false,
      kind: "INVALID_JSON",
      tokens_in,
      tokens_out,
    };
  }

  return {
    ok: true,
    value: parsedValue,
    tokens_in,
    tokens_out,
  };
}

export async function callLLMOnce<T>(
  req: LlmRequest<T>,
  client?: GoogleGenAI,
  env: Record<string, string | undefined> = process.env
): Promise<LlmOutcome<T>> {
  if (isAiDisabled(env)) {
    throw new ApiHttpError("ERR_AI_UNAVAILABLE", "AI hiện đang tạm ngắt (AI_DISABLED=true)");
  }

  const ai = client ?? createGeminiClient(env);

  const primaryResult = await executeSingleModelCall(
    req,
    ai,
    CONFIG.LLM_MODEL,
    CONFIG.LLM_PRIMARY_TIMEOUT_MS
  );

  if (primaryResult.ok) {
    const cost_usd = aiCostUsd(
      primaryResult.tokens_in,
      primaryResult.tokens_out,
      CONFIG.LLM_MODEL
    );
    return {
      ok: true,
      value: primaryResult.value,
      tokens_in: primaryResult.tokens_in,
      tokens_out: primaryResult.tokens_out,
      model: CONFIG.LLM_MODEL,
      fell_back: false,
      cost_usd,
    };
  }

  // Model chính không ok (TRANSIENT, INVALID_JSON, FATAL, hoặc timeout)
  // ⇒ gọi CONFIG.LLM_MODEL_FALLBACK 1 lần với timeout LLM_TIMEOUT_MS, không chờ delay
  const fallbackResult = await executeSingleModelCall(
    req,
    ai,
    CONFIG.LLM_MODEL_FALLBACK,
    CONFIG.LLM_TIMEOUT_MS
  );

  const totalTokensIn = primaryResult.tokens_in + fallbackResult.tokens_in;
  const totalTokensOut = primaryResult.tokens_out + fallbackResult.tokens_out;
  const totalCostUsd =
    aiCostUsd(primaryResult.tokens_in, primaryResult.tokens_out, CONFIG.LLM_MODEL) +
    aiCostUsd(fallbackResult.tokens_in, fallbackResult.tokens_out, CONFIG.LLM_MODEL_FALLBACK);

  if (fallbackResult.ok) {
    return {
      ok: true,
      value: fallbackResult.value,
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      model: CONFIG.LLM_MODEL_FALLBACK,
      fell_back: true,
      cost_usd: totalCostUsd,
    };
  }

  return {
    ok: false,
    kind: fallbackResult.kind,
    retry_after_ms: fallbackResult.retry_after_ms,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    model: CONFIG.LLM_MODEL_FALLBACK,
    fell_back: true,
    cost_usd: totalCostUsd,
  };
}

export async function callLLMWithRetry<T>(
  req: LlmRequest<T>,
  sleepFn?: (ms: number) => Promise<void>,
  client?: GoogleGenAI,
  env: Record<string, string | undefined> = process.env
): Promise<LlmOutcome<T>> {
  if (isAiDisabled(env)) {
    throw new ApiHttpError("ERR_AI_UNAVAILABLE", "AI hiện đang tạm ngắt (AI_DISABLED=true)");
  }

  const backend = assertGeminiEnv(env);
  const sleep =
    sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCostUsd = 0;
  let lastOutcome: LlmOutcome<T> | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= CONFIG.LLM_MAX_RETRIES; attempt++) {
    const outcome = await callLLMOnce(req, client, env);
    totalTokensIn += outcome.tokens_in;
    totalTokensOut += outcome.tokens_out;
    totalCostUsd +=
      outcome.cost_usd ??
      aiCostUsd(outcome.tokens_in, outcome.tokens_out, outcome.model);
    lastOutcome = outcome;
    retries = attempt;

    if (outcome.ok) {
      break;
    }

    if (outcome.kind === "FATAL") {
      break;
    }

    if (attempt < CONFIG.LLM_MAX_RETRIES) {
      if (outcome.kind === "TRANSIENT") {
        if (
          outcome.retry_after_ms !== undefined &&
          outcome.retry_after_ms > CONFIG.LLM_RETRY_DELAY_MAX_MS
        ) {
          break;
        }

        const baseDelay =
          outcome.retry_after_ms !== undefined
            ? Math.max(CONFIG.LLM_RETRY_DELAY_MS, outcome.retry_after_ms)
            : CONFIG.LLM_RETRY_DELAY_MS;
        const jitter = Math.random() * CONFIG.LLM_RETRY_JITTER_MS;
        await sleep(baseDelay + jitter);
      } else if (outcome.kind === "INVALID_JSON") {
        const jitter = Math.random() * CONFIG.LLM_RETRY_JITTER_MS;
        await sleep(CONFIG.LLM_RETRY_DELAY_MS + jitter);
      }
    }
  }

  const finalModel = lastOutcome?.model ?? CONFIG.LLM_MODEL;
  const finalFellBack = lastOutcome?.fell_back ?? false;

  logAiCall({
    call_kind: req.kind,
    backend,
    model: finalModel,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    retries,
    cost_usd: totalCostUsd,
    fell_back: finalFellBack,
  });

  if (!lastOutcome) {
    return {
      ok: false,
      kind: "FATAL",
      tokens_in: 0,
      tokens_out: 0,
      model: CONFIG.LLM_MODEL,
      fell_back: false,
      cost_usd: 0,
    };
  }

  return {
    ...lastOutcome,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: totalCostUsd,
  };
}
