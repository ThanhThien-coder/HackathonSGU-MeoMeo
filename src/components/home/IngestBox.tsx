"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import type { ErrorCode, IngestRequest } from "@/contracts";
import { CONFIG } from "@/contracts/config";
import { Button } from "@/components/ui/common";
import { ERROR_MESSAGES, UPLOAD_TOO_LARGE_MESSAGE } from "@/lib/messages";
import { useWorkbenchStore } from "@/store/workbench";
import { ScanTimer } from "./ScanTimer";

// D-38: nhận link gốc repo, cho phép thiếu `https://`, `/` cuối, `.git`, `/tree/…`, `/blob/…`.
const GITHUB_REPO_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s?#]+\/[^/\s?#]+(?:[/?#].*)?$/i;
const TREE_OR_BLOB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s?#]+\/[^/\s?#]+\/(?:tree|blob)\//i;

/** Lỗi có hành động "mở vùng thả" (docs/spec/30_UI.md Mục 10). */
const OPEN_DROPZONE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "ERR_PREFLIGHT_404_OR_PRIVATE",
  "ERR_GITHUB_RATE_LIMIT_CDN",
  "ERR_STREAM_QUOTA_EXCEEDED",
  "ERR_UPLOAD_INVALID",
]);

const MAX_UPLOAD_MB = String(Math.round((CONFIG.MAX_UPLOAD_BYTES / (1024 * 1024)) * 10) / 10);

type Attempt = { kind: "url"; repoUrl: string } | { kind: "zip"; file: File };
type LocalError = { target: "link" | "zip"; message: string };

/** Kiểm đuôi và cỡ ở client trước khi gửi (D-27). Trả thông điệp lỗi, hoặc `null` nếu ổn. */
function checkZip(file: File): string | null {
  if (!/\.zip$/i.test(file.name) || file.size === 0) return ERROR_MESSAGES.ERR_UPLOAD_INVALID;
  if (file.size > CONFIG.MAX_UPLOAD_BYTES) return UPLOAD_TOO_LARGE_MESSAGE;
  return null;
}

export function IngestBox() {
  const router = useRouter();
  const linkId = useId();
  const noteId = useId();
  const ingest = useWorkbenchStore((s) => s.ingest);
  const ingesting = useWorkbenchStore((s) => s.ui.ingesting);
  const storeError = useWorkbenchStore((s) => s.ui.ingest_error);

  const [url, setUrl] = useState("");
  const [localError, setLocalError] = useState<LocalError | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const lastAttempt = useRef<Attempt | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = ingesting || redirecting;
  const trimmed = url.trim();
  const treeOrBlob = TREE_OR_BLOB_URL.test(trimmed);
  const error = localError ?? (storeError && { target: null, message: storeError.message });
  const linkInvalid = localError?.target === "link" || storeError?.code === "ERR_INVALID_GITHUB_URL";
  const dropHighlight =
    dragOver || localError?.target === "zip" || (!!storeError && OPEN_DROPZONE_CODES.has(storeError.code));

  async function run(attempt: Attempt) {
    if (busy) return;
    lastAttempt.current = attempt;
    setLocalError(null);

    let req: IngestRequest | FormData;
    if (attempt.kind === "url") {
      req = { repo_url: attempt.repoUrl };
    } else {
      req = new FormData();
      req.append("archive", attempt.file);
    }

    const res = await ingest(req); // lỗi nằm ở `ui.ingest_error`, hiện dưới vùng thả
    if (!res.ok || !mounted.current) return;

    setRedirecting(true);
    try {
      localStorage.setItem("sf.last_session", res.data.session_id);
    } catch {
      // localStorage bị chặn: bỏ qua, vẫn chuyển trang.
    }
    router.push(`/learn?session=${encodeURIComponent(res.data.session_id)}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;
    if (!GITHUB_REPO_URL.test(trimmed)) {
      setLocalError({ target: "link", message: ERROR_MESSAGES.ERR_INVALID_GITHUB_URL });
      return;
    }
    void run({ kind: "url", repoUrl: trimmed });
  }

  function pickFile(file: File | undefined) {
    if (!file || busy) return;
    const problem = checkZip(file);
    if (problem) setLocalError({ target: "zip", message: problem });
    else void run({ kind: "zip", file });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files[0]);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0]);
    e.target.value = ""; // chọn lại đúng file đó vẫn nhận
  }

  return (
    <section className="relative mx-auto flex w-full max-w-xl flex-col gap-5 rounded-2xl border border-line bg-panel p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold text-text">Quét một repo GitHub</h1>
        <p className="mt-1 text-muted">Dán link repo hoặc thả file .zip để dựng bản đồ bài học.</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor={linkId} className="text-sm font-semibold text-text">
          Link repo
        </label>
        <div className="flex gap-2">
          <input
            id={linkId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            disabled={busy}
            placeholder="https://github.com/facebook/react"
            aria-invalid={linkInvalid}
            aria-describedby={noteId}
            onChange={(e) => {
              setUrl(e.target.value);
              setLocalError(null);
            }}
            className={clsx(
              "min-w-0 flex-1 rounded-lg border bg-panel-2 px-3 py-2 text-text placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60",
              linkInvalid ? "border-red" : "border-line-strong",
            )}
          />
          <Button type="submit" variant="primary" disabled={!trimmed || busy}>
            Quét repo
          </Button>
        </div>
        <p id={noteId} className={clsx("text-sm", treeOrBlob ? "text-amber" : "text-subtle")}>
          Chỉ hỗ trợ nhánh mặc định.
          {treeOrBlob ? " — link /tree/… hoặc /blob/… sẽ được cắt về gốc repo" : null}
        </p>
      </form>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={clsx(
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          dropHighlight ? "border-accent bg-hl-step" : "border-line-strong bg-panel-2",
        )}
      >
        <p className="text-sm text-muted">
          Kéo thả file .zip vào đây (tối đa {MAX_UPLOAD_MB} MB)
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={onFileChange}
        />
        <Button variant="small" disabled={busy} onClick={() => fileInput.current?.click()}>
          Chọn file .zip
        </Button>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red">
          <p className="min-w-0 flex-1">{error.message}</p>
          {!localError && storeError?.retryable ? (
            <Button
              variant="small"
              disabled={busy}
              onClick={() => lastAttempt.current && void run(lastAttempt.current)}
            >
              Thử lại
            </Button>
          ) : null}
        </div>
      ) : null}

      <ScanTimer running={busy} />
    </section>
  );
}
