"use client";

// Nhóm bài học cột trái (.grp) theo prototype.html & TasteSkill 2.5
import type { ReactNode } from "react";
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
    <section className="grp mb-3 overflow-hidden rounded-[10px] bg-[var(--bg)] transition-colors">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(group.group_id)}
        className="grp-h flex w-full items-center gap-2 bg-[var(--panel2)] hover:bg-[var(--panel3)] px-3 py-2.5 text-left transition-colors cursor-pointer"
      >
        <span
          aria-hidden="true"
          className={`chev inline-block text-[11px] text-[var(--muted)] transition-transform duration-200 ${
            open ? "rotate-90 text-[var(--accent)]" : ""
          }`}
        >
          ▸
        </span>
        <span className="gname font-semibold text-[13.5px] text-[var(--text)]">{group.name}</span>
        {group.recommended ? (
          <span className="badge text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--ready-bg)] text-[var(--ready)]">
            Nên học trước
          </span>
        ) : null}
        <span className="cnt ml-auto text-xs text-[var(--muted)]">{group.node_ids.length} bài</span>
      </button>
      <div id={bodyId} hidden={!open} className="grp-b grid gap-2 p-2.5">
        {children}
      </div>
    </section>
  );
}
