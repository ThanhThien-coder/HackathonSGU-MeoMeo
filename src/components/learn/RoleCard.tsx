"use client";

// Thẻ vai trò đầu bài (UI-41, D-84) theo prototype `#xray` stage "role".
// Dòng nào thiếu dữ liệu thì ẩn; "Vai trò" chờ AI thì hiện shimmer, không để trống.
import type { ReactNode } from "react";
import type { RoleCardView } from "@/lib/role-card";
import { Chip } from "@/components/ui/common";

export interface RoleCardProps {
  view: RoleCardView;
  hasWarning?: boolean;
  /** `true` ⇒ dòng "Vai trò" hiện shimmer "đang phân tích…" (chưa có `architecture.summary`). */
  rolePending?: boolean;
}

const TAG = "ml-0.5 inline-block rounded-full border border-line px-2 text-[11.5px] text-muted";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="m-0 mt-1.5 text-sm leading-relaxed">
      <b>{label}:</b> {children}
    </p>
  );
}

export function RoleCard({ view, hasWarning = false, rolePending = false }: RoleCardProps) {
  return (
    <section aria-labelledby="rp-title" className="rounded-[10px] border border-line bg-panel-2 px-3.5 py-3">
      <h2 id="rp-title" tabIndex={-1} className="m-0 flex flex-wrap items-baseline gap-2 text-base font-bold outline-none">
        {hasWarning ? (
          <span role="img" aria-label="Node trước chưa vững" title="Node trước chưa vững" className="text-amber">
            ⚠
          </span>
        ) : null}
        <span>
          {view.name} · {view.evidence}
        </span>
        {view.is_capstone ? (
          <span role="img" aria-label="bài quan trọng" className="text-amber">
            ★
          </span>
        ) : null}
        {view.is_algorithmic ? <Chip tone="violet">Thuật toán</Chip> : null}
        {view.support_tier === "STRUCTURAL" ? <Chip title="Hiểu cấu trúc code, chưa lần theo được lời gọi chính xác">Suy luận</Chip> : null}
      </h2>

      {view.role ? (
        <Row label="Vai trò">{view.role}</Row>
      ) : rolePending ? (
        <p className="m-0 mt-1.5 text-sm text-muted" role="status">
          <b className="text-text">Vai trò:</b> <span className="inline-block h-3 w-40 animate-pulse rounded bg-line align-middle" />{" "}
          <span className="text-xs">đang phân tích…</span>
        </p>
      ) : null}

      {view.requires.length > 0 ? <Row label="Cần trước">{view.requires.join(", ")}</Row> : null}
      {view.unlocks.length > 0 ? <Row label="Mở ra cho">{view.unlocks.map((n) => `→ ${n}`).join(", ")}</Row> : null}
      {view.entities.length > 0 ? (
        <Row label="Dữ liệu">
          {view.entities.map((e, i) => (
            <span key={e.name}>
              {i > 0 ? " · " : null}
              {e.name}{" "}
              {e.ops.map((o) => (
                <span key={o.op} className={TAG}>
                  {o.label}
                </span>
              ))}
            </span>
          ))}
        </Row>
      ) : null}
    </section>
  );
}
