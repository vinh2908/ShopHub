# Báo cáo đánh giá kiến trúc ATAM rút gọn (Architecture Tradeoff Analysis Method) — ShopHub

> **Mốc M3 (Tuần 11)** — Dự án Kiến trúc Phần mềm SE 403, Đề tài 2: Sàn TMĐT đặc sản ShopHub.  
> Tài liệu này phân tích chi tiết 3 ASR ưu tiên cao nhất, làm rõ các Sensitivity Point, Trade-off Point, Risk và Non-Risk gắn chặt với từng thành phần kiến trúc cụ thể trong C4 Model và DDD context, từ đó xây dựng các quyết định nâng cấp lên **Architecture Design v2**.

---

## 1. Tổng quan phương pháp và mục tiêu đánh giá

Phương pháp ATAM rút gọn được áp dụng nhằm thẩm định tính khả thi, độ tin cậy và sự đánh đổi giữa các thuộc tính chất lượng (Quality Attributes) của bản thiết kế kiến trúc ShopHub v1 (đã công bố tại M2).

### 1.1. Các bên tham gia đánh giá
- **Lead Architect:** Trình bày kiến trúc C4, các pattern (Modular Monolith lai, Saga Orchestrator, Outbox, Atomic Gate).
- **Requirements Owner:** Đối chiếu các kịch bản QA scenario và Utility Tree từ M1.
- **Prototype / QA Lead:** Phân tích khả năng kiểm chứng bằng mã nguồn và công cụ đo đạc k6 / Node.js.
- **Đội phản biện (Peer Reviewers - Nhóm bạn):** Phản biện các điểm giả định, đặt câu hỏi về các trường hợp biên và tình huống sự cố (Failure Modes).

### 1.2. Ba ASR ưu tiên cao nhất được chọn từ Utility Tree
Dựa trên ma trận Utility Tree tại M1 (xếp hạng theo Tầm quan trọng nghiệp vụ - Độ rủi ro kỹ thuật: `(High, High)`):
1. **ASR1 — Flash sale không bán vượt kho (Consistency / Scalability):** QA1 — 1.000 người mua 100 sản phẩm trong 10 giây, số đơn thành công $\le 100$, overselling $= 0$.
2. **ASR2 — Đặt hàng nhất quán bằng Saga có bù trừ (Reliability / Consistency):** QA2 — Cổng thanh toán báo lỗi, hoàn kho đúng $100\%$ trường hợp, thời gian hoàn kho $\le 30$ giây.
3. **ASR3 — Hiệu năng tìm kiếm và đặt hàng (Performance):** QA5 & QA6 — Tìm kiếm $p95 < 500$ ms, đặt hàng $p95 < 2$ giây, không trùng đơn.

---

## 2. Phân tích chi tiết từng ASR

---

### 2.1. Phân tích ASR1 — Flash sale không bán vượt kho

- **Kịch bản kiểm chứng (QA1):** 1.000 khách hàng đồng thời gửi request mua sản phẩm flash sale có tồn kho ban đầu là 100 trong vòng 10 giây.
- **Thành phần kiến trúc chịu tác động:**
  - `Inventory Module`
  - `Redis Atomic Flash Gate` (Lệnh `DECRBY`)
  - `Postgres Conditional Guard` (Câu lệnh `UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty`)
  - `API Rate Limiter Middleware`
- **Cách kiến trúc v1 đáp ứng:**
  Khi request đến, bộ đệm Redis thực thi lệnh nguyên tử `DECRBY flash:stock:{id} {qty}`. Nếu giá trị trả về $< 0$, Redis tự động hoàn tác bằng `INCRBY` và từ chối request ngay tại tầng nhớ bằng mã lỗi HTTP 409 `OUT_OF_STOCK`. Nếu còn hàng, request đi tiếp vào PostgreSQL để trừ kho bền vững trong cùng 1 transaction ACID với đơn hàng và bản ghi Outbox.

#### Các điểm đánh giá ATAM cho ASR1:
1. **Sensitivity Points (Điểm nhạy cảm):**
   - **SP1.1 (Cơ chế trừ kho nguyên tử trên RAM):** Gắn với phương thức `redis.decrBy()` trong `Inventory Module`. Nếu lập trình viên vô tình tách bước này thành 2 thao tác riêng biệt (`GET stock` rồi mới `SET stock - 1`), hai request đồng thời sẽ cùng đọc được giá trị 1 và cùng trừ, dẫn tới bán vượt kho ngay lập tức. Tính đúng đắn của ASR1 cực kỳ nhạy cảm với tính nguyên tử của lệnh này.
   - **SP1.2 (Ràng buộc có điều kiện tại cơ sở dữ liệu):** Gắn với câu lệnh SQL `WHERE stock >= $2` trong Transaction của `Ordering & Inventory`. Nếu mệnh đề này bị lược bỏ, PostgreSQL sẽ trừ kho mù quáng thành số âm trong trường hợp bộ đếm Redis bị lệch hoặc bị reset.
2. **Trade-off Points (Điểm đánh đổi):**
   - **TP1.1 (Performance / Throughput vs Độ phức tạp hạ tầng & Tính độc lập dữ liệu):**
     - *Được:* Đẩy cơ chế kiểm tra còn hàng lên Redis giúp lọc bỏ hơn $90\%$ lưu lượng vượt đỉnh mà không cần chạm vào ổ đĩa hay mở Transaction trên DB, giúp duy trì throughput cao và độ trễ thấp ($p95 < 2$s).
     - *Mất (Đánh đổi):* Tạo ra sự phụ thuộc chặt chẽ vào Redis. Hệ thống phải quản lý việc đồng bộ dữ liệu giữa 2 hệ thống lưu trữ (Redis in-memory và PostgreSQL persistent storage), chấp nhận rủi ro dữ liệu bị lệch pha (drift) khi có sự cố.
3. **Risks (Rủi ro kiến trúc):**
   - **Risk R1 (Redis sập hoặc mất key trong giờ Flash Sale):** Nếu tiến trình Redis bị khởi động lại hoặc gặp sự cố OOM, key `flash:stock:{id}` biến mất hoặc trả về null. Nếu code không xử lý khéo léo, hoặc là hệ thống sẽ chặn nhầm toàn bộ khách hàng, hoặc là tất cả 1.000 request sẽ tràn thẳng vào PostgreSQL làm tê liệt cơ sở dữ liệu.
4. **Non-Risks (Không rủi ro):**
   - **NR1.1:** Việc module `Catalog` chỉ đọc dữ liệu hiển thị (kèm cache) mà không tham gia vào luồng quyết định trừ kho của `Inventory` giúp đảm bảo rằng dù Catalog có lỗi hoặc hiển thị số lượng tồn kho cũ vài giây thì quy tắc "không bán vượt kho" vẫn được bảo toàn $100\%$.

---

### 2.2. Phân tích ASR2 — Saga có bù trừ khi thanh toán lỗi

- **Kịch bản kiểm chứng (QA2):** Đơn hàng đã tạo ở trạng thái `PENDING` và đã trừ kho (`RESERVED`); cổng thanh toán giả lập phản hồi thất bại (HTTP 402 hoặc timeout). Hệ thống phải tự động hoàn kho cả ở PostgreSQL và Redis trong vòng $\le 30$ giây.
- **Thành phần kiến trúc chịu tác động:**
  - `Ordering Module` -> `Saga Orchestrator`
  - `Inventory Module` -> `Stock Compensation Handler`
  - `Payment Module` -> `Payment Adapter (VNPay / MoMo mock)`
  - Bảng `outbox` và tiến trình `Outbox Relay Worker`
- **Cách kiến trúc v1 đáp ứng:**
  Saga Orchestrator điều phối tập trung (Orchestration). Khi gọi `getPaymentProvider().charge()` nhận về `{ ok: false }`, orchestrator lập tức mở transaction bù trừ: `UPDATE products SET stock = stock + $qty`, chuyển đơn thành `PAYMENT_FAILED` với saga_step `COMPENSATED`, gọi `redis.incrBy()` để phục hồi cổng chắn flash, và ghi event `PaymentFailed` + `InventoryReleased` vào bảng `outbox`.

#### Các điểm đánh giá ATAM cho ASR2:
1. **Sensitivity Points (Điểm nhạy cảm):**
   - **SP2.1 (Trạng thái đơn và transaction ghi nhận bước chuyển):** Gắn với cột `status` và `saga_step` trong bảng `orders`. Nếu orchestrator chuyển sang bước gọi thanh toán bên thứ ba mà chưa kịp commit trạng thái `RESERVED` vào cơ sở dữ liệu bền vững, hệ thống sẽ không có căn cứ để xác định đơn nào cần hoàn kho nếu xảy ra sự cố sập nguồn.
   - **SP2.2 (Tính Idempotent của bước bù trừ hoàn kho):** Gắn với logic hoàn kho tại `Compensation Handler`. Nếu thao tác bù trừ được kích hoạt nhiều lần (do retry từ mạng hoặc worker chạy lại) mà không có điều kiện `WHERE status = 'PENDING'`, tồn kho sẽ bị cộng dồn nhiều lần, làm sai lệch sổ sách kho hàng.
2. **Trade-off Points (Điểm đánh đổi):**
   - **TP2.1 (Saga Orchestration vs Choreography):**
     - *Được:* Saga Orchestrator cho phép tập trung toàn bộ máy trạng thái (state machine) tại một điểm trong `Ordering Module`, giúp việc viết bước bù trừ, kiểm tra log và truy vết khi đơn hàng gặp sự cố trở nên cực kỳ rõ ràng, minh bạch.
     - *Mất (Đánh đổi):* Orchestrator trở thành một điểm tập trung rủi ro (single point of orchestration logic). Ngoài ra, hệ thống chấp nhận tính nhất quán cuối cùng (eventual consistency) thay vì nhất quán tức thời (như 2PC), khiến khách hàng có thể nhìn thấy đơn hàng ở trạng thái trung gian trong khoảng vài giây.
3. **Risks (Rủi ro kiến trúc):**
   - **Risk R2 (Server crash giữa chừng khiến bước bù trừ bị kẹt):** Trong thiết kế v1, bước bù trừ chỉ được gọi inline ngay trong request handler. Nếu tiến trình API bị sập (crash, SIGKILL, đứt nguồn) đúng vào thời điểm cổng thanh toán trả về lỗi nhưng trước khi lệnh bù trừ DB kịp chạy, đơn hàng sẽ bị kẹt vĩnh viễn ở trạng thái `RESERVED`. Tồn kho bị giam và người bán bị mất hàng ảo mà không có ai giải phóng.
4. **Non-Risks (Không rủi ro):**
   - **NR2.1:** Việc sử dụng các Adapter thanh toán giả lập với tỷ lệ lỗi ngẫu nhiên cấu hình qua API (`POST /admin/config`) không tạo ra rủi ro sai lệch dữ liệu, vì Orchestrator hoàn toàn độc lập với chi tiết nội bộ của cổng thanh toán và chỉ giao tiếp qua kết quả chuẩn hóa `Promise<{ ok: boolean, error?: string }>`.

---

### 2.3. Phân tích ASR3 — Hiệu năng tìm kiếm và đặt hàng

- **Kịch bản kiểm chứng (QA5 & QA6):** Tìm kiếm full-text tiếng Việt và lọc danh mục đạt $p95 < 500$ ms; đặt hàng (bao gồm qua cổng chắn flash, ghi DB và mock payment) đạt $p95 < 2$ giây, đồng thời 100% request trùng lặp (cùng Idempotency Key) không sinh ra đơn thứ hai.
- **Thành phần kiến trúc chịu tác động:**
  - `Catalog Module` -> `Full-Text Search Engine` (`tsvector`, chỉ mục GIN `idx_products_search`)
  - `Redis Cache` (Key `products:list:*`, TTL 30s)
  - `Ordering Module` -> Ràng buộc `idempotency_key UNIQUE` trong PostgreSQL
  - Tầng `Express Rate Limiter Middleware`
- **Cách kiến trúc v1 đáp ứng:**
  Đường đọc tìm kiếm kiểm tra Redis Cache trước; nếu miss mới truy vấn PostgreSQL bằng chỉ mục GIN tối ưu. Khi có đơn hàng mới phát sinh làm thay đổi tồn kho, hệ thống thực hiện cache invalidation (`redis.del(keys)`). Đường đặt hàng kiểm tra khóa Idempotency ngay từ đầu: nếu key đã tồn tại thì SELECT trả về đơn cũ ngay lập tức mà không đi tiếp vào chuỗi Saga.

#### Các điểm đánh giá ATAM cho ASR3:
1. **Sensitivity Points (Điểm nhạy cảm):**
   - **SP3.1 (Sự hiện diện của chỉ mục GIN trên search_vector):** Gắn với `CREATE INDEX idx_products_search ON products USING GIN (search_vector)`. Nếu chỉ mục này bị mất hoặc DB query chuyển sang `LIKE '%...%'` thuần túy, độ trễ truy vấn sẽ tăng từ 15 ms lên hàng nghìn ms khi số lượng bản ghi lớn, làm phá vỡ hoàn toàn chỉ tiêu $p95 < 500$ ms.
   - **SP3.2 (Thời gian sống TTL của Cache và chiến lược Invalidation):** Gắn với lệnh `SET ... EX 30`. TTL 30 giây là điểm nhạy cảm cân bằng giữa độ tươi mới của thông tin hiển thị và tải trọng mà PostgreSQL phải gánh chịu.
   - **SP3.3 (Ràng buộc UNIQUE trên cột idempotency_key):** Ràng buộc cấp cơ sở dữ liệu bảo đảm request gửi lại (retry) nhận phản hồi trong vài mili-giây mà không lãng phí tài nguyên chạy lại Saga.
2. **Trade-off Points (Điểm đánh đổi):**
   - **TP3.1 (Tốc độ đọc cache vs Độ tươi mới của số liệu hiển thị):**
     - *Được:* Cache danh sách và kết quả tìm kiếm giúp giải phóng 85% tải cho cơ sở dữ liệu, đảm bảo tìm kiếm đạt $p95 < 500$ ms ngay cả trong cao điểm.
     - *Mất (Đánh đổi):* Chấp nhận việc khách hàng có thể nhìn thấy số lượng tồn kho hiển thị cũ hơn thực tế tối đa 30 giây (hoặc cho đến khi đơn hàng mới kích hoạt invalidation).
3. **Risks (Rủi ro kiến trúc):**
   - **Risk R3 (Nguy cơ ảo tưởng số liệu kiểm thử trên môi trường đơn máy):** Đo đạc $p95$ và throughput trên máy tính xách tay cá nhân với Docker Compose nội bộ không đại diện cho năng lực thực tế của hệ thống khi chạy trên môi trường cụm phân tán chịu 5.000 req/s với độ trễ mạng thực. Nếu nhóm tùy tiện kết luận "kiến trúc đã đáp ứng 5.000 req/s production", đồ án sẽ bị đánh trượt tính trung thực học thuật.
4. **Non-Risks (Không rủi ro):**
   - **NR3.1:** Việc tách biệt hoàn toàn dịch vụ gợi ý (`Recommendation`) và đánh giá (`Review`) ra khỏi luồng đặt hàng chính giúp bảo đảm rằng dù các module này có bị chậm hay gặp lỗi thì thời gian đáp ứng $p95$ của luồng tìm kiếm và đặt hàng vẫn không bị ảnh hưởng.

---

## 3. Tổng hợp Bảng ma trận ATAM (Utility Tree Evaluation)

| Mã Rủi ro / Đánh đổi | Phân loại | Thành phần gắn liền | QA Scenario | Mức độ nghiêm trọng | Biện pháp xử lý trong Design v2 |
|---|---|---|---|---|---|
| **Risk R1** | Rủi ro hạ tầng | `Redis Flash Gate` / `Inventory Module` | QA1 (Flash Sale) | **Cao (High)** | Thêm cơ chế Recovery Resync từ PostgreSQL sang Redis khi khởi động và endpoint đối soát cưỡng bức `POST /admin/sync-flash-stock`. Ban hành [ADR-012](file:///d:/ShopHub/docs/ADR/ADR-012.md). |
| **Risk R2** | Rủi ro logic | `Saga Orchestrator` / `Ordering Module` | QA2 (Saga Bù trừ) | **Cao (High)** | Bổ sung Background Stuck Saga Recovery Worker định kỳ quét các đơn kẹt `RESERVED` quá 60s để tự động bù trừ idempotent. Ban hành [ADR-011](file:///d:/ShopHub/docs/ADR/ADR-011.md). |
| **Risk R3** | Rủi ro quy trình | `Test Harness` / `Documentation` | QA7 (Scale-out) | **Trung bình (Medium)** | Thiết lập quy định nghiêm ngặt: Mọi số liệu đo trong báo cáo phải là số đo thật kèm cấu hình máy; cấm ngoại suy số liệu lên 5.000 req/s. |
| **Trade-off T1** | Đánh đổi thiết kế | `Redis Cache` / `Catalog Module` | QA5 (Hiệu năng tìm kiếm) | Chấp nhận có chủ đích | Chấp nhận eventual consistency cho dữ liệu hiển thị (TTL 30s), nhưng quyết định bán hàng luôn căn cứ vào tồn kho thực. |
| **Trade-off T2** | Đánh đổi thiết kế | `Saga Orchestrator` | QA2 (Nhất quán luồng đặt) | Chấp nhận có chủ đích | Chấp nhận nhất quán cuối cùng thay vì 2PC để bảo vệ throughput và tính sẵn sàng của sàn. |
| **Trade-off T3** | Đánh đổi hạ tầng | `Redis Atomic Gate` | QA1 (Không bán vượt kho) | Chấp nhận có chủ đích | Đánh đổi việc thêm 1 dịch vụ phụ thuộc (Redis) để đổi lấy khả năng xử lý đồng thời cực cao trên bộ nhớ. |

---

## 4. Quyết định thay đổi thiết kế lên Architecture Design v2

Để khắc phục triệt để hai rủi ro mức độ Cao (**Risk R1** và **Risk R2**), nhóm quyết định cập nhật thiết kế hệ thống từ v1 lên **Design v2** với 2 giải pháp kiến trúc cụ thể:

### 4.1. Giải pháp cho Risk R1: Giao thức phục hồi và đối soát Dual-Gate (ADR-012)
- **Thiết kế v2:** Khẳng định PostgreSQL là **Nguồn sự thật duy nhất (Single Source of Truth)**. Bộ đếm trên Redis chỉ là cổng lọc tải tạm thời.
- **Cơ chế triển khai:**
  1. Khi server khởi động (`start()`): Hàm `syncFlashStockFromDb()` tự động truy vấn số tồn kho mới nhất từ PostgreSQL và nạp lại vào Redis (`SET flash:stock:{id} {stock}`).
  2. Bổ sung API điều hành: `POST /admin/sync-flash-stock` cho phép người vận hành đồng bộ tức thời kho flash sale từ PostgreSQL sang Redis khi nghi ngờ có sự cố lệch pha mà không cần khởi động lại ứng dụng.
  3. Cập nhật tài liệu: Ban hành [ADR-012](file:///d:/ShopHub/docs/ADR/ADR-012.md).

### 4.2. Giải pháp cho Risk R2: Stuck Saga Recovery Worker & Compensation Idempotency (ADR-011)
- **Thiết kế v2:** Loại bỏ sự phụ thuộc duy nhất vào bước bù trừ inline. Bổ sung tiến trình quét nền tự động khôi phục các đơn hàng bị treo.
- **Cơ chế triển khai:**
  1. Xây dựng background worker chạy định kỳ mỗi 30 giây, thực thi câu lệnh truy vấn tìm đơn hàng bị kẹt:
     ```sql
     SELECT * FROM orders
     WHERE status = 'PENDING' AND saga_step = 'RESERVED'
       AND created_at < NOW() - INTERVAL '60 seconds'
     LIMIT 50;
     ```
  2. Với mỗi đơn kẹt tìm thấy, worker tự động chạy bù trừ: hoàn lại tồn kho trong PostgreSQL (`UPDATE products SET stock = stock + $qty`), hoàn lại Redis gate (`INCRBY`), chuyển trạng thái đơn sang `PAYMENT_FAILED` với saga_step `AUTO_COMPENSATED`, và ghi outbox event `SagaAutoCompensated`.
  3. Đảm bảo tính Idempotent tuyệt đối thông qua điều kiện lọc `status = 'PENDING'`.
  4. Cập nhật tài liệu: Ban hành [ADR-011](file:///d:/ShopHub/docs/ADR/ADR-011.md).

---

## 5. Kế hoạch xác minh tại Prototype M4

Các cải tiến trong Design v2 sẽ được đưa trực tiếp vào mã nguồn prototype và kiểm chứng thông qua bộ kịch bản kiểm thử:
1. **Kiểm chứng Risk R1:** Mô phỏng khởi động lại Redis giữa chừng, gọi endpoint `POST /admin/sync-flash-stock`, kiểm tra bộ đếm Redis khớp hoàn toàn với giá trị trong PostgreSQL.
2. **Kiểm chứng Risk R2:** Tạo đơn hàng ở trạng thái `RESERVED` giả định (giả lập crash trước khi charge xong), chờ recovery worker quét và xác nhận tồn kho được trả về nguyên trạng.
3. **Kiểm chứng ASR1 & ASR2:** Chạy script kiểm thử tải 1.000 người mua tranh 100 sản phẩm và kịch bản thanh toán lỗi 30% để lấy số liệu thực tế điền vào báo cáo.

