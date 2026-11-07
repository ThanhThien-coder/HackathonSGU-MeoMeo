"use client";

import { useEffect, useState } from "react";
import { BorderBeam } from "@/components/ui/border-beam";
import { Ripple } from "@/components/ui/ripple";

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
    <div className="sf-fade-in absolute inset-0 z-50 flex items-center justify-center overflow-hidden rounded-3xl bg-overlay p-4 backdrop-blur-md">
      <Ripple mainCircleSize={95} numCircles={5} />
      <div className="glass relative z-10 flex flex-col items-center gap-2.5 overflow-hidden rounded-2xl px-7 py-6 text-text ring-1 ring-border">
        <BorderBeam size={90} duration={5} />
        <span
          aria-hidden="true"
          className="size-9 animate-spin rounded-full border-2 border-panel3 border-t-accent shadow-[0_0_16px_var(--accent-glow)] motion-reduce:animate-none"
        />
        <p role="status" className="font-bold tracking-tight">
          Đang quét repo…
        </p>
        <p aria-live="off" className="rounded-full bg-panel-2 px-3 py-0.5 font-mono text-xs tabular-nums text-accent ring-1 ring-border">
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
