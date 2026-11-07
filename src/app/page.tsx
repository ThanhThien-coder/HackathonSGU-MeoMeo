"use client";

import { IngestBox } from "@/components/home/IngestBox";
import { LoginScreen, OfflineCard } from "@/components/home/LoginScreen";
import { SessionList } from "@/components/home/SessionList";
import { Boot } from "@/components/layout/Boot";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/common";
import { useWorkbenchStore } from "@/store/workbench";

/**
 * Trang chủ chỉ chọn khối để hiện theo `ui.auth` (do `Boot` gọi `loadMe` đặt). Không giữ
 * state đồng hồ hay state ingest: mỗi khối tự lo.
 */
export default function Home() {
  const auth = useWorkbenchStore((s) => s.ui.auth);
  const fixture = useWorkbenchStore((s) => s.ui.fixture);
  const offline = useWorkbenchStore((s) => s.is_offline_mode);
  const bootError = useWorkbenchStore((s) => s.ui.boot_error);
  const loadMe = useWorkbenchStore((s) => s.loadMe);

  let view;
  if (auth === "SIGNED_IN" || fixture) {
    view = (
      <div className="flex flex-col gap-8">
        <IngestBox />
        {/* Fixture và Offline không có API: không hiện "Tiếp tục học" (nó sẽ báo lỗi tải oan). */}
        {auth === "SIGNED_IN" && !fixture && !offline ? <SessionList /> : null}
      </div>
    );
  } else if (auth === "SIGNED_OUT") {
    view = <LoginScreen />;
  } else {
    // Chưa biết đã đăng nhập hay chưa: không nháy màn hình đăng nhập, luôn có lối ra Offline.
    view = (
      <section className="mx-auto flex w-full max-w-md flex-col gap-4">
        <p role="status" className="text-center text-muted">
          {bootError ? bootError.message : "Đang kiểm tra đăng nhập…"}
        </p>
        {bootError ? (
          <div className="text-center">
            <Button variant="small" onClick={() => void loadMe({ force: true })}>
              Thử lại
            </Button>
          </div>
        ) : null}
        <OfflineCard />
      </section>
    );
  }

  return (
    <>
      <Boot />
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">{view}</main>
    </>
  );
}
