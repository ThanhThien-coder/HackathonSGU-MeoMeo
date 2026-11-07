"use client";

import { IngestBox } from "@/components/home/IngestBox";
import { LoginScreen, OfflineCard } from "@/components/home/LoginScreen";
import { useWorkbenchStore } from "@/store/workbench";

/**
 * Trang chủ chỉ chọn khối để hiện theo `ui.auth` (do `Boot` / `loadMe` đặt, trang này
 * không gọi `/api/me`). Không giữ state đồng hồ hay state ingest: mỗi khối tự lo.
 */
export default function Home() {
  const auth = useWorkbenchStore((s) => s.ui.auth);
  const fixture = useWorkbenchStore((s) => s.ui.fixture);
  const bootError = useWorkbenchStore((s) => s.ui.boot_error);

  let view;
  if (auth === "SIGNED_IN" || fixture) {
    view = <IngestBox />;
  } else if (auth === "SIGNED_OUT") {
    view = <LoginScreen />;
  } else {
    // Chưa biết đã đăng nhập hay chưa: không nháy màn hình đăng nhập, vẫn có lối ra Offline.
    view = (
      <section className="mx-auto flex w-full max-w-md flex-col gap-4">
        <p role="status" className="text-center text-muted">
          {bootError ? bootError.message : "Đang kiểm tra đăng nhập…"}
        </p>
        <OfflineCard />
      </section>
    );
  }

  return <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">{view}</main>;
}
