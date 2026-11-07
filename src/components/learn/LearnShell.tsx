"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { LoginScreen } from "@/components/home/LoginScreen";
import { CockpitHeader } from "@/components/learn/CockpitHeader";
import { CodeSnippetViewer } from "@/components/learn/CodeSnippetViewer";
import { DuolingoTour } from "@/components/learn/DuolingoTour";
import { LearnSidePanel } from "@/components/learn/LearnSidePanel";
import { LessonGraphPanel } from "@/components/learn/LessonGraphPanel";
import { Button } from "@/components/ui/common";
import { EmptyState } from "@/components/ui/Page";
import { useWorkbenchStore } from "@/store/workbench";

const COLUMN = "col min-w-0 rounded-xl bg-[var(--panel)] shadow-sm lg:min-h-0 lg:overflow-auto";
const HOME_LINK =
  "inline-flex items-center justify-center rounded-lg bg-[var(--panel2)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] transition-transform hover:-translate-y-0.5 hover:bg-[var(--panel3)]";

function Centered({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10 sm:px-6 sm:py-16">{children}</main>;
}

/** Chưa có bản đồ: luôn có lối ra (về trang chủ, thử lại), không để người học kẹt ở màn chờ. */
function NoSession({ sessionId }: { sessionId: string | null }) {
  const fixture = useWorkbenchStore((s) => s.ui.fixture);
  const offline = useWorkbenchStore((s) => s.is_offline_mode);
  const auth = useWorkbenchStore((s) => s.ui.auth);
  const ingesting = useWorkbenchStore((s) => s.ui.ingesting);
  const ingestError = useWorkbenchStore((s) => s.ui.ingest_error);
  const bootError = useWorkbenchStore((s) => s.ui.boot_error);
  const ingest = useWorkbenchStore((s) => s.ingest);

  if (auth === "SIGNED_OUT" && !fixture && !offline) {
    return (
      <Centered>
        <LoginScreen />
      </Centered>
    );
  }
  if (offline) {
    return (
      <Centered>
        <EmptyState
          title="Chế độ Offline chưa sẵn sàng"
          description="Gói dữ liệu demo Offline sẽ được nối ở bước sau."
          action={<Link href="/" className={HOME_LINK}>Về trang chủ</Link>}
        />
      </Centered>
    );
  }
  if (ingestError) {
    return (
      <Centered>
        <div role="alert" className="rounded-xl bg-st-fail-bg p-4 text-sm text-[var(--text)]">
          <p>{ingestError.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ingestError.retryable && sessionId ? (
              <Button variant="small" onClick={() => void ingest({ session_id: sessionId })}>
                Thử lại
              </Button>
            ) : null}
            <Link href="/" className={HOME_LINK}>
              Về trang chủ
            </Link>
          </div>
        </div>
      </Centered>
    );
  }
  if (!sessionId && !fixture) {
    return (
      <Centered>
        <EmptyState
          title="Chưa chọn phiên học"
          description="Dán link repo ở trang chủ, hoặc mở lại một phiên đã học."
          action={<Link href="/" className={HOME_LINK}>Về trang chủ</Link>}
        />
      </Centered>
    );
  }
  return (
    <Centered>
      <p role="status" className="text-center text-[var(--muted)]">
        {bootError && !ingesting ? bootError.message : "Đang mở phiên học…"}
      </p>
      <div className="text-center">
        <Link href="/" className={HOME_LINK}>
          Về trang chủ
        </Link>
      </div>
    </Centered>
  );
}

/** Khung buồng lái 3 cột Cockpit IDE theo TasteSkill 2.5 + prototype.html */
export function LearnShell() {
  const sessionParam = useSearchParams().get("session");
  const result = useWorkbenchStore((s) => s.result);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [tourOpen, setTourOpen] = useState(false);

  // Phím tắt toàn cục: Ctrl+B (toggle cột trái), Ctrl+Alt+B (toggle cột phải)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setRightOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setLeftOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tự động gợi ý mở tour Duolingo cho người học mới vào
  useEffect(() => {
    if (!result) return;
    try {
      const shown = window.sessionStorage.getItem("sf.tour_shown");
      if (!shown) {
        setTourOpen(true);
      }
    } catch {
      // sessionStorage có thể bị chặn
    }
  }, [result]);

  const handleCloseTour = () => {
    setTourOpen(false);
    try {
      window.sessionStorage.setItem("sf.tour_shown", "true");
    } catch {
      // Không làm gián đoạn UI
    }
  };

  const handleEnsureColumnsOpen = () => {
    setLeftOpen(true);
    setRightOpen(true);
  };

  if (!result) return <NoSession sessionId={sessionParam} />;

  // Tính tỷ lệ 3 cột linh hoạt theo prototype.html
  let cols = "minmax(0, 24fr) minmax(0, 45fr) minmax(0, 31fr)";
  if (!leftOpen && rightOpen) {
    cols = "minmax(0, 69fr) minmax(0, 31fr)";
  } else if (leftOpen && !rightOpen) {
    cols = "minmax(0, 24fr) minmax(0, 76fr)";
  } else if (!leftOpen && !rightOpen) {
    cols = "minmax(0, 1fr)";
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <CockpitHeader
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onOpenTour={() => {
          handleEnsureColumnsOpen();
          setTourOpen(true);
        }}
      />
      <main
        id="main"
        style={{ "--cols": cols } as CSSProperties}
        className="main flex flex-col gap-3 p-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[var(--cols)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <aside id="colLeft" hidden={!leftOpen} aria-label="Bản đồ bài học" className={`col-left ${COLUMN}`}>
          <div className="pane">
            <LessonGraphPanel />
          </div>
        </aside>
        <section
          id="colMid"
          aria-label="Khung code"
          className="col col-mid min-w-0 overflow-hidden rounded-xl bg-[var(--panel)] shadow-sm max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:h-[min(440px,54vh)] lg:min-h-0"
        >
          <CodeSnippetViewer />
        </section>
        <aside id="colRight" hidden={!rightOpen} aria-label="X-Ray và Feynman" className={`col-right ${COLUMN}`}>
          <div id="right">
            <LearnSidePanel />
          </div>
        </aside>
      </main>

      <DuolingoTour
        open={tourOpen}
        onClose={handleCloseTour}
        onEnsureColumnsOpen={handleEnsureColumnsOpen}
      />
    </div>
  );
}
