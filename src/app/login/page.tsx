"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginScreen } from "@/components/home/LoginScreen";
import { useWorkbenchStore } from "@/store/workbench";

export default function LoginPage() {
  const router = useRouter();
  const auth = useWorkbenchStore((s) => s.ui.auth);

  // Đã đăng nhập ⇒ về `/`. Trạng thái `auth` do `Boot` đặt, trang này không gọi `/api/me`.
  useEffect(() => {
    if (auth === "SIGNED_IN") router.replace("/");
  }, [auth, router]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <LoginScreen />
    </main>
  );
}
