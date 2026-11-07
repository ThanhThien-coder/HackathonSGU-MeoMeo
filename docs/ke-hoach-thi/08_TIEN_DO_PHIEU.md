# 08 — Tiến độ từng phiếu

> Bảng theo dõi trạng thái của **68 phiếu** (Thiện 19, Minh 13, Nhân 13, Phát 15, Quý 8). Mỗi người cập nhật dòng phiếu của mình ngay sau khi merge, rồi nhắn nhóm "đã merge <mã phiếu>" như `00_CAM_TAY_CHI_VIEC.md` Mục 3.
> **Cập nhật lần cuối:** 07/11/2026, 17:25 (đối chiếu với `origin/main` tới PR #58 và danh sách PR trên GitHub, gồm PR đang mở #39, #50, #53, #59).
> Danh sách phiếu, giờ và cách làm gốc nằm ở `02_PHIEU_<TEN>.md`. File này chỉ ghi trạng thái, không đổi nội dung phiếu.

## Cách đọc

| Ký hiệu | Nghĩa |
| :-- | :-- |
| ✅ | Đã merge vào `main` (ghi số PR) |
| ◐ | Xong một phần: PR đã merge nhưng phiếu còn việc (ví dụ phần lõi đã có, route hoặc deploy chưa). Cột "Ghi chú" nói còn thiếu gì |
| 🔄 | Đang làm: PR đang mở, hoặc nhánh đã push nhưng chưa có PR |
| ⬜ | Chưa làm |
| ❓ | Chưa thấy dấu vết trên git (phiếu làm tay, hoặc làm ngoài repo). Người phụ trách tự xác nhận |

**Cách cập nhật:** đổi ký hiệu ở cột "Trạng thái", điền số PR vào cột "PR", ghi chú ngắn nếu có lệch so với phiếu (cắt phần nào, làm bù phần nào). Không sửa cột "Giờ" (giờ kế hoạch gốc). Chỉ `git add` đúng file này, không `git add .`.

## Tổng quan

| Người | Xong ✅ | Một phần ◐ | Đang làm 🔄 | Chưa làm ⬜ | Tổng | Phiếu tiếp theo |
| :-: | :-: | :-: | :-: | :-: | :-: | :-- |
| Thiện | 6 | 1 | 1 | 11 | 19 | Merge #59 (TH-08); TH-09 (giải nén, lọc, che secret), TH-19 (pipeline); nốt deploy Cloud Run của TH-04; TH-11, TH-12 (các API còn thiếu) |
| Minh | 7 | 2 | 0 | 4 | 13 | `src/server/engine/index.ts` của MI-06 (chờ TH-09); nốt MI-09 (kiểm trên Cloud Run, chốt repo demo) |
| Nhân | 7 | 1 | 2 | 3 | 13 | Merge #53 (NH-07 route chấm bài) và #50 (script ghi bundle); #39 (NH-08); đọc 3 bài của MI-07 |
| Phát | 13 | 0 | 0 | 2 | 15 | Không còn phiếu nào làm được ngay: PH-14 chờ TH-17 và NH-12, PH-15 lúc 08:00 |
| Quý | 4 | 0 | 0 | 4 | 8 | QU-04 (làm tay, áp phích) |
| **Cả đội** | **37** | **4** | **3** | **24** | **68** | |

Ghi chú: các con số trên đếm theo PR đã merge trên `main` (tới PR #58). PR đang mở: #39 (NH-08, phần chỉnh prompt làm sớm), #50 (NH-10, script ghi bundle), #53 (NH-07, route chấm bài), #59 (TH-08, tải zip). Phiếu làm tay (không có PR) tính là ⬜ hoặc ❓ cho tới khi người phụ trách xác nhận.

**Điểm nghẽn hiện tại:**
- `src/app/api/` đã có `health`, `me`, `ingest`, `analyze-node`, `enrich-node`, `explain-selection`. Còn thiếu `evaluate-feynman`, `reveal` (#53 đang mở, bản tạm `db.tx`, đổi sang `progress.ts` khi TH-12 xong) và `GET /api/sessions`, `GET /api/sessions/{id}/progress` (TH-11). PH-09 đã gọi endpoint progress nên bản thật chưa chạy được.
- **Tầng thu thập mã nguồn thật còn dở:** TH-08 (#59) đang chờ merge, TH-09 chưa làm. `src/server/engine/index.ts` của Minh cần `runIngest` của TH-09 nên chưa viết được; `/api/ingest` vẫn chạy bằng engine giả `stub.ts` (xóa ở TH-10).
- `public/demo/mock_bundle.json` chưa có (NH-12, ghi trên bản đóng băng). Bấm Offline lúc này rơi vào đường "bundle hỏng" (toast, chạy chế độ thật), nên chưa thử tay được X-06 của PH-12. `?fixture=1` giờ chạy được kịch bản A (#58) nhưng bằng bundle riêng, không thay cho bundle thật.
- **Cổng G4 (lát dọc 1) còn thiếu**: route chấm bài, API tiến độ (TH-11), tầng thu thập thật (TH-09), ghép engine thật (TH-10).
- TH-07 chưa thử trên Supabase thật và `loadSessionProgress` đang là bản tạm (`last_run` luôn `null`).
- Chưa chốt repo demo cuối (cổng G5): Minh đề xuất bài trên repo Spring (xem PR #57), chờ Nhân đọc output AI (NH-11) và Thiện.
- Sau #57, **không đổi tên bài hoặc route nữa** vì `node_id` của bài `GET /user` đã đổi; Nhân đã bắt đầu NH-11.

## Thiện — trưởng tích hợp, Tầng 0 engine, deploy

| Mã | Tên việc | Giờ | Trạng thái | PR | Ghi chú |
| :-- | :-- | :-- | :-: | :-: | :-- |
| TH-01 | Khung dự án và commit đầu | 12:00 → 12:20 | ✅ | — | Đẩy thẳng `main` (commit khung dự án và commit `docs/`) |
| TH-02 | Contracts phần chung và cờ menu | 12:20 → 13:00 | ✅ | #3 | |
| TH-03 | CI tối thiểu và thử luồng PR | 13:00 → 13:20 | ✅ | #4 | |
| TH-04 | Bản khung đầu tiên lên Cloud Run, có Vercel dự phòng | 13:20 → 14:30 | ◐ | #26 | Mới merge `/api/health`. Chưa thấy deploy Cloud Run, Vercel, Redirect URLs (cần `gcloud`, Thiện xác nhận cổng G2) |
| TH-19 | Pipeline deploy: Dockerfile, 2 image, staging, smoke, duyệt production | 14:30 → 16:15 | ⬜ | — | Chạy song song TH-05, TH-06 |
| TH-05 | Bảng DB, kết nối Postgres, lỗi API, log | 14:30 → 15:30 | ✅ | #16, #18 | #18 là sửa bổ sung: cho phép log lời gọi AI bản tối giản |
| TH-06 | Đăng nhập GitHub và `/api/me` gọi 1 lần | 15:30 → 16:15 | ✅ | #20 | Làm sớm hơn kế hoạch. Phát có thể bật nút đăng nhập thật ở PH-04 |
| TH-07 | `/api/ingest`, phiên học, snapshot và cache RAM (engine giả) | 16:15 → 17:00 | ✅ | #38 | Làm sớm. Mở khóa route của Nhân. Engine giả `stub.ts` xóa ở TH-10. Kiểm trên Postgres tạm (PGlite), **chưa thử Supabase thật**; chưa thử 2 request song song cùng repo; `loadSessionProgress` là bản tạm |
| TH-08 | Tầng 0 phần A: link, kiểm repo, tải zip | 17:00 → 18:00 | 🔄 | #59 (mở) | Xong code `url.ts`, `probe.ts`, `download.ts` và test (721 test xanh); đã gọi GitHub thật trên repo Spring (tải 510 KB, ghim SHA). Chờ merge. Thêm `probeErrorCode`, `EntryClass.NO_GRAMMAR` ngoài phiếu |
| TH-09 | Tầng 0 phần B: giải nén, lọc, che secret, chọn file, vân tay tối giản | 18:00 → 19:15 | ⬜ | — | |
| TH-10 | Ghép engine thật, lát dọc 1, deploy và kiểm Vertex AI | 19:15 → 20:00 | ⬜ | — | Cổng G3, G4 |
| TH-11 | Danh sách phiên, mở lại phiên, API tiến độ | 20:00 → 21:00 | ⬜ | — | |
| TH-12 | `progress.ts`: ghi BKT trong transaction, kết thúc run, mở khóa | 21:00 → 22:00 | ⬜ | — | |
| TH-13 | Trang chủ: "Tiếp tục học" và mở lại phiên | 22:00 → 23:00 | ⬜ | — | Nhận file trang chủ từ Phát lúc 22:00 |
| TH-14 | Deploy lát dọc 2 và đo lần 1 trên Cloud Run | 23:00 → 23:45 | ⬜ | — | Làm tay |
| TH-15 | API persona và API lịch sử (cho mảng độc lập) | 23:45 → 00:15 | ⬜ | — | |
| TH-16 | Diễn tập đường lùi và giao agent trước khi ngủ | 00:15 → 00:30 | ⬜ | — | Làm tay |
| TH-17 | Đóng băng tính năng, Definition of Done, deploy production | 03:30 → 05:00 | ⬜ | — | Làm tay |
| TH-18 | Trực sửa lỗi chặn demo, nộp slide, commit cuối | 05:00 → 09:15 | ⬜ | — | |

## Minh — Engine Tầng 1–2

| Mã | Tên việc | Giờ | Trạng thái | PR | Ghi chú |
| :-- | :-- | :-- | :-: | :-: | :-- |
| MI-01 | Contracts engine và kiểu nối với Tầng 0 | 12:20 → 13:00 | ✅ | #8 | |
| MI-02 | Parser Tree-sitter, bảng ngôn ngữ, grammar, bộ chạy thử | 13:00 → 14:00 | ✅ | #12 | |
| MI-03 | Danh bạ tên và resolver TS/JS | 14:00 → 15:30 | ✅ | #19 | |
| MI-04 | Đồ thị gọi hàm và điểm entry | 15:30 → 17:00 | ✅ | #33 | Làm sớm. Còn sót ENG-23 phần NestJS `provide/useClass`; Java thuộc MI-08 |
| MI-05 | Lát cắt, node và tên bài | 17:00 → 18:30 | ✅ | #42 | Làm sớm. Thêm `complexity.ts`, `slice-lines.ts`; sửa lỗi `<module>` trùng khoảng dòng của MI-04 |
| MI-06 | Khử chu trình, xếp hạng, giữ tối đa 20 bài, nhóm và cạnh, điểm nhập engine | 18:30 → 19:30 | ◐ | #48 | Xong `buildGraph` (khử chu trình, xếp hạng, nhóm, vị trí theo tầng tô-pô). **Chưa có** `src/server/engine/index.ts` vì cần `runIngest` của TH-09. TH-10 cần kiểm `/api/ingest` nhận `ERR_NO_ARCHITECTURAL_SLICE` |
| MI-07 | Chạy repo TS dự phòng, sửa bài lỗi, test tất định | 19:30 → 20:30 | ✅ | #57 | Làm sớm, gộp với phần chạy máy của MI-09. Sửa bài 1 bước, bước rỗng, tầng sai, tên `GET /user`. **Đổi `node_id` của bài `GET /user`**. Còn chờ Nhân đọc 3 bài (tiêu chí MI-07) |
| MI-08 | Java và Spring Boot cho repo demo Q-03 | 20:30 → 23:00 | ✅ | #52 | Làm sớm. Thử trên `spring-boot-realworld-example-app`: 116 file, 19 bài, 15 cạnh. MyBatis `@Mapper` tính là `DATA_SINK` (spec không nhắc) |
| MI-09 | Sửa theo repo demo đã chốt và các dòng engine của DoD | 23:00 → 00:30 | ◐ | #57 | Xong phần chạy máy: DoD engine trên 3 repo (Spring 19 bài, Express 19, NestJS 20) đạt các dòng 1, 2, 3, 17. **Chưa làm:** đồng hồ `ingest_ms + engine_ms` (cần `/api/ingest` thật, TH-10), kiểm trên Cloud Run, sửa theo repo demo đã chốt |
| MI-10 | Bàn giao engine trước khi ngủ | 00:30 → 01:00 | ⬜ | — | Làm tay |
| MI-11 | Kiểm engine theo DoD và sửa lỗi chặn demo | 04:00 → 05:30 | ⬜ | — | Mẫu sửa lỗi |
| MI-12 | Slide thuyết trình (người chính) và đoạn video Offline | 05:30 → 07:30 | ⬜ | — | Làm tay. Phát cần slide lúc 08:00 (PH-15) |
| MI-13 | Tập bấm demo và commit cuối | 07:30 → 09:00 | ⬜ | — | Mẫu sửa lỗi |

## Nhân — AI + BKT

| Mã | Tên việc | Giờ | Trạng thái | PR | Ghi chú |
| :-- | :-- | :-- | :-: | :-: | :-- |
| NH-01 | Contracts AI, người học và gọi thử Gemini | 12:20 → 13:00 | ✅ | #1 | |
| NH-02 | Fixture phản hồi AI cho giao diện | 13:00 → 13:30 | ✅ | #7 | |
| NH-03 | Hàm thuần: BKT, kế hoạch câu hỏi, trạng thái node, độ giống, bộ lọc an toàn | 13:30 → 15:00 | ✅ | #5 | |
| NH-04 | Lời gọi Gemini, hạn mức token, cổng gác bản nới | 15:00 → 16:45 | ✅ | #14 | |
| NH-05 | `analyze-node`: X-Ray có điểm dở thật | 16:45 → 18:30 | ✅ | #28, #46 | Lõi phân tích (#28), sửa gọi Vertex express, chuyển model 3.8-flash → flash-lite; route `analyze-node` (#46, đọc cache trước, gộp request cùng node). Cloud Run cần `GEMINI_BACKEND=vertex` + secret `GEMINI_API_KEY` |
| NH-06 | `enrich-node`: câu hỏi dễ hiểu cho người mới | 18:30 → 20:30 | ✅ | #31, #46 | Lõi (#31) và route `enrich-node` (#46). `createRun` đang ghi tạm bằng `db.tx`, đổi sang `progress.ts` sau TH-12. `ERR_AI_REJECTED` chưa nằm trong `RETRYABLE_CODES` |
| NH-07 | `evaluate-feynman` và `reveal`: chấm bài không khóa gắt | 20:30 → 22:30 | 🔄 | #34, #53 (mở) | Lõi chấm bài và luật Đạt nới đã merge (#34). PR #53 thêm `evaluate.ts`, `reveal.ts` và 2 route, ghi DB bằng bản tạm `db.tx` (đổi sang `progress.ts` khi TH-12 xong). Chưa có `redactSecrets` (chỉ che PII), `last_run` còn `null`. Chưa gọi Gemini thật |
| NH-08 | Ghép lát dọc 2 và chạy bài thử "giám khảo" | 22:30 → 23:30 | 🔄 | #39 (mở) | Mới có phần chỉnh prompt làm sớm: gợi ý `CODE_POINTER` thành câu hỏi mồi, `PROMPT_VERSION` 1.2.0 → 1.3.0 (Thiện xem dòng contracts). Chưa ghép lát dọc 2 |
| NH-09 | Giải thích đoạn chọn phía server | 23:30 → 00:30 | ✅ | #32, #46 | Làm sớm. Lõi (#32) và route `explain-selection` có cắt lại vùng chọn từ snapshot (#46). #46 cũng sửa lỗi cộng token 2 lần. Chưa gọi Gemini thật |
| NH-10 | Logic Offline và script ghi bundle; giữ quyền merge | 00:30 → 02:30 | ◐ | #37, #50 (mở) | Làm sớm: xong `src/lib/offline.ts` (18 export, chạy trên trình duyệt, X-06 xanh). `scripts/record-bundle.ts` đang ở PR #50, chưa chạy thật (cần route chấm bài #53 và tài khoản demo). Chưa có `public/demo/mock_bundle.json` (NH-12). Ngưỡng giống 0.95: câu gõ trên sân khấu phải gần y hệt kịch bản. Quyền merge 00:30–03:30 |
| NH-11 | Duyệt tay output AI trên repo demo đã chốt | 02:30 → 04:00 | ⬜ | — | Làm tay |
| NH-12 | Ghi bundle Offline trên bản đóng băng | 04:00 → 05:00 | ⬜ | — | Làm tay |
| NH-13 | Tập nói và commit cuối | 08:30 → 09:00 | ⬜ | — | Mẫu sửa lỗi |

## Phát — Giao diện trang học

| Mã | Tên việc | Giờ | Trạng thái | PR | Ghi chú |
| :-- | :-- | :-- | :-: | :-: | :-- |
| PH-01 | Token giao diện, chủ đề tối/sáng, font, thành phần cơ bản | 12:20 → 13:00 | ✅ | #2 | |
| PH-02 | Client API, store duy nhất, bảng thông điệp lỗi | 13:00 → 14:15 | ✅ | #11, #21 | #21 bổ sung: ingest nạp fixture `shop-api` ở chế độ `?fixture=1` |
| PH-03 | Fixture bản đồ `shop-api` | 14:15 → 14:45 | ✅ | #13 | |
| PH-04 | Trang chủ tối thiểu: đăng nhập, ô link, thả zip, đồng hồ quét | 14:45 → 15:45 | ✅ | #17, #40 | #40 bổ sung: nối nút Đăng nhập GitHub thật. Chưa thử đủ vòng OAuth; cần `/auth/callback` trong Supabase Redirect URLs |
| PH-05 | Khung trang học 3 cột, thanh trên, bản đồ bài học | 15:45 → 17:15 | ✅ | #23, #22 | #22 thêm `CONFIG.UI_PANE_WIDTHS_PCT` vào contracts (Thiện đã merge) |
| PH-06 | Khung code Monaco, tab theo file, code theo bước | 17:15 → 18:30 | ✅ | #27 | Làm sớm. `CodeSnippetViewer` chưa gắn vào `LearnShell` |
| PH-07 | Tour X-Ray: thẻ vai trò, từng bước, tóm tắt; hàng phân tích | 18:30 → 19:45 | ✅ | #30 | Làm sớm. **Chưa gắn** `LearnSidePanel` vào cột phải `LearnShell` (cột giữa và cột phải vẫn là chỗ giữ chỗ). Thanh mài mòn chưa thử vì fixture không có `profile` |
| PH-08 | Feynman: câu hỏi, ô trả lời, kết quả trong cột, gợi ý, đáp án mẫu | 19:45 → 21:45 | ✅ | #36, #58 | Làm sớm. #58 bổ sung: `?fixture=1` chạy được kịch bản A3–A6 trên bài N3 (bundle ghép từ fixture NH-02, chạy trên `offline.ts`, điểm 0.4202 và 0.5767 khớp spec); câu gõ phải gần như y hệt kịch bản. Test: `fixture-scenario.test.ts`. Chưa thử bằng trình duyệt |
| PH-09 | Áp kết quả: đổi trạng thái node, mở khóa, toast, mài mòn | 21:45 → 22:45 | ✅ | #43 | Làm sớm. Gọi `GET /api/sessions/{id}/progress` (chưa có, TH-11). Tiêu chí đạt bản thật (học xong N3, 1 lần `/api/me`) chưa thử vì chưa có route chấm bài |
| PH-10 | Nút "Giải thích" cho đoạn bôi đen | 22:45 → 23:45 | ✅ | #44, #47 | Làm sớm. #47 bổ sung: gắn `CodeSnippetViewer` vào `LearnShell`. Thử bằng `?fixture=1`; API thật (route `explain-selection` đã có từ #46) chưa thử |
| PH-11 | Tổng quan nhịp 1, ô persona, menu tài khoản, kiểm dưới 1024 px | 23:45 → 02:00 | ✅ | #51 | Làm sớm. Có sửa `CodeSnippetViewer` ngoài danh sách (cột giữa hiện Tổng quan khi chưa chọn bài). Kiểm 375 px bằng Chrome headless. Chưa thử với Supabase/API thật (xóa tài khoản, `/api/demo/persona` chờ TH-15); chưa có test cho `overview-view.ts` (toast đã sửa ở #55) |
| PH-12 | Nối giao diện Offline | 02:00 → 03:00 | ✅ | #49 | Làm sớm. `Ctrl+Shift+D` và `?offline=1` chạy, bundle hỏng thì rơi về chế độ thật. **Chưa thử với bundle thật** (`mock_bundle.json` chưa có) (toast đã sửa ở #55; `setOfflinePersona` dựng lại hồ sơ và tiến độ ở #58) |
| PH-13 | So ảnh với `prototype.html` và sửa lệch | 03:00 → 04:00 | ✅ | #56 | Làm sớm. 6/6 cặp ảnh khớp 4 điều (chụp 1366×768, chủ đề tối, bằng API giả vì lúc đó fixture chưa tới được Feynman). Sửa 1 lỗi CSS: quy tắc `button` ngoài `@layer` thắng class Tailwind, đưa vào `@layer base`. Nên chụp lại cặp 4–6 bằng `?fixture=1` mới (#58) |
| PH-14 | Sửa lỗi giao diện sau DoD và quay video dự phòng | 04:00 → 05:00 | ⬜ | — | Mẫu sửa lỗi |
| PH-15 | Tập bấm demo và commit cuối | 08:00 → 09:00 | ⬜ | — | Mẫu sửa lỗi |

## Quý — Mảng độc lập (dùng Codex)

| Mã | Tên việc | Giờ | Trạng thái | PR | Ghi chú |
| :-- | :-- | :-- | :-: | :-: | :-- |
| QU-01 | Khung trang Cách học | 12:20 → 13:00 | ✅ | #6 | |
| QU-02 | Nội dung 4 bước cách học và câu hỏi thường gặp | 13:00 → 15:00 | ✅ | #9 | |
| QU-03 | 16 thẻ khái niệm viết tay | 15:00 → 17:30 | ✅ | #10 | |
| QU-04 | Áp phích của đội (bản nháp) | 17:30 → 19:00 | ⬜ | — | Làm tay, không dùng Codex |
| QU-05 | Trang Lịch sử nộp bài với dữ liệu mẫu | 19:00 → 21:30 | ✅ | #15 | Làm sớm hơn kế hoạch |
| QU-06 | Trang Lịch sử nối API thật, trạng thái lỗi | 00:30 → 02:30 | ⬜ | — | Cần TH-15 (API lịch sử) |
| QU-07 | Áp phích bản cuối có ảnh sản phẩm thật | 02:30 → 04:00 | ⬜ | — | Làm tay |
| QU-08 | Hoàn thiện mảng độc lập và commit cuối | 04:00 → 09:00 | ⬜ | — | |

## Cổng và mốc cần canh

| Cổng | Giờ | Điều kiện | Tình trạng |
| :-- | :-- | :-- | :-- |
| G1 | 13:00 | Đủ 5 người có commit | ✅ Cả 5 đã có PR merge (xem `git shortlog -sn`) |
| G2 | 14:00 | Cloud Run sống (TH-04) | ❓ Mới có `/api/health`. Thiện xác nhận deploy |
| GP | 20:00, 00:00 | Pipeline deploy (TH-19) | ⬜ TH-19 chưa làm |
| G3 | 20:15 | Vertex AI (TH-10) | ⬜ Nhân đã chạy thử Vertex express (số đo trong PR #28) |
| G4 | 20:00 | Lát dọc 1 (TH-10) | ⬜ Đã có: TH-07, PH-06 → PH-13, lõi và route `analyze-node`, `enrich-node`, `explain-selection` (#46), khung code đã gắn vào `LearnShell` (#47). Còn thiếu: route chấm bài (#53 đang mở), `GET /api/sessions/{id}/progress` (TH-11), tầng thu thập mã nguồn thật (TH-08 chờ merge #59, TH-09), `engine/index.ts` (MI-06), ghép engine thật (TH-10) |
| G7 | 04:00 | Đóng băng tính năng | ⬜ |

## Nhật ký cập nhật

| Lúc | Ai | Việc |
| :-- | :-- | :-- |
| 07/11 14:30 | Phát | Lập bảng, điền trạng thái theo PR đã merge trên `main` (PR #1 → #23) |
| 07/11 15:30 | Phát | Cập nhật tới PR #34: thêm trạng thái ◐; đổi TH-06, MI-04, PH-06, PH-07 sang ✅; NH-05, 06, 07, 09 và TH-04 sang ◐; thêm mục điểm nghẽn |
| 07/11 15:45 | Phát | Cập nhật tới PR #36: PH-08 sang ✅ (ghi rõ A3–A6 trên fixture chưa chạy được); cập nhật G4; ghi PR #40 đang mở |
| 07/11 16:20 | Phát | Cập nhật tới PR #44: TH-07, MI-05, PH-09, PH-10 sang ✅; PH-04 thêm #40; NH-10 sang ◐ (#37); NH-08 sang 🔄 (#39 đang mở); viết lại mục điểm nghẽn |
| 07/11 16:55 | Phát | Cập nhật tới PR #52: MI-08, NH-05, NH-06, NH-09, PH-11, PH-12 sang ✅; MI-06 sang ◐; NH-07 sang 🔄 (#53); NH-10 thêm #50; viết lại mục điểm nghẽn (thêm lỗi toast) |
| 07/11 17:25 | Phát | Cập nhật tới PR #58: MI-07, PH-13 sang ✅; MI-09 sang ◐; TH-08 sang 🔄 (#59); PH-08 thêm #58; ghi #55 đã sửa lỗi toast; viết lại mục điểm nghẽn |
