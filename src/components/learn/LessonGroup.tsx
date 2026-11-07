"use client";

import type { ReactNode } from "react";
import { Chip } from "@/components/ui/common";
import type { LessonGroupView } from "@/lib/lesson-map";

export function LessonGroup({
  group,
  open,
  onToggle,
  children,
}: {
  group: LessonGroupView;
  open: boolean;
  onToggle: (groupId: string) => void;
  children: ReactNode;
}) {
  const bodyId = `grp-${group.group_id}`;
  return (
    <section className="mb-2.5 overflow-hidden rounded-[10px] border border-line bg-bg">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(group.group_id)}
        className="flex w-full items-center gap-2 bg-panel-2 px-2.5 py-2 text-left"
      >
        <span
          aria-hidden="true"
          className={`inline-block text-muted transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span className="font-semibold text-text">{group.name}</span>
        {group.recommended ? <Chip tone="ready">★ Nên học trước</Chip> : null}
        <span className="ml-auto text-xs text-muted">{group.node_ids.length} bài</span>
      </button>
      <div id={bodyId} hidden={!open} className="grid gap-2 p-2">
        {children}
      </div>
    </section>
  );
}
