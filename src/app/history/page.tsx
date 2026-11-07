import { EmptyState, PageHeader } from "@/components/ui/Page";

export default function HistoryPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <PageHeader title="Lịch sử nộp bài" />
      <EmptyState
        title="Chưa chọn phiên học"
        description="Mở lịch sử từ một phiên học để xem các lượt nộp của bạn."
      />
    </main>
  );
}
