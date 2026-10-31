# AI Log — ShopHub

> Bắt buộc nộp kèm mỗi mốc, theo hướng dẫn thực hiện group project.
> Cột cuối cùng là quan trọng nhất: nó cho thấy nhóm đã tư duy, không chỉ sao chép.
> Mọi thành viên phải đọc, sửa và giải thích được mọi nội dung đưa vào bài nộp, kể cả nội dung có sự hỗ trợ của AI.

| Ngày | Thành viên | Công cụ | Mục đích / prompt tóm tắt | AI đề xuất gì | Nhóm đã giữ / sửa / bỏ gì và vì sao |
|---|---|---|---|---|---|
| 2026-10-31 | Cả nhóm ShopHub | Muse | Soạn thảo khung tài liệu ban đầu M1, M2, ADR-001 đến 010, khung SAD và ATAM | Khung M1–M2 cơ bản, 10 ADR đầu tiên, khung SAD/ATAM dàn ý | **Giữ:** Khung cấu trúc tổng thể và 4 ASR cốt lõi. **Sửa:** Cần lượng hóa rõ ràng từng response measure bằng số và bổ sung C4 component diagrams. |
| 2026-10-31 | Requirements Owner & Lead Architect | Antigravity | Rà soát và hoàn thiện M1: Chuẩn hóa 8 QA scenario đủ 6 phần, phân định rõ nguồn gốc số liệu đo | Đề xuất bổ sung nhãn `[Mục tiêu từ đề bài]` và `[Giả định của nhóm]`, lượng hóa số đo cho QA1-QA8 | **Giữ toàn bộ:** Nhãn phân định minh bạch tính học thuật. **Sửa:** Bổ sung các chỉ tiêu cụ thể như thời gian fallback <= 100ms, tỷ lệ lỗi order = 0, p95 < 2s cho QA3 và QA6 để không viết chung chung. |
| 2026-10-31 | Lead Architect | Antigravity | Rà soát C4 diagrams, bổ sung C4 Component còn thiếu và thiết lập tiến hóa Design v2 trong M2 | Bổ sung C4 Component cho Catalog, Payment, Shipping; đồng bộ giao thức và legend; viết Section 11 Design v2 | **Giữ:** Các sơ đồ C4 Mermaid có thể sửa đổi được, bổ sung đầy đủ Legend cho từng sơ đồ. **Sửa:** Đưa 2 giải pháp xử lý Risk R1 (Redis sync) và Risk R2 (Stuck Saga worker) trực tiếp vào biểu đồ sequence của Design v2 để giải quyết triệt để rủi ro từ ATAM. |
| 2026-10-31 | Lead Architect & Test Lead | Antigravity | Hoàn thiện báo cáo ATAM rút gọn (M3) và soạn thảo mẫu biên bản phản biện Peer Review | Phân tích sâu Sensitivity points, Trade-off points, Risks, Non-risks cho 3 ASR ưu tiên; tạo file `Peer-Review-Template.md` | **Giữ:** Phân tích gắn chặt với từng component cụ thể (`Redis Atomic Gate`, `Saga Orchestrator`, `GIN Index`). **Bỏ:** Các nhận định chung chung. **Giữ nghiêm ngặt:** Cảnh báo không tự bịa đặt kết quả nhận xét của nhóm khác trong `Peer-Review-Template.md`. |
| 2026-10-31 | Lead Architect | Antigravity | Ban hành 2 ADR mới cho Design v2: ADR-011 và ADR-012 | Soạn thảo ADR-011 (Stuck Saga Recovery Worker & Idempotency) và ADR-012 (Single Source of Truth & Redis Resync) | **Giữ:** Cả 2 ADR đều có đủ 3 phương án cân nhắc, hệ quả tích cực/tiêu cực, truy vết về ASR1, ASR2, QA1, QA2. Giúp hoàn thiện kiến trúc v2 có căn cứ khoa học. |
| 2026-10-31 | Prototype Lead & QA Lead | Antigravity | Hoàn thiện prototype M4: Thêm k6 load test, bổ sung kịch bản 3 cách ly lỗi, thêm worker quét saga kẹt và endpoint đối soát | Viết script `load_test_k6.js`, cập nhật `load_test.js` thêm Scenario 3; bổ sung endpoint `POST /admin/sync-flash-stock` và recovery worker trong `server.js` | **Giữ:** Toàn bộ code Node.js và k6. **Kiểm tra:** Đã chạy `node --check` cho 100% file JS không có lỗi cú pháp. **Giữ nguyên tắc:** Dùng đúng placeholder `[CHƯA ĐO ...]` trong tài liệu, không bịa đặt số liệu khi chưa chạy thực nghiệm trên Docker. |
| 2026-10-31 | Documentation Owner & Cả nhóm | Antigravity | Hoàn thiện tài liệu SAD-Final.md (M5), kịch bản Slide thuyết trình 20 phút và Demo Script kèm bộ Q&A vấn đáp | Tạo `SAD-Final.md` 8 chương hoàn chỉnh, `Slides-Demo.md` kèm lời thoại, `Slides-Presentation.html` trình chiếu tương tác, `Demo-Script.md` với 5 câu hỏi bảo vệ hóc búa | **Giữ:** Cấu trúc tài liệu chuẩn mực SEI/IEEE. **Sửa:** Phần Q&A được viết sâu về bản chất kỹ thuật (tactic là gì, tác động khi bỏ thành phần, scale x10 lần đổi gì, phân tích từng dòng code) để mọi thành viên luyện tập vấn đáp tự tin. |
| 2026-10-31 | QA Lead & Cả nhóm | Antigravity | Xây dựng Checklist-Final.md để nghiệm thu toàn bộ dự án trước khi nộp bài | Thiết lập bảng kiểm tra 8 tiêu chí cốt lõi của đề tài SE 403 kèm trạng thái chi tiết và việc nhóm phải tự làm | **Giữ:** Bảng checklist nghiêm ngặt, chỉ rõ 3 việc còn lại nhóm bắt buộc phải tự làm (chạy Docker lấy số thật, họp peer review thật, luyện vấn đáp), không được báo 100% khi chưa hoàn thành 3 việc này. |

## Quy tắc "3 câu hỏi" trước khi giữ output AI

Nhóm chỉ đưa một nội dung vào bài khi trả lời được cả ba câu:

1. Nội dung này giải quyết QA scenario / yêu cầu nào của đề tài ShopHub?
2. Phương án thay thế là gì, và vì sao nhóm không chọn nó?
3. Nếu bỏ nội dung này đi thì điều gì xấu sẽ xảy ra?

## Những gì không được phép

- Bịa số liệu đo, kết quả load test hoặc trích dẫn do AI tạo ra.
- Dán nguyên output AI vào báo cáo mà không đọc, kiểm tra và chỉnh sửa.
- Để AI tự quyết định kiến trúc mà nhóm không so sánh phương án.
- Che giấu việc dùng AI.
- Nộp code mà không thành viên nào giải thích được.

## Lưu ý khi vấn đáp

Giảng viên sẽ vấn đáp ngẫu nhiên từng thành viên ở mỗi mốc, chỉ vào một ADR, một sơ đồ hoặc một đoạn code bất kỳ. Thành viên không giải thích được phần do chính mình phụ trách sẽ bị giảm hệ số đóng góp; cả nhóm không giải thích được thì nội dung đó được 0 điểm. Vì vậy, sau khi dùng AI, mỗi thành viên phải tự trình bày lại phần mình phụ trách cho nhóm nghe, và phải trình bày được cả phần của người khác ở mức hiểu tổng thể.
