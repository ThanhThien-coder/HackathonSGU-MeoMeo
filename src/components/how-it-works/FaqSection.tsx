const questions = [
  {
    question: "Nên bắt đầu với repo nào?",
    answer:
      "Hãy thử một repo web công khai viết bằng TypeScript hoặc JavaScript, có route và luồng xử lý rõ ràng. Đó là phạm vi ưu tiên của bản thi.",
  },
  {
    question: "SimpliFey có chạy hoặc lưu mã nguồn của repo không?",
    answer:
      "Hệ thống phân tích tĩnh trong bộ nhớ và không chạy mã nguồn của repo. Phiên học chỉ lưu các đoạn code đã cắt để bạn có thể mở lại đúng bài.",
  },
  {
    question: "AI có thể giải thích hoặc chấm sai không?",
    answer:
      "Có. Bộ kiểm tra có thể chặn tên hàm không có trong code hoặc công nghệ ngoài repo, nhưng AI vẫn có thể hiểu sai luồng. Bạn có thể đối chiếu nhận định với đoạn code trong tour.",
  },
  {
    question: "Nếu chưa đạt một bài, mình có học tiếp được không?",
    answer:
      "Có. Khi đã làm xong các câu trong bài, bạn vẫn có thể mở bài kế tiếp nếu đã hoàn thành các điều kiện còn lại, kể cả khi bài hiện tại chưa đạt.",
  },
  {
    question: "Vì sao kỹ năng có nhãn “đang mài mòn”?",
    answer:
      "Nhãn này xuất hiện khi mức thành thạo ước tính giảm xuống một bậc vì lâu chưa luyện. Đây là dấu hiệu trên thanh kỹ năng. Các bài đã làm giữ nguyên trạng thái.",
  },
];

export function FaqSection() {
  return (
    <section aria-labelledby="faq-title">
      <h2 id="faq-title" className="mb-4 text-xl font-semibold">
        Câu hỏi thường gặp
      </h2>
      <div className="space-y-2">
        {questions.map(({ question, answer }) => (
          <details key={question} className="rounded-lg border border-line bg-panel">
            <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {question}
            </summary>
            <p className="px-4 pb-4 text-sm leading-relaxed text-muted">
              {answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
