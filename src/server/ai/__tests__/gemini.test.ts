import { CONFIG } from "@/contracts/config";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  aiCostUsd,
  assertGeminiEnv,
  callLLMOnce,
  callLLMWithRetry,
  createGeminiClient,
  isAiDisabled,
  type LlmRequest,
} from "../gemini";
import { logAiCall } from "@/server/log";
import { addSessionTokens } from "@/server/quota";
import { GoogleGenAI } from "@google/genai";

vi.mock("@/server/db", () => {
  const mockSql = vi.fn();
  return {
    sql: mockSql,
    db: { sql: mockSql, tx: vi.fn() },
  };
});

vi.mock("@/server/log", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
  logAiCall: vi.fn(),
  logApiRequest: vi.fn(),
  logGuardBlocked: vi.fn(),
}));

vi.mock("@/server/quota", () => ({
  checkTokenQuota: vi.fn(),
  assertSessionTokenQuota: vi.fn(),
  addSessionTokens: vi.fn().mockResolvedValue(100),
}));

vi.mock("@google/genai", () => {
  const MockGoogleGenAI = vi.fn().mockImplementation((config) => {
    return {
      _config: config,
      models: {
        generateContent: vi.fn(),
      },
    };
  });
  return {
    GoogleGenAI: MockGoogleGenAI,
    HarmBlockThreshold: {
      BLOCK_ONLY_HIGH: "BLOCK_ONLY_HIGH",
    },
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: "HARM_CATEGORY_HARASSMENT",
      HARM_CATEGORY_HATE_SPEECH: "HARM_CATEGORY_HATE_SPEECH",
      HARM_CATEGORY_SEXUALLY_EXPLICIT: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      HARM_CATEGORY_DANGEROUS_CONTENT: "HARM_CATEGORY_DANGEROUS_CONTENT",
    },
    Type: {
      STRING: "STRING",
      INTEGER: "INTEGER",
      BOOLEAN: "BOOLEAN",
      ARRAY: "ARRAY",
      OBJECT: "OBJECT",
    },
  };
});

describe("gemini.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertGeminiEnv", () => {
    it("ném lỗi nếu GEMINI_BACKEND thiếu hoặc không phải vertex/studio", () => {
      expect(() => assertGeminiEnv({})).toThrow("GEMINI_BACKEND không hợp lệ");
      expect(() => assertGeminiEnv({ GEMINI_BACKEND: "other" })).toThrow(
        "GEMINI_BACKEND không hợp lệ"
      );
    });

    it("vertex thiếu project ⇒ ném lỗi", () => {
      expect(() => assertGeminiEnv({ GEMINI_BACKEND: "vertex" })).toThrow(
        "Thiếu biến môi trường GOOGLE_CLOUD_PROJECT"
      );
      expect(() =>
        assertGeminiEnv({ GEMINI_BACKEND: "vertex", GOOGLE_CLOUD_PROJECT: "  " })
      ).toThrow("Thiếu biến môi trường GOOGLE_CLOUD_PROJECT");
    });

    it("vertex không cần key, có project ⇒ trả về vertex", () => {
      const res = assertGeminiEnv({
        GEMINI_BACKEND: "vertex",
        GOOGLE_CLOUD_PROJECT: "demo-project",
      });
      expect(res).toBe("vertex");
    });

    it("vertex có key, không có project ⇒ trả về vertex (express)", () => {
      const res = assertGeminiEnv({
        GEMINI_BACKEND: "vertex",
        GEMINI_API_KEY: "vertex-key",
      });
      expect(res).toBe("vertex");
    });

    it("studio thiếu key ⇒ ném lỗi", () => {
      expect(() => assertGeminiEnv({ GEMINI_BACKEND: "studio" })).toThrow(
        "Thiếu biến môi trường GEMINI_API_KEY"
      );
      expect(() =>
        assertGeminiEnv({ GEMINI_BACKEND: "studio", GEMINI_API_KEY: "   " })
      ).toThrow("Thiếu biến môi trường GEMINI_API_KEY");
    });

    it("studio có key ⇒ trả về studio", () => {
      const res = assertGeminiEnv({
        GEMINI_BACKEND: "studio",
        GEMINI_API_KEY: "test-secret-key",
      });
      expect(res).toBe("studio");
    });
  });

  describe("isAiDisabled", () => {
    it("chỉ trả true khi AI_DISABLED='true'", () => {
      expect(isAiDisabled({ AI_DISABLED: "true" })).toBe(true);
      expect(isAiDisabled({ AI_DISABLED: "false" })).toBe(false);
      expect(isAiDisabled({ AI_DISABLED: "1" })).toBe(false);
      expect(isAiDisabled({})).toBe(false);
    });
  });

  describe("createGeminiClient", () => {
    it("tạo client vertex đúng tham số", () => {
      createGeminiClient({
        GEMINI_BACKEND: "vertex",
        GOOGLE_CLOUD_PROJECT: "my-gcp-project",
      });
      expect(GoogleGenAI).toHaveBeenCalledWith({
        vertexai: true,
        project: "my-gcp-project",
        location: "global",
      });
    });

    it("vertex có key ⇒ tạo client vertex express bằng apiKey, không truyền project", () => {
      createGeminiClient({
        GEMINI_BACKEND: "vertex",
        GEMINI_API_KEY: " vertex-key ",
        GOOGLE_CLOUD_PROJECT: "my-gcp-project",
      });
      expect(GoogleGenAI).toHaveBeenCalledWith({
        vertexai: true,
        apiKey: "vertex-key",
      });
    });

    it("tạo client studio đúng apiKey", () => {
      createGeminiClient({
        GEMINI_BACKEND: "studio",
        GEMINI_API_KEY: "studio-key",
      });
      expect(GoogleGenAI).toHaveBeenCalledWith({
        apiKey: "studio-key",
      });
    });
  });

  describe("aiCostUsd", () => {
    it("aiCostUsd(1754, 561) ≈ 0.001929", () => {
      const cost = aiCostUsd(1754, 561);
      expect(cost).toBeCloseTo(0.001929, 6);
    });
  });

  describe("X-11 AI_DISABLED", () => {
    const dummyReq: LlmRequest<{ test: boolean }> = {
      kind: "ANALYZE",
      system: "system prompt",
      user: "user prompt",
      schema: { type: "OBJECT" } as unknown as import("@google/genai").Schema,
      sessionId: "session-1",
      parse: (j) => j as { test: boolean },
    };

    it("callLLMOnce ném ERR_AI_UNAVAILABLE khi AI_DISABLED='true' và không gọi generateContent", async () => {
      const mockGenerate = vi.fn();
      const mockClient = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      await expect(
        callLLMOnce(dummyReq, mockClient, { AI_DISABLED: "true" })
      ).rejects.toMatchObject({
        code: "ERR_AI_UNAVAILABLE",
      });

      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("callLLMWithRetry ném ERR_AI_UNAVAILABLE khi AI_DISABLED='true'", async () => {
      const mockGenerate = vi.fn();
      const mockClient = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      await expect(
        callLLMWithRetry(
          dummyReq,
          async () => {},
          mockClient,
          { AI_DISABLED: "true" }
        )
      ).rejects.toMatchObject({
        code: "ERR_AI_UNAVAILABLE",
      });

      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  describe("callLLMOnce", () => {
    const dummyReq: LlmRequest<{ value: number }> = {
      kind: "ANALYZE",
      system: "sys",
      user: "usr",
      schema: { type: "OBJECT" } as unknown as import("@google/genai").Schema,
      sessionId: "sess-1",
      parse: (j: unknown) => {
        if (typeof j === "object" && j !== null && "value" in j) {
          return j as { value: number };
        }
        return null;
      },
    };

    const validEnv = {
      GEMINI_BACKEND: "studio",
      GEMINI_API_KEY: "key",
    };

    it("trả về ok: true khi response hợp lệ", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: '{"value": 42}',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 10,
        },
        candidates: [{ finishReason: "STOP" }],
      });
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const res = await callLLMOnce(dummyReq, client, validEnv);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({ value: 42 });
      }
      expect(res.tokens_in).toBe(100);
      expect(res.tokens_out).toBe(60);
      expect(addSessionTokens).toHaveBeenCalledWith("sess-1", 100, 60);
    });

    it("luôn gửi thinkingConfig.thinkingBudget = CONFIG.LLM_THINKING_BUDGET (kể cả 0)", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: '{"value": 1}',
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        candidates: [{ finishReason: "STOP" }],
      });
      const client = { models: { generateContent: mockGenerate } } as unknown as GoogleGenAI;
      await callLLMOnce(dummyReq, client, validEnv);
      const arg = mockGenerate.mock.calls[0][0] as { config: { thinkingConfig?: { thinkingBudget: number } } };
      expect(arg.config.thinkingConfig).toEqual({ thinkingBudget: CONFIG.LLM_THINKING_BUDGET });
    });

    it("trả về INVALID_JSON khi finishReason != STOP", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: '{"value": 42}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        candidates: [{ finishReason: "MAX_TOKENS" }],
      });
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const res = await callLLMOnce(dummyReq, client, validEnv);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe("INVALID_JSON");
      }
      expect(res.tokens_in).toBe(10);
      expect(res.tokens_out).toBe(20);
    });

    it("trả về INVALID_JSON khi JSON cú pháp hỏng", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: "broken json {",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        candidates: [{ finishReason: "STOP" }],
      });
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const res = await callLLMOnce(dummyReq, client, validEnv);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe("INVALID_JSON");
      }
    });

    it("trả về INVALID_JSON khi req.parse trả về null", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: '{"wrongKey": 123}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        candidates: [{ finishReason: "STOP" }],
      });
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const res = await callLLMOnce(dummyReq, client, validEnv);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe("INVALID_JSON");
      }
    });

    it("phân loại TRANSIENT khi gặp 429 hoặc 503", async () => {
      const err = new Error("429 Resource has been exhausted");
      (err as unknown as Record<string, unknown>).status = 429;
      (err as unknown as Record<string, unknown>).retryDelay = "15s";
      const mockGenerate = vi.fn().mockRejectedValue(err);
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const res = await callLLMOnce(dummyReq, client, validEnv);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe("TRANSIENT");
        expect(res.retry_after_ms).toBe(15000);
      }
    });

    it("phân loại FATAL khi gặp 400 hoặc 404", async () => {
      const err = new Error("400 Bad Request");
      (err as unknown as Record<string, unknown>).status = 400;
      const mockGenerate = vi.fn().mockRejectedValue(err);
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const res = await callLLMOnce(dummyReq, client, validEnv);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe("FATAL");
      }
    });
  });

  describe("X-12 & callLLMWithRetry", () => {
    const dummyReq: LlmRequest<{ ok: boolean }> = {
      kind: "QUESTIONS",
      system: "sys",
      user: "usr",
      schema: { type: "OBJECT" } as unknown as import("@google/genai").Schema,
      sessionId: "s1",
      parse: (j) => j as { ok: boolean },
    };

    const validEnv = {
      GEMINI_BACKEND: "studio",
      GEMINI_API_KEY: "secret",
    };

    it("429 ⇒ gọi lại đúng 1 lần rồi trả lỗi", async () => {
      const err = new Error("429 Quota Exceeded");
      (err as unknown as Record<string, unknown>).status = 429;
      const mockGenerate = vi.fn().mockRejectedValue(err);
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const res = await callLLMWithRetry(dummyReq, sleepFn, client, validEnv);

      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe("TRANSIENT");
      }
      expect(logAiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          call_kind: "QUESTIONS",
          retries: 1,
        })
      );
    });

    it("JSON hỏng ⇒ gọi lại 1 lần, lần 2 thành công", async () => {
      const mockGenerate = vi
        .fn()
        .mockResolvedValueOnce({
          text: "{ invalid json",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          candidates: [{ finishReason: "STOP" }],
        })
        .mockResolvedValueOnce({
          text: '{"ok": true}',
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10 },
          candidates: [{ finishReason: "STOP" }],
        });

      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const res = await callLLMWithRetry(dummyReq, sleepFn, client, validEnv);

      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(true);
      expect(res.tokens_in).toBe(25);
      expect(res.tokens_out).toBe(15);
      expect(logAiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          call_kind: "QUESTIONS",
          retries: 1,
          tokens_in: 25,
          tokens_out: 15,
        })
      );
    });

    it("retry_after_ms > LLM_RETRY_DELAY_MAX_MS (20s) ⇒ không gọi lại", async () => {
      const err = new Error("429 Resource exhausted");
      (err as unknown as Record<string, unknown>).status = 429;
      (err as unknown as Record<string, unknown>).retryDelay = "25s"; // 25000ms > 20000ms
      const mockGenerate = vi.fn().mockRejectedValue(err);
      const client = {
        models: { generateContent: mockGenerate },
      } as unknown as GoogleGenAI;

      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const res = await callLLMWithRetry(dummyReq, sleepFn, client, validEnv);

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(sleepFn).not.toHaveBeenCalled();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe("TRANSIENT");
      }
    });
  });
});
