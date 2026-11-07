"use client";

// Chip kỹ năng của bước đang xem + thanh mài mòn kiểu Duolingo (D-35, BKT-24). Chỉ hiển thị: không nút ôn,
// không đổi màu node. Bấm chip chỉ hiện `skills[].reason` (không popover thẻ khái niệm, B11).
import { useMemo, useState } from "react";
import type { AnalysisSkill, LearnerCognitiveProfile } from "@/contracts";
import { CONCEPT_CARDS } from "@/components/how-it-works/concept-cards";
import { getDecayedMastery, isDecaying, tierOf } from "@/lib/bkt-engine";

export interface SkillChipsProps {
  skills: AnalysisSkill[];
  profile: LearnerCognitiveProfile | null;
  /** `server_clock_offset_ms`: `now = Date.now() + offset`. */
  serverClockOffsetMs: number;
}

const TIER_LABELS = { NOVICE: "Mới học", PRACTITIONER: "Đang vững", ARCHITECT: "Thành thạo" } as const;
/** Chân độ đậm: kỹ năng rất cũ vẫn thấy được thanh. */
const MIN_OPACITY = 0.3;

interface ChipView {
  key: string;
  skill: AnalysisSkill;
  label: string;
  /** null khi chưa có hồ sơ ⇒ không vẽ thanh. */
  bar: { decayed: number; base: number; opacity: number; decaying: boolean; tier: keyof typeof TIER_LABELS } | null;
}

export function SkillChips({ skills, profile, serverClockOffsetMs }: SkillChipsProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Tính lại khi `profile` đổi, không tính lại mỗi lần vẽ (đồng hồ chỉ cần chính xác tới mức ngày).
  const views = useMemo<ChipView[]>(() => {
    const now = Date.now() + serverClockOffsetMs;
    return skills.map((skill, i) => {
      const state = profile?.skills[skill.skill];
      let bar: ChipView["bar"] = null;
      if (profile) {
        const decayed = getDecayedMastery(state, now);
        const base = state?.p_mastery ?? decayed;
        bar = {
          decayed,
          base,
          opacity: base > 0 ? Math.min(1, Math.max(MIN_OPACITY, decayed / base)) : 1,
          decaying: isDecaying(state, now),
          tier: tierOf(decayed),
        };
      }
      return { key: `${skill.skill}-${skill.symbol}-${i}`, skill, label: CONCEPT_CARDS[skill.skill]?.name_vi ?? skill.skill, bar };
    });
  }, [skills, profile, serverClockOffsetMs]);

  if (views.length === 0) return null;
  const open = views.find((v) => v.key === openKey) ?? null;

  return (
    <div>
      <span className="mb-1.5 block text-xs text-muted">Kỹ năng ở bước này (bấm để xem thẻ khái niệm):</span>
      <ul className="m-0 flex list-none flex-wrap items-start gap-2 p-0">
        {views.map((v) => {
          const faded = v.bar !== null && v.bar.decayed < v.bar.base - 0.00005;
          const tooltip = v.bar
            ? faded
              ? `Điểm gốc ${v.bar.base.toFixed(4)} — đã giảm còn ${v.bar.decayed.toFixed(4)} vì lâu chưa luyện`
              : `Điểm ${v.bar.decayed.toFixed(4)} · ${TIER_LABELS[v.bar.tier]}`
            : v.skill.reason;
          return (
            <li key={v.key} className="flex flex-col gap-1">
              <button
                type="button"
                title={`${v.skill.reason}\n${v.bar ? tooltip : ""}`.trim()}
                aria-expanded={openKey === v.key}
                onClick={() => setOpenKey((k) => (k === v.key ? null : v.key))}
                className="rounded-full border border-accent bg-hl-step px-3 py-[3px] text-[13px] text-text transition-colors hover:brightness-110"
              >
                {v.label}
                {v.bar?.decaying ? (
                  <span className="ml-1.5 text-[11px] font-semibold text-st-ready-fg">đang mài mòn</span>
                ) : null}
              </button>
              {v.bar ? (
                <span
                  role="img"
                  aria-label={`${v.label}: ${(v.bar.decayed * 100).toFixed(0)} phần trăm, ${TIER_LABELS[v.bar.tier]}`}
                  className="block h-1 overflow-hidden rounded-full bg-line"
                >
                  <i
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, v.bar.decayed * 100)}%`, opacity: v.bar.opacity }}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {open ? (
        <p className="m-0 mt-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] leading-relaxed" role="note">
          <b>{open.label}:</b> {open.skill.reason}
        </p>
      ) : null}
    </div>
  );
}
