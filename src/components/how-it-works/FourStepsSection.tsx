const steps = [
  {
    title: "Dán link GitHub",
    description:
      "Dán link repo công khai. SimpliFey dùng thuật toán để lần theo các luồng trong mã nguồn và dựng bản đồ bài học với 0 token AI.",
  },
  {
    title: "Theo tour X-Ray",
    description:
      "Xem thẻ vai trò để biết bài này phụ trách phần nào. Sau đó, lần qua từng đoạn code và xem tóm tắt điểm hay, điểm dở của luồng.",
  },
  {
    title: "Tự giải thích bằng lời",
    description:
      "Trả lời câu hỏi Feynman bằng lời của bạn. AI chấm theo các ý chính và gợi ý bạn nên xem lại phần nào nếu câu trả lời còn thiếu.",
  },
  {
    title: "Mở bài tiếp theo",
    description:
      "Khi mỗi câu kết thúc, hệ thống cập nhật điểm kỹ năng tương ứng. Khi làm xong bài, bạn có thể mở những bài kế tiếp đã đủ điều kiện.",
  },
];

export function FourStepsSection() {
  return (
    <section aria-labelledby="learning-steps-title">
      <h2 id="learning-steps-title" className="mb-4 text-xl font-semibold">
        Bốn bước học
      </h2>
      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map(({ title, description }, index) => (
          <li key={title} className="rounded-lg border border-line bg-panel p-4">
            <p className="mb-2 text-sm font-medium text-muted">
              Bước {index + 1}
            </p>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {description}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
