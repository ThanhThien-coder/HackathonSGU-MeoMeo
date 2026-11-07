"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "@/components/layout/BrandMark";
import { Button } from "@/components/ui/common";
import { signInWithGithub } from "@/lib/supabase/client";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      // Về lại đúng trang đang đứng (VD `/learn?session=…`); đang ở `/login` thì về trang chủ.
      const here = window.location.pathname + window.location.search;
      await signInWithGithub(here.startsWith("/login") ? undefined : here);
    } catch {
      setError("Chưa mở được trang đăng nhập GitHub. Hãy thử lại, hoặc xem bản demo Offline.");
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-line bg-panel p-6 sm:p-8">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-text">
          <BrandMark className="size-7" />
          SimpliFey
        </h1>
        <p className="mt-1 text-muted">
          Đăng nhập bằng GitHub để quét repo và học theo từng bài.
        </p>
      </div>
      <Button variant="primary" disabled={busy} onClick={() => void signIn()} className="w-full">
        {busy ? "Đang chuyển tới GitHub…" : "Đăng nhập GitHub"}
      </Button>
      {error ? (
        <p role="alert" className="m-0 text-sm text-st-fail-fg">
          {error}
        </p>
      ) : null}
      <OfflineCard />
    </section>
  );
}
