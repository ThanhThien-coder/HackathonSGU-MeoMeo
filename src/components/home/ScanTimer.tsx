"use client";

import { useEffect, useState } from "react";

const TICK_MS = 250;

/** Phần có state đồng hồ: chỉ mount khi đang quét nên mỗi lần quét bắt đầu từ 0. */
function ScanOverlay() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const seconds = (elapsedMs / 1000).toFixed(1).replace(".", ",");

  return (
    <div className="sf-fade-in absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-overlay p-4 backdrop-blur-sm">
      <div className="glass flex flex-col items-center gap-2 rounded-xl px-6 py-5 text-text">
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-accent motion-reduce:animate-none"
        />
        <p role="status" className="font-semibold">
          Đang quét repo…
        </p>
        <p aria-live="off" className="text-sm tabular-nums text-muted">
          Đã chạy {seconds} s
        </p>
      </div>
    </div>
  );
}

/**
 * Lớp phủ đang quét có đồng hồ thật. Đồng hồ cập nhật 250 ms một lần và chỉ vẽ
 * lại chính component này, không kéo theo trang chủ. Đặt trong khối `relative`.
 */
export function ScanTimer({ running }: { running: boolean }) {
  return running ? <ScanOverlay /> : null;
}
