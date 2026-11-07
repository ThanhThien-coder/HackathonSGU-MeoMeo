import { HistoryList } from "@/components/history/HistoryList";
import { HISTORY_SAMPLE } from "@/components/history/history-sample";
import { EmptyState, PageHeader } from "@/components/ui/Page";

interface HistoryPageProps {
  searchParams: Promise<{ session?: string | string[] }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const { session } = await searchParams;
  const hasSession = typeof session === "string" && session.trim().length > 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <PageHeader title="Lịch sử nộp bài" />
      {hasSession ? (
        <HistoryList items={HISTORY_SAMPLE} sample />
      ) : (
        <EmptyState
          title="Chưa chọn phiên học"
          description="Mở lịch sử từ một phiên học để xem các lượt nộp của bạn."
        />
      )}
    </main>
  );
}
