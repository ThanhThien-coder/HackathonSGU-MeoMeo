import Link from "next/link";
import { Button } from "@/components/ui/common";

const OFFLINE_HREF = "/learn?offline=1";

/** Thẻ "Bản demo Offline": luôn có ở màn hình đăng nhập, không cần tài khoản. */
export function OfflineCard() {
  return (
    <div className="rounded-xl border border-line bg-panel-2 p-4">
      <h2 className="text-base font-bold text-text">Bản demo Offline</h2>
      <p className="mt-1 text-sm text-muted">
        Xem thử trang học bằng dữ liệu ghi lại sẵn. Không cần đăng nhập, không
        lưu tiến độ.
      </p>
      <Link
        href={OFFLINE_HREF}
        className="mt-3 inline-flex items-center justify-center rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold text-text transition-colors hover:bg-btn-hover"
      >
        Mở bản demo Offline
      </Link>
    </div>
  );
}

export function LoginScreen() {
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-line bg-panel p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold text-text">SimpliFey</h1>
        <p className="mt-1 text-muted">
          Đăng nhập bằng GitHub để quét repo và học theo từng bài.
        </p>
      </div>
      {/* TODO(TH-06): khi `src/lib/supabase/client.ts` merge, gọi `signInWithGithub()`,
          bật nút và đổi nhãn về "Đăng nhập GitHub". */}
      <Button variant="primary" disabled className="w-full">
        Đăng nhập (đang nối)
      </Button>
      <OfflineCard />
    </section>
  );
}
