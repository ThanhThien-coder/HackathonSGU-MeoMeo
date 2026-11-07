"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DuolingoTourProps {
  open: boolean;
  onClose: () => void;
  onEnsureColumnsOpen?: () => void;
}

interface TourStepDef {
  targetId: string;
  tag: string;
  title: string;
  text: string;
  btnNext: string;
  btnPrev?: string;
  prefer: "left" | "right";
  allowSelect?: boolean;
}

const TOUR_STEPS: TourStepDef[] = [
  {
    targetId: "colRight",
    tag: "BƯỚC 1 / 4 · BẮT ĐẦU TẠI ĐÂY",
    title: "TRUNG TÂM X-RAY & FEYNMAN",
    text: "Đây là trái tim của việc học! Tab X-Ray dẫn dắt bạn qua từng tầng kiến trúc của chức năng (Controller → Service → DB). Sau đó, tab Feynman giúp bạn củng cố bằng cách tự giải thích code.",
    btnNext: "Tiếp theo: Khung Code →",
    prefer: "left",
  },
  {
    targetId: "colMid",
    tag: "BƯỚC 2 / 4 · TRỰC QUAN MÃ NGUỒN",
    title: "KHUNG CODE & LIÊN KẾT LUỒNG",
    text: "Mã nguồn thực tế từ repo. Khi bạn bấm từng bước ở X-Ray bên phải, các dòng code liên quan sẽ tự động sáng đèn và cảnh báo điểm sáng hoặc điểm yếu kiến trúc tiềm ẩn.",
    btnNext: "Tiếp theo: Tô chọn code →",
    btnPrev: "← Quay lại",
    prefer: "right",
  },
  {
    targetId: "colMid",
    tag: "BƯỚC 3 / 4 · TƯƠNG TÁC MÃ NGUỒN",
    title: "TÔ CHỌN CODE ĐỂ XEM MÔ TẢ",
    text: "Khi bạn bôi đen một biến, hàm hoặc dòng lệnh, một nút \"Giải thích\" nhỏ sẽ xuất hiện. Bấm vào nút này để mở bảng phân tích vai trò kiến trúc của đoạn mã đó!",
    btnNext: "Tiếp theo: Bản đồ bài học →",
    btnPrev: "← Quay lại",
    prefer: "right",
    allowSelect: true,
  },
  {
    targetId: "colLeft",
    tag: "BƯỚC 4 / 4 · TIẾN ĐỘ & MỞ KHÓA",
    title: "BẢN ĐỒ BÀI HỌC KIẾN TRÚC",
    text: "Toàn bộ các lát cắt nghiệp vụ của hệ thống được gom nhóm theo thực thể. Hoàn thành từng bài để mở khóa các lát cắt phức tạp hơn tiếp theo!",
    btnNext: "BẮT ĐẦU HỌC NGAY",
    btnPrev: "← Quay lại",
    prefer: "right",
  },
];

export function DuolingoTour({ open, onClose, onEnsureColumnsOpen }: DuolingoTourProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [shake, setShake] = useState(false);
  const [selectedSampleText, setSelectedSampleText] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; arrowClass: string }>({
    top: 100,
    left: 100,
    arrowClass: "arrow-left",
  });

  const popupRef = useRef<HTMLDivElement>(null);

  // Mở tour ⇒ đảm bảo 2 cột 2 bên được mở để spotlight thấy rõ
  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setSelectedSampleText(null);
      onEnsureColumnsOpen?.();
      document.body.classList.add("in-tour");
    } else {
      document.body.classList.remove("in-tour", "tour-allow-select");
      document.querySelectorAll(".col").forEach((col) => col.classList.remove("tour-focused"));
    }
    return () => {
      document.body.classList.remove("in-tour", "tour-allow-select");
      document.querySelectorAll(".col").forEach((col) => col.classList.remove("tour-focused"));
    };
  }, [open, onEnsureColumnsOpen]);

  // Cập nhật bước tour và vị trí spotlight
  useEffect(() => {
    if (!open) return;
    const step = TOUR_STEPS[stepIdx];
    if (!step) return;

    if (step.allowSelect) {
      document.body.classList.add("tour-allow-select");
    } else {
      document.body.classList.remove("tour-allow-select");
    }

    // Xóa focused cũ, gắn lên cột mục tiêu
    document.querySelectorAll(".col").forEach((col) => col.classList.remove("tour-focused"));
    const target = document.getElementById(step.targetId);
    if (target) {
      target.classList.add("tour-focused");
    }

    // Tính toán vị trí popup
    const updatePosition = () => {
      const el = document.getElementById(step.targetId);
      if (!el) return;
      const targetRect = el.getBoundingClientRect();
      const popW = 350;
      const popH = popupRef.current?.offsetHeight || 260;
      const margin = 16;
      let top = 100;
      let left = 100;
      let arrow = "arrow-left";

      if (window.innerWidth >= 1024) {
        if (step.prefer === "left") {
          left = targetRect.left - popW - margin;
          top = targetRect.top + 40;
          if (left < 16) {
            left = targetRect.right + margin;
            arrow = "arrow-left";
          } else {
            arrow = "arrow-right";
          }
        } else {
          left = targetRect.right + margin;
          top = targetRect.top + 40;
          if (left + popW > window.innerWidth - 16) {
            left = targetRect.left - popW - margin;
            arrow = "arrow-right";
          } else {
            arrow = "arrow-left";
          }
        }
      } else {
        left = Math.max(16, Math.min(window.innerWidth - popW - 16, targetRect.left + (targetRect.width - popW) / 2));
        top = targetRect.bottom + margin;
        if (top + popH > window.innerHeight - 16) {
          top = Math.max(16, targetRect.top - popH - margin);
          arrow = "arrow-bottom";
        } else {
          arrow = "arrow-top";
        }
      }

      setPopupPos({ top, left, arrowClass: arrow });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, stepIdx]);

  // Lắng nghe sự kiện bôi đen code trong tour
  useEffect(() => {
    if (!open) return;
    const handleCustomSelect = (e: Event) => {
      const ce = e as CustomEvent<{ text: string }>;
      if (ce.detail?.text) {
        setSelectedSampleText(ce.detail.text);
      }
    };
    window.addEventListener("sf:code-selected", handleCustomSelect);
    return () => window.removeEventListener("sf:code-selected", handleCustomSelect);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const currentStep = TOUR_STEPS[stepIdx];

  const handleBackdropClick = () => {
    setShake(true);
    setTimeout(() => setShake(false), 360);
  };

  const handleNext = () => {
    if (stepIdx < TOUR_STEPS.length - 1) {
      setStepIdx((i) => i + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (stepIdx > 0) {
      setStepIdx((i) => i - 1);
    }
  };

  const handleSampleSelect = () => {
    window.dispatchEvent(new CustomEvent("sf:tour-sample-select", { detail: { sample: "productService.listProducts" } }));
    setSelectedSampleText("productService.listProducts");
  };

  return createPortal(
    <div id="tourOverlay">
      <div id="tourBackdrop" onClick={handleBackdropClick} title="Chọn Bỏ qua hoặc Tiếp tục" />
      <div
        ref={popupRef}
        id="tourPopup"
        role="dialog"
        aria-modal="true"
        aria-label="Hướng dẫn tính năng"
        style={{ top: `${popupPos.top}px`, left: `${popupPos.left}px` }}
        className={`duo-popup ${popupPos.arrowClass} ${shake ? "duo-shake" : ""}`}
      >
        <div className="duo-tag">{currentStep.tag}</div>
        <h3 className="duo-title">{currentStep.title}</h3>
        <p className="duo-body">{currentStep.text}</p>

        {currentStep.allowSelect ? (
          <div className="my-2.5">
            <button
              type="button"
              onClick={handleSampleSelect}
              className="duo-btn-sec w-full py-1.5 text-center text-xs font-semibold"
            >
              Tô thử mẫu &quot;productService.listProducts&quot;
            </button>
            <div className="mt-1.5 min-h-[18px] text-[11.5px]">
              {selectedSampleText ? (
                <span className="text-[var(--done)]">
                  Đã nhận diện: <b>{selectedSampleText.length > 25 ? `${selectedSampleText.slice(0, 25)}…` : selectedSampleText}</b>. Bảng mô tả chức năng đã hiện bên cạnh!
                </span>
              ) : (
                <span className="text-[var(--muted)]">
                  Chưa tô chọn đoạn mã. Hãy kéo chuột trên khung code để thử!
                </span>
              )}
            </div>
          </div>
        ) : null}

        <div className="duo-footer mt-4">
          {stepIdx > 0 ? (
            <button type="button" onClick={handlePrev} className="duo-btn-sec">
              {currentStep.btnPrev ?? "← Quay lại"}
            </button>
          ) : (
            <button type="button" onClick={onClose} className="duo-btn-skip">
              Bỏ qua
            </button>
          )}

          <div className="duo-next-group">
            <svg
              className="duo-bounce-arrow"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3 10.5C3 9.67 3.67 9 4.5 9H13V5.41C13 4.52 14.08 4.08 14.71 4.71L21.29 11.29C21.68 11.68 21.68 12.32 21.29 12.71L14.71 19.29C14.08 19.92 13 19.48 13 18.59V15H4.5C3.67 15 3 14.33 3 13.5V10.5Z" />
            </svg>
            <button type="button" onClick={handleNext} className="duo-btn-primary">
              {currentStep.btnNext}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
