# ShopHub — Sàn Thương Mại Điện Tử Đặc Sản Miền Trung
> **Học phần:** SE 403 — Thiết kế Kiến trúc Phần mềm (Đề tài 2)  
> **Nhóm thực hiện:** Nhóm ShopHub — Học kỳ 1, Năm học 2026

ShopHub là sàn thương mại điện tử đa người bán (multi-vendor marketplace) dành riêng cho các cơ sở sản xuất làng nghề truyền thống và đặc sản miền Trung (khoảng 2.000 người bán, 200.000 khách hàng trong năm đầu). Dự án tập trung giải quyết 3 bài toán kiến trúc trọng yếu trong các đợt Flash Sale cao điểm:
1. **Không bán vượt tồn kho (Zero Overselling = 0)** bằng cơ chế Dual-Gate (Redis atomic `DECRBY` + PostgreSQL conditional update).
2. **Nhất quán giao dịch phân tán** bằng Saga Orchestration có bù trừ và Transactional Outbox pattern.
3. **Cô lập sự cố (Fault Isolation)** bằng vách ngăn Bulkhead và Fallback: dịch vụ phụ (gợi ý, đánh giá) gặp trục trặc không làm gián đoạn luồng đặt hàng cốt lõi.

---

## 1. Cấu trúc thư mục dự án

```text
ShopHub/
├── docs/             # Tài liệu kiến trúc các mốc (M1, M2, M3, SAD Final, Slides HTML)
├── adr/              # 12 bản ghi quyết định kiến trúc (ADR-001 đến ADR-012)
├── diagrams/         # Các sơ đồ kiến trúc nguồn định dạng Mermaid (.mmd)
├── src/              # Mã nguồn prototype chạy được (API, Web, Tests, Docker Compose)
├── ai-log.md         # Nhật ký minh bạch việc sử dụng công cụ AI
├── README.md         # Tài liệu tổng quan và hướng dẫn dự án
└── .gitignore        # Danh sách loại trừ các tệp tin tạm và môi trường
```

---

## 2. Ánh xạ các mốc nộp bài (Milestones M1 – M5)

| Mốc | Tên mốc & Trọng số | Tệp tin chính phụ trách | Nội dung trọng tâm |
|:---:|---|---|---|
| **M1** | Architectural Drivers (15%) | [`docs/M1-Architectural-Drivers.md`](docs/M1-Architectural-Drivers.md) | 5 Business Goals đo được, 7 Stakeholders, 10 Use Cases, Ràng buộc, Ước lượng tải, 8 QA Scenarios đủ 6 phần (có số định lượng rõ ràng) và 4 ASR then chốt. |
| **M2** | Architecture Design v1 (25%) | [`docs/M2-Architecture-Design-v1.md`](docs/M2-Architecture-Design-v1.md)<br>[`diagrams/`](diagrams/)<br>[`adr/ADR-001.md`](adr/ADR-001.md) đến [`ADR-010.md`](adr/ADR-010.md) | Phân rã 7 Bounded Contexts theo DDD, Event Storming, Sơ đồ C4 Level 1–3, Deployment View, Sequence Diagrams cho Saga và Flash Sale, 10 ADR đầu tiên. |
| **M3** | Đánh giá kiến trúc ATAM (15%) | [`docs/M3-ATAM-Analysis.md`](docs/M3-ATAM-Analysis.md)<br>[`adr/ADR-011.md`](adr/ADR-011.md)<br>[`adr/ADR-012.md`](adr/ADR-012.md) | Báo cáo ATAM cho 3 ASR ưu tiên: Sensitivity points, Trade-off points, Risks, Non-risks; Nâng cấp lên **Architecture Design v2** xử lý Risk R1 (Redis Gate Resync) và Risk R2 (Stuck Saga Recovery). |
| **M4** | Prototype kiểm chứng (25%) | [`src/`](src/) (API, Web, Tests, Compose)<br>[`src/README.md`](src/README.md) | Bộ xương kiến trúc chạy được bằng Docker Compose chứng minh 3 kịch bản: Flash sale overselling = 0, thanh toán lỗi 30% hoàn kho đúng, và cô lập lỗi dịch vụ phụ. |
| **M5** | SAD, Slide & Demo (20%) | [`docs/SAD-Final.md`](docs/SAD-Final.md)<br>[`docs/Slides-Presentation.html`](docs/Slides-Presentation.html)<br>[`ai-log.md`](ai-log.md) | Tài liệu Kiến trúc Hoàn chỉnh (SAD) 8 chương, Bản trình chiếu slide trực tiếp trên web, Nhật ký AI minh bạch và báo cáo tổng kết. |

---

## 3. Hướng dẫn chạy Prototype

### Yêu cầu cài đặt trước:
- Docker Desktop (đã bật Docker Engine)
- Node.js v20+ (để chạy script test từ máy host)
- (Tùy chọn) k6 nếu muốn chạy test tải k6

### Bước 1: Khởi động hệ thống
Từ thư mục root của dự án, chuyển vào thư mục `src/` và khởi chạy cụm container:

```bash
cd src
docker compose up --build -d
```

- **API Gateway / Backend:** http://localhost:3000 (Kiểm tra trạng thái sẵn sàng: `GET /health`)
- **Giao diện Web Demo:** http://localhost:8080
- **Khởi tạo dữ liệu mẫu (Seed):** Gọi `POST /seed` hoặc bấm nút **"Seed Catalogue"** trên trang web.

### Bước 2: Dừng hệ thống khi kết thúc
```bash
docker compose down
```

---

## 4. Hướng dẫn chạy các kịch bản kiểm thử (Verification Tests)

Khi cụm Docker Compose đang chạy, mở một Terminal tại thư mục `src/`:

### Kịch bản 1 & 2 & 3: Kiểm thử tải tự động bằng Node.js
```bash
node tests/load_test.js
```
Script tự động thực hiện 3 kịch bản liên hoàn và in kết quả đo thực tế ra màn hình:
1. **Flash Sale Rush:** 1.000 người mua đồng thời tranh 100 sản phẩm flash sale $\to$ Kiểm chứng: Số đơn thành công $\le 100$, Oversold count $= 0$, p95 latency và throughput.
2. **Saga Compensation:** Đặt tỷ lệ lỗi thanh toán giả lập lên 30%, gửi 100 đơn $\to$ Kiểm chứng: Tồn kho cuối $= \text{Tồn kho đầu} - \text{Đơn CONFIRMED}$; khôi phục đúng 100% cả ở Postgres và Redis.
3. **Failure Isolation:** Gọi dịch vụ gợi ý đang lỗi `/recommendations?fail=1` (nhận fallback rỗng) và downstream 503, đồng thời đặt hàng $\to$ Kiểm chứng: Luồng đặt hàng thành công 100% (HTTP 201).

### (Tùy chọn) Kịch bản Load Test bằng k6:
```bash
k6 run tests/load_test_k6.js
```

---

## 5. Lưu ý về Tính trung thực học thuật (Academic Integrity)

- **Môi trường đo đạc:** Kết quả chạy trên laptop cá nhân với Docker Compose chứng minh **tính đúng đắn của thiết kế kiến trúc**, nhưng **không chứng minh được khả năng chịu tải 5.000 req/s trên production**. Mọi số liệu chưa chạy đo thực tế trên máy đều được đặt placeholder dạng `[CHƯA ĐO — chạy docker compose up rồi chạy load test và điền số thật kèm môi trường đo]`.
- **Phạm vi giả lập:** Thanh toán (VNPay, MoMo) và vận chuyển (GHN, GHTK) là Mock Adapters an toàn. Hệ thống hiện tại sử dụng In-process Outbox Relay mẫu, chưa cấu hình cụm RabbitMQ/Kafka vật lý.
