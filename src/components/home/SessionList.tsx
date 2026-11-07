"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LearningSessionSummary } from "@/contracts";
import { Button } from "@/components/ui/common";
import { useWorkbenchStore } from "@/store/workbench";

const relativeTime = new Intl.RelativeTimeFormat("vi", { numeric: "always" });

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "2 giờ trước"; dưới 1 phút (hoặc đồng hồ máy lệch về tương lai) ⇒ "vừa xong". */
function formatAgo(at: number, now: number): string {
  const diff = now - at;
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) return relativeTime.format(-Math.floor(diff / ms), unit);
  }
  return "vừa xong";
}

/** Hàng 1 (docs/spec/30_UI.md Mục 2.1): "shop-api · main @ 5be1c2a"; zip ⇒ "zip", có `subdir` ⇒ "repo/subdir". */
function titleLine(s: LearningSessionSummary): string {
  const { snapshot } = s;
  const name = snapshot.subdir ? `${s.repo_name}/${snapshot.subdir}` : s.repo_name;
  const ref = snapshot.ref_label ?? (snapshot.snapshot_id_kind === "ARCHIVE_HASH" ? "zip" : null);
  return `${name}${ref ? ` · ${ref}` : ""} @ ${snapshot.snapshot_id.slice(0, 7)}`;
}

/** Hàng 2: "3/7 node (1 ✗) · 2 giờ trước". */
function progressLine(s: LearningSessionSummary, now: number): string {
  return `${s.completed_count}/${s.total_nodes} node (${s.failed_count} chưa đạt) · ${formatAgo(s.last_active_at, now)}`;
}

type LoadState = "idle" | "loading" | "failed";
type ResumeError = { session_id: string; message: string; retryable: boolean };

/**
 * "Tiếp tục học" (docs/spec/30_UI.md Mục 2.1). Tự đọc `ui.sessions` nên đổi danh sách chỉ vẽ lại khối này,
 * không vẽ lại cả trang. Lỗi tải danh sách chỉ hiện một dòng nhỏ có "Thử lại", ô link bên trên vẫn dùng được.
 */
export function SessionList() {
  const router = useRouter();
  const sessions = useWorkbenchStore((s) => s.ui.sessions);
  const loadSessions = useWorkbenchStore((s) => s.loadSessions);
  const ingest = useWorkbenchStore((s) => s.ingest);
  const ingesting = useWorkbenchStore((s) => s.ui.ingesting);
  const pushToast = useWorkbenchStore((s) => s.pushToast);

  const [load, setLoad] = useState<LoadState>("idle");
  const [opening, setOpening] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<ResumeError | null>(null);
  const mounted = useRef(true);
  const autoLoaded = useRef(false);

  async function reload() {
    setLoad("loading");
    await loadSessions();
    if (!mounted.current) return;
    // `loadSessions` không trả kết quả: vẫn `null` sau khi xong ⇒ lỗi (có thể Boot đã nạp xong trước đó).
    setLoad(useWorkbenchStore.getState().ui.sessions === null ? "failed" : "idle");
  }

  useEffect(() => {
    mounted.current = true;
    if (sessions === null && !autoLoaded.current) {
      autoLoaded.current = true; // StrictMode chạy effect 2 lần: chỉ nạp 1 lần
      void reload();
    }
    return () => {
      mounted.current = false;
    };
    // Chỉ chạy lúc gắn khối.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resume(session: LearningSessionSummary) {
    if (ingesting || opening) return;
    setOpening(session.session_id);
    setResumeError(null);

    const res = await ingest({ session_id: session.session_id }); // POST /api/ingest { session_id }
    if (!mounted.current) return;

    if (!res.ok) {
      const err = useWorkbenchStore.getState().ui.ingest_error;
      // Lỗi báo ngay tại hàng bấm; xóa bản ở store để `IngestBox` không hiện thêm một thông điệp trùng.
      useWorkbenchStore.setState((s) => ({ ui: { ...s.ui, ingest_error: null } }));
      setResumeError({
        session_id: session.session_id,
        message: err?.message ?? "Chưa mở lại được phiên này.",
        retryable: err?.retryable ?? true,
      });
      if (err?.code === "ERR_SESSION_NOT_FOUND") {
        try {
          if (localStorage.getItem("sf.last_session") === session.session_id) {
            localStorage.removeItem("sf.last_session");
          }
        } catch {
          // localStorage bị chặn: bỏ qua.
        }
        void reload(); // phiên đã mất: nạp lại để hàng này biến khỏi danh sách
      }
      setOpening(null);
      return;
    }

    try {
      localStorage.setItem("sf.last_session", res.data.session_id);
    } catch {
      // localStorage bị chặn: bỏ qua, vẫn chuyển trang.
    }
    if (res.data.resumed) {
      pushToast(`Đã mở lại ${session.repo_name} — ${session.completed_count}/${session.total_nodes} node`, "info");
    }
    router.push(`/learn?session=${encodeURIComponent(res.data.session_id)}`);
    // Giữ `opening` tới khi trang đổi, tránh bấm lần hai.
  }

  if (sessions === null) {
    if (load === "failed") {
      return (
        <section aria-label="Tiếp tục học" className="mx-auto flex w-full max-w-xl items-center gap-3 text-sm text-muted">
          <p role="status" className="min-w-0 flex-1">
            Chưa tải được danh sách phiên
          </p>
          <Button variant="small" onClick={() => void reload()}>
            Thử lại
          </Button>
        </section>
      );
    }
    return (
      <section aria-label="Tiếp tục học" className="mx-auto w-full max-w-xl text-sm text-subtle">
        <p role="status">Đang tải danh sách phiên…</p>
      </section>
    );
  }

  if (sessions.length === 0) return null;

  const now = Date.now();
  return (
    <section aria-labelledby="session-list-title" className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <h2 id="session-list-title" className="text-lg font-bold text-text">
        Tiếp tục học
      </h2>
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => {
          const busyHere = opening === s.session_id;
          const err = resumeError?.session_id === s.session_id ? resumeError : null;
          return (
            <li key={s.session_id} className="rounded-xl border border-line bg-panel px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-text">{titleLine(s)}</p>
                  <p className="truncate text-sm text-muted">{progressLine(s, now)}</p>
                </div>
                <Button
                  variant="primary"
                  disabled={!s.can_resume || ingesting || opening !== null}
                  onClick={() => void resume(s)}
                >
                  {busyHere ? "Đang mở…" : "Học tiếp"}
                </Button>
              </div>
              {err ? (
                <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 text-sm text-red">
                  <p className="min-w-0 flex-1">{err.message}</p>
                  {err.retryable ? (
                    <Button variant="small" disabled={ingesting || opening !== null} onClick={() => void resume(s)}>
                      Thử lại
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
