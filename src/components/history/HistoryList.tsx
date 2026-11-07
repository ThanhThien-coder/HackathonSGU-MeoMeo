import type { AttemptHistoryItem } from "@/contracts/storage";
import { HistoryItem } from "./HistoryItem";

interface HistoryListProps {
  items: readonly (AttemptHistoryItem & { question?: string })[];
  sample: boolean;
}

export function HistoryList({ items, sample }: HistoryListProps) {
  const newestFirst = items.toSorted((a, b) => b.created_at - a.created_at);

  return (
    <>
      {sample && (
        <p className="mb-4 text-sm text-muted">
          <strong className="font-semibold text-text">Dữ liệu mẫu</strong>
          <span> · Các lượt bên dưới minh họa cách trang hiển thị lịch sử.</span>
        </p>
      )}
      <ol className="space-y-3">
        {newestFirst.map((item) => (
          <li key={`${item.node_id}:${item.question_index}:${item.attempt_number}:${item.created_at}`}>
            <HistoryItem item={item} question={item.question} />
          </li>
        ))}
      </ol>
    </>
  );
}
