"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { CONFIG } from "@/contracts/config";
import { LoginScreen } from "@/components/home/LoginScreen";
import { CockpitHeader } from "@/components/learn/CockpitHeader";
import { LearnSidePanel } from "@/components/learn/LearnSidePanel";
import { LessonGraphPanel } from "@/components/learn/LessonGraphPanel";
import { Button } from "@/components/ui/common";
import { EmptyState } from "@/components/ui/Page";
import { useWorkbenchStore } from "@/store/workbench";

const COLUMN = "min-w-0 rounded-xl border border-line bg-panel lg:min-h-0 lg:overflow-auto";
const HOME_LINK =
  "inline-flex items-center justify-center rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold text-text transition-colors hover:bg-btn-hover";

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
        <div role="alert" className="rounded-xl border border-st-fail-border bg-st-fail-bg p-4 text-sm text-text">
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
      <p role="status" className="text-center text-muted">
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

/** Khung trang học: 3 cột từ 1024 px (`CONFIG.UI_PANE_WIDTHS_PCT`), dưới đó 1 cột và khung code dính đầu. */
export function LearnShell() {
  const sessionParam = useSearchParams().get("session");
  const result = useWorkbenchStore((s) => s.result);
  const activeNodeId = useWorkbenchStore((s) => s.active_node_id);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  if (!result) return <NoSession sessionId={sessionParam} />;

  const [left, mid, right] = CONFIG.UI_PANE_WIDTHS_PCT;
  const cols = [leftOpen ? left : null, mid, rightOpen ? right : null]
    .filter((w) => w !== null)
    .map((w) => `minmax(0,${w}fr)`)
    .join(" ");
  const activeTitle = result.nodes.find((n) => n.id === activeNodeId)?.title;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <CockpitHeader
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
      />
      <main
        style={{ "--cols": cols } as CSSProperties}
        className="flex flex-col gap-3 p-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[var(--cols)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <aside hidden={!leftOpen} aria-label="Bản đồ bài học" className={COLUMN}>
          <LessonGraphPanel />
        </aside>
        <section
          aria-label="Khung code"
          className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel max-lg:sticky max-lg:top-0 max-lg:z-[5] max-lg:h-[min(430px,52vh)] lg:min-h-0"
        >
          <p className="p-4 text-sm text-muted">
            {activeTitle
              ? `Đang mở bài “${activeTitle}”. Khung code sẽ hiện ở bước sau.`
              : "Chọn một bài ở bản đồ bên trái để bắt đầu."}
          </p>
        </section>
        <aside hidden={!rightOpen} aria-label="X-Ray và Feynman" className={COLUMN}>
          <LearnSidePanel />
        </aside>
      </main>
    </div>
  );
}
