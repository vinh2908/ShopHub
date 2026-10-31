# M1 — Architectural Drivers: ShopHub

> Đề tài 2 — Sàn thương mại điện tử đa người bán cho các cơ sở sản xuất đặc sản miền Trung.
> Tài liệu này thuộc mốc M1 (tuần 4). Mọi con số trong tài liệu này là **mục tiêu lấy từ đề bài** hoặc **giả định của nhóm, được ghi rõ**, không phải số liệu đo được. Nhóm phải rà soát, sửa và giải thích được từng dòng trước khi nộp.

## 1. Bối cảnh và vấn đề kiến trúc

ShopHub phục vụ khoảng 2.000 người bán và 200.000 khách hàng trong năm đầu. Lưu lượng bình thường thấp nhưng tăng đột biến gấp 20 lần trong các đợt flash sale (11/11, Tết). Vấn đề kiến trúc không nằm ở việc hiển thị sản phẩm, mà nằm ở ba điểm sau:

1. Khi hàng nghìn người cùng mua một số lượng sản phẩm giới hạn, hệ thống không được bán vượt tồn kho.
2. Khi thanh toán thất bại sau khi đã trừ kho, tiền và kho phải trở về trạng thái nhất quán, không cần can thiệp thủ công cho từng đơn.
3. Khi một dịch vụ phụ (gợi ý, đánh giá, vận chuyển, thanh toán) gặp sự cố, luồng đặt hàng cốt lõi vẫn phải chạy.

Vì vậy, kiến trúc phải trả lời trước ba câu hỏi: đặt hàng được chia thành những bước nào, bước nào được phép thất bại và bù trừ ra sao, và tồn kho được trừ ở đâu bằng cơ chế nào.

## 2. Business goals (đo được)

| Mã | Mục tiêu | Cách đo |
|---|---|---|
| BG1 | Trong năm đầu, sàn vận hành được cho 2.000 người bán và 200.000 khách hàng đăng ký | Số tài khoản người bán và khách hàng đang hoạt động trong hệ thống |
| BG2 | Flash sale không bán vượt tồn kho | Số đơn vượt tồn kho trong đợt flash sale = 0, kiểm chứng bằng log đặt hàng và log tồn kho |
| BG3 | Đợt flash sale vẫn đáp ứng được trong giới hạn hiệu năng đã đặt | Trang tìm kiếm p95 < 500 ms, đặt hàng p95 < 2 giây trong kịch bản kiểm chứng |
| BG4 | Thêm cổng thanh toán hoặc đơn vị vận chuyển mới trong thời gian ngắn | Thời gian công thực tế khi tích hợp thêm một cổng / một đơn vị vận chuyển mới, mục tiêu ≤ 3 ngày công |
| BG5 | Dịch vụ phụ lỗi không làm gián đoạn đặt hàng | Trong kịch bản tắt dịch vụ gợi ý hoặc đánh giá, tỷ lệ đặt hàng thành công của luồng chính không giảm do lỗi đó |

## 3. Stakeholders

| Stakeholder | Mối quan tâm chính | QA họ quan tâm nhất |
|---|---|---|
| Khách hàng | Tìm được hàng nhanh, đặt hàng không bị hủy vô cớ, thanh toán an toàn, biết trạng thái đơn | Performance, Reliability, Usability |
| Người bán | Quản lý gian hàng, sản phẩm, tồn kho, đơn hàng; nhận doanh thu đúng và đúng hạn | Modifiability, Reliability, Security |
| Quản trị sàn | Vận hành sàn, xử lý tranh chấp, đối soát, chống gian lận | Security, Modifiability, Availability |
| Đơn vị vận chuyển | Nhận đơn giao hàng đúng thông tin, cập nhật trạng thái vận chuyển | Interoperability, Reliability |
| Cổng thanh toán | Giao dịch an toàn, đối soát khớp, hoàn tiền khi cần | Security, Reliability |
| Nhà đầu tư | Tăng trưởng người dùng và doanh thu mà chi phí hạ tầng không tăng tuyến tính theo đỉnh tải | Scalability, Cost-efficiency |
| Đội vận hành | Giám sát, phát hiện lỗi nhanh, triển khai và khôi phục nhanh | Availability, Maintainability |

**Xung đột quan tâm cần ghi nhận:**

- Khách hàng muốn đặt hàng thật nhanh, nhưng người bán và quản trị sàn muốn không bán vượt kho và không mất tiền khi thanh toán lỗi. Tốc độ không được đánh đổi bằng tính nhất quán của tồn kho.
- Nhà đầu tư muốn chi phí thấp, nhưng đợt flash sale đòi hỏi khả năng chịu tải đỉnh. Kiến trúc phải scale theo đỉnh tải bằng cấu hình và tài nguyên tạm thời, không phải bằng cách xây dựng một hệ thống luôn chạy ở mức đỉnh tải.

## 4. Use cases chính

| Mã | Use case | Tác nhân chính |
|---|---|---|
| UC1 | Đăng ký gian hàng và quản lý sản phẩm, tồn kho | Người bán |
| UC2 | Tìm kiếm full-text, lọc theo danh mục, giá, địa phương, đánh giá | Khách hàng |
| UC3 | Thêm vào giỏ hàng, đặt hàng, thanh toán | Khách hàng |
| UC4 | Mua hàng trong flash sale với số lượng giới hạn | Khách hàng |
| UC5 | Xử lý đơn hàng, xác nhận, đóng gói, bàn giao vận chuyển | Người bán, đơn vị vận chuyển |
| UC6 | Theo dõi trạng thái đơn hàng và nhận thông báo | Khách hàng |
| UC7 | Đánh giá sản phẩm và người bán | Khách hàng |
| UC8 | Xem gợi ý sản phẩm dựa trên lịch sử mua | Khách hàng |
| UC9 | Đối soát và chi trả doanh thu cho người bán | Quản trị sàn, người bán |
| UC10 | Tích hợp cổng thanh toán hoặc đơn vị vận chuyển mới | Đội vận hành, quản trị sàn |

Các luồng ngoại lệ phải được thiết kế ngay từ M1, không để sang M4: thanh toán thất bại, hết hàng giữa chừng, vận chuyển từ chối nhận đơn, khách hủy đơn sau khi thanh toán, và trùng request đặt hàng do khách bấm hai lần hoặc mạng gửi lại request.

## 5. Constraints

| Loại | Ràng buộc | Hệ quả kiến trúc |
|---|---|---|
| Kỹ thuật | Nhóm 4–5 sinh viên, 15 tuần, prototype phải chạy được bằng một lệnh `docker compose up` | Ưu tiên kiến trúc đơn giản, ít service, dễ triển khai; không tách quá nhiều microservice |
| Kỹ thuật | Thanh toán và vận chuyển trong đồ án là giả lập (VNPay/MoMo giả lập, GHN/GHTK giả lập) | Thiết kế adapter cho cổng và đơn vị vận chuyển, không gắn chặt code đặt hàng với một nhà cung cấp cụ thể |
| Kinh doanh | 2.000 người bán, 200.000 khách hàng năm đầu, đỉnh tải gấp 20 lần bình thường | Phải có chiến lược chịu tải đỉnh: cache, hàng đợi, rate limiting, trừ kho nguyên tử |
| Pháp lý | Bảo vệ dữ liệu cá nhân, giao dịch thanh toán và đối soát phải có log để kiểm tra lại | Log giao dịch, log tồn kho, log thanh toán; không xóa log đối soát |
| Thời gian | Các mốc M1–M5 có deadline cố định, nộp trễ bị trừ điểm theo quy định của môn học | Ưu tiên hoàn thành luồng đặt hàng và flash sale trước các tính năng phụ |

## 6. Ước lượng tải (giả định của nhóm, phải ghi rõ khi nộp)

Các con số dưới đây **không phải số liệu đo được**. Chúng là giả định để suy ra response measure, và nhóm phải nêu rõ giả định khi trình bày.

**Giả định:**

- Tổng khách hàng đăng ký năm đầu: 200.000 (theo đề bài).
- Tỷ lệ khách hàng hoạt động trong một tháng bình thường: 10% → 20.000 khách/tháng.
- Tỷ lệ hoạt động trong một ngày bình thường: 10% số khách hoạt động tháng → 2.000 khách/ngày.
- Mỗi khách hoạt động tạo trung bình 20 request trong một phiên (tìm kiếm, xem sản phẩm, giỏ hàng, đặt hàng).
- Giờ cao điểm trong ngày chiếm khoảng 20% lưu lượng ngày, dồn trong 2 giờ.

**Suy ra, mức bình thường:**

- Request/ngày bình thường: 2.000 × 20 = 40.000 request.
- Request/giây trung bình giờ cao điểm bình thường: 40.000 × 20% / (2 × 3.600) ≈ 1,1 request/giây.
- Với hệ số đỉnh trong giờ cao điểm (gấp 5 lần trung bình giờ cao điểm), mức thiết kế bình thường khoảng 5–10 request/giây.

**Suy ra, mức flash sale:**

- Đề bài yêu cầu chịu được 5.000 request/giây khi flash sale bằng scale-out, không thay đổi code.
- Đề bài nêu lưu lượng tăng gấp 20 lần. Mức 5.000 request/giây là mục tiêu thiết kế theo đề bài, không phải kết quả suy ra trực tiếp từ 200.000 khách hàng, vì flash sale dồn người mua vào một khung giờ rất ngắn và một số ít sản phẩm.
- Kịch bản kiểm chứng tối thiểu theo đề bài: 1.000 người mua 100 sản phẩm trong 10 giây, overselling = 0. Đây là kịch bản nhóm phải chạy được ở M4, còn mục tiêu 5.000 request/giây là mục tiêu kiến trúc, không được kết luận là đã đạt nếu chỉ chạy trên laptop mà không nêu môi trường kiểm chứng.

**Kết luận từ ước lượng tải:**

- Hệ thống bình thường không cần kiến trúc quá phức tạp. Cái khó là đỉnh tải ngắn, dồn vào ít sản phẩm, và tính nhất quán của tồn kho.
- Vì vậy, chiến lược đúng là: đường đọc (tìm kiếm, xem sản phẩm) dùng cache; đường ghi tồn kho dùng cơ chế nguyên tử và hàng đợi; và chỉ scale phần chịu tải đỉnh, không scale toàn bộ hệ thống một cách mù quáng.

## 7. Quality Attribute Scenarios (đủ 6 phần)

Mỗi scenario có đủ: Source (nguồn kích hoạt), Stimulus (kích hoạt), Artifact (thành phần chịu tác động), Environment (môi trường), Response (phản hồi), Response Measure (thước đo).

### QA1 — Flash sale không bán vượt kho (bắt buộc a)

- **Source:** 1.000 khách hàng đồng thời.
- **Stimulus:** Cùng gửi request mua 100 sản phẩm flash sale trong vòng 10 giây.
- **Artifact:** Dịch vụ Inventory và dịch vụ Ordering.
- **Environment:** Hệ thống đang chạy bình thường, tồn kho ban đầu của sản phẩm flash sale là 100.
- **Response:** Hệ thống chỉ xác nhận tối đa 100 đơn thành công; các request còn lại nhận thông báo hết hàng (HTTP 409 OUT_OF_STOCK), không tạo đơn thành công thừa, không trừ kho âm.
- **Response Measure:**
  - Số đơn thành công: $\le 100$ `[Mục tiêu từ đề bài]`.
  - Số đơn vượt tồn kho (overselling): $= 0$ `[Mục tiêu từ đề bài]`.
  - Tồn kho cuối trong Database và Cache: $\ge 0$ và $= 100 - (\text{số đơn thành công})$ `[Mục tiêu từ đề bài]`.
  - Kết quả kiểm chứng được trích xuất trực tiếp từ log đơn hàng và log tồn kho ở M4.

### QA2 — Thanh toán lỗi sau khi đã trừ kho (bắt buộc b)

- **Source:** Cổng thanh toán giả lập (VNPay / MoMo mock).
- **Stimulus:** Trả mã lỗi thanh toán (HTTP 402 / error callback) sau khi hệ thống đã trừ tồn kho và tạo đơn ở trạng thái chờ thanh toán (`RESERVED`).
- **Artifact:** Luồng điều phối đặt hàng (Saga Orchestrator) gồm Ordering, Inventory, Payment.
- **Environment:** Hệ thống đang chạy bình thường, có ít nhất một đơn đang ở bước thanh toán.
- **Response:** Hệ thống kích hoạt bước bù trừ (compensation): chuyển trạng thái đơn sang `PAYMENT_FAILED`, hoàn lại tồn kho trong cả PostgreSQL và Redis, ghi event bù trừ vào Outbox, và phản hồi rõ ràng cho khách hàng rằng đơn chưa thành công và không bị trừ tiền.
- **Response Measure:**
  - Tỷ lệ tồn kho được hoàn trả chính xác sau thanh toán lỗi: $100\%$ trường hợp kiểm chứng `[Mục tiêu từ đề bài]`.
  - Số đơn ở trạng thái kẹt (vừa trừ kho vừa chưa thanh toán mà không có bước bù trừ): $= 0$ `[Mục tiêu từ đề bài]`.
  - Thời gian hoàn tất bước bù trừ hoàn kho: $\le 30$ giây trong kịch bản kiểm chứng `[Giả định của nhóm, phải đo ở M4]`.

### QA3 — Dịch vụ gợi ý sập không làm gián đoạn đặt hàng (bắt buộc c)

- **Source:** Lỗi nội bộ hoặc sự cố mạng từ dịch vụ gợi ý sản phẩm (Recommendation Service).
- **Stimulus:** Dịch vụ gợi ý ngừng hoạt động hoàn toàn (trả HTTP 503 hoặc timeout) trong giờ cao điểm.
- **Artifact:** Luồng đặt hàng cốt lõi (Ordering Service) và giao diện trang sản phẩm (Catalog Service).
- **Environment:** Hệ thống đang trong giờ cao điểm, dịch vụ gợi ý bị tắt hoặc ngắt kết nối.
- **Response:** Khách hàng vẫn tìm kiếm, xem chi tiết sản phẩm, thêm vào giỏ và đặt hàng thanh toán thành công bình thường. Khu vực gợi ý áp dụng graceful degradation (fallback hiển thị danh sách rỗng kèm ghi chú hoặc ẩn đi), không gây lỗi lan truyền (fault isolation) làm chặn luồng chính.
- **Response Measure:**
  - Tỷ lệ đặt hàng thành công của luồng chính: duy trì $100\%$ đối với các request hợp lệ, không giảm sút do lỗi gợi ý `[Mục tiêu từ đề bài]`.
  - Số đơn hàng bị chặn hoặc thất bại do lỗi từ dịch vụ gợi ý: $= 0$ `[Mục tiêu từ đề bài]`.
  - Trang chi tiết sản phẩm vẫn tải thành công (HTTP 200), thời gian fallback gợi ý $\le 100$ ms `[Giả định của nhóm, phải đo ở M4]`.

### QA4 — Thêm đơn vị vận chuyển mới (bắt buộc d)

- **Source:** Đội ngũ phát triển / vận hành hệ thống.
- **Stimulus:** Yêu cầu tích hợp thêm một đơn vị vận chuyển mới (ví dụ: Viettel Post, J&T) vào hệ thống đang chạy.
- **Artifact:** Lớp tích hợp vận chuyển (Shipping Adapter) và dịch vụ Shipping.
- **Environment:** Hệ thống đang vận hành trực tuyến, các đơn vị vận chuyển hiện tại (GHN, GHTK) vẫn đang xử lý đơn hàng bình thường.
- **Response:** Đơn vị vận chuyển mới được tích hợp bằng cách triển khai một adapter mới tuân thủ interface `createShipment()`, đăng ký vào danh mục carrier mà không cần sửa đổi bất kỳ dòng code nào trong logic đặt hàng hoặc Saga cốt lõi.
- **Response Measure:**
  - Thời gian công lập trình và tích hợp: $\le 3$ ngày công (24 giờ công làm việc) `[Mục tiêu từ đề bài]`.
  - Số file thuộc logic đặt hàng cốt lõi (`Ordering`, `Saga Orchestrator`) phải sửa đổi: $= 0$ file `[Mục tiêu từ đề bài]`.
  - Số dòng code mới cần viết cho adapter mới: $\le 50$ dòng code `[Giả định của nhóm]`.

### QA5 — Tìm kiếm nhanh trong giờ cao điểm

- **Source:** Khách hàng đồng thời trên sàn.
- **Stimulus:** Gửi yêu cầu tìm kiếm full-text tiếng Việt và lọc sản phẩm theo nhiều tiêu chí trong khung giờ flash sale cao điểm.
- **Artifact:** Dịch vụ tìm kiếm (Postgres Full-text search / GIN Index) và lớp đệm phân tán (Redis Cache).
- **Environment:** Hệ thống đang chịu tải cao, có nhiều request tìm kiếm và xem hàng diễn ra đồng thời.
- **Response:** Kết quả tìm kiếm trả về chính xác theo từ khóa, có phân trang, ưu tiên đọc từ cache nếu từ khóa phổ biến; nếu cache miss thì truy vấn database có đánh chỉ mục, không gây nghẽn đường ghi đặt hàng.
- **Response Measure:**
  - Độ trễ phản hồi trang tìm kiếm: $p95 < 500$ ms trong kịch bản kiểm chứng `[Mục tiêu từ đề bài]`.
  - Tỷ lệ cache hit đối với các truy vấn tìm kiếm phổ biến trong flash sale: $\ge 80\%$ `[Giả định của nhóm, phải đo ở M4]`.
  - Throughput tìm kiếm đạt tối thiểu $100$ request/giây trên môi trường kiểm chứng prototype `[Giả định của nhóm, phải đo ở M4]`.

### QA6 — Đặt hàng nhanh và không trùng đơn

- **Source:** Khách hàng hoặc mạng truyền thông.
- **Stimulus:** Khách hàng bấm nút đặt hàng nhiều lần liên tiếp do sốt ruột, hoặc mạng gửi lại (retry) cùng một request đặt hàng do chập chờn.
- **Artifact:** Dịch vụ Ordering, bảng đơn hàng với ràng buộc `UNIQUE (idempotency_key)`.
- **Environment:** Hệ thống đang chạy bình thường, tiếp nhận các request trùng lặp trong khoảng thời gian mili-giây.
- **Response:** Cơ chế Idempotency kiểm tra khóa duy nhất: request đầu tiên được xử lý tạo đơn, các request trùng lặp tiếp theo nhận lại kết quả của đơn đã tạo trước đó mà không trừ kho lần hai, không charge tiền lần hai.
- **Response Measure:**
  - Số đơn hàng được tạo ra từ cùng một Idempotency Key: $= 1$ đơn duy nhất trong $100\%$ trường hợp `[Mục tiêu từ đề bài]`.
  - Số lần trừ kho trùng lặp (duplicate stock decrement): $= 0$ lần `[Mục tiêu từ đề bài]`.
  - Độ trễ phản hồi luồng đặt hàng: $p95 < 2$ giây `[Mục tiêu từ đề bài]`.

### QA7 — Scale-out khi flash sale mà không đổi code

- **Source:** Đội vận hành hệ thống.
- **Stimulus:** Lưu lượng truy cập flash sale tăng đột biến lên mức đỉnh 5.000 request/giây.
- **Artifact:** Tầng API Gateway / Web Backend và các service xử lý đơn hàng, tồn kho.
- **Environment:** Hệ thống đang hoạt động trên môi trường container hóa (Docker / Kubernetes), đội vận hành tăng số lượng replica instance.
- **Response:** Các instance API mới khởi động và tự động nhận tải thông qua bộ cân bằng tải (Load Balancer) mà không cần thay đổi bất kỳ dòng mã nguồn nào; trạng thái chia sẻ được lưu tại Redis và PostgreSQL.
- **Response Measure:**
  - Khả năng tiếp nhận tải theo thiết kế kiến trúc: đạt $5.000$ request/giây khi scale-out đủ tài nguyên máy chủ `[Mục tiêu từ đề bài]`.
  - Số dòng mã nguồn ứng dụng cần chỉnh sửa để scale-out: $= 0$ dòng `[Mục tiêu từ đề bài]`.
  - Lưu ý kiểm chứng: Trên máy tính cá nhân / Docker Compose nội bộ đơn máy, kịch bản prototype chỉ kiểm chứng ở quy mô phù hợp (ví dụ: $1.000$ request đồng thời cho $100$ sản phẩm) và phải ghi rõ môi trường, tuyệt đối không tự kết luận đã đạt 5.000 req/s trên production nếu chưa đo thực tế trên cụm server phân tán.

### QA8 — Đối soát doanh thu cho người bán

- **Source:** Quản trị sàn và hệ thống đối soát định kỳ.
- **Stimulus:** Định kỳ cuối ngày, hệ thống chạy tiến trình tổng hợp đơn hàng, thanh toán thành công và hoàn tiền để thanh toán cho người bán.
- **Artifact:** Bounded context Seller / Payout, bảng `orders`, `outbox`, log giao dịch thanh toán.
- **Environment:** Hệ thống đã ghi nhận đầy đủ các giao dịch thành công, thất bại, hủy và hoàn tiền phát sinh trong ngày.
- **Response:** Báo cáo đối soát tính toán chính xác tổng doanh thu ròng: $\text{Doanh thu} = \sum (\text{Đơn CONFIRMED}) - \sum (\text{Đơn REFUNDED})$; các đơn hủy và đơn lỗi không được cộng tiền; mọi khoản chênh lệch đều có log truy vết chi tiết.
- **Response Measure:**
  - Độ chính xác khớp số liệu tài chính: $100\%$ khớp giữa đơn hàng thực tế và số tiền thanh toán cho người bán `[Mục tiêu từ đề bài]`.
  - Chênh lệch tài chính không giải trình được: $= 0$ VND `[Mục tiêu từ đề bài]`.
  - Thời gian hoàn thành tính toán batch đối soát cho $10.000$ đơn hàng: $\le 60$ giây `[Giả định của nhóm, phải đo ở M4]`.

## 8. Utility Tree

Xếp hạng theo (Business importance, Technical risk), H = cao, M = trung bình, L = thấp.

| QA | Scenario | (Importance, Risk) |
|---|---|---|
| Consistency | QA1 — Flash sale không bán vượt kho | (H, H) |
| Reliability | QA2 — Thanh toán lỗi, hoàn kho bằng Saga | (H, H) |
| Performance | QA5 — Tìm kiếm p95 < 500 ms | (H, H) |
| Performance | QA6 — Đặt hàng p95 < 2 giây, không trùng đơn | (H, H) |
| Availability | QA3 — Dịch vụ gợi ý sập không chặn đặt hàng | (H, M) |
| Scalability | QA7 — Scale-out 5.000 request/giây không đổi code | (H, M) |
| Modifiability | QA4 — Thêm đơn vị vận chuyển ≤ 3 ngày công | (M, M) |
| Reliability | QA8 — Đối soát khớp 100% | (M, L) |

**Lý do xếp hạng:**

- QA1 và QA2 được (H, H) vì bán vượt kho và mất nhất quán tiền – kho là lỗi không thể chấp nhận đối với một sàn thương mại, đồng thời cơ chế trừ kho nguyên tử và Saga là phần khó nhất về kỹ thuật.
- QA5 và QA6 được (H, H) vì đây là trải nghiệm trực tiếp của khách hàng trong giờ cao điểm, và việc giữ p95 thấp trong khi vẫn đảm bảo nhất quán là một trade-off thật.
- QA3 được (H, M) vì quan trọng về mặt kinh doanh nhưng có tactic quen thuộc là tách dịch vụ phụ và circuit breaker / fallback.
- QA4 được (M, M) vì quan trọng cho khả năng mở rộng, nhưng có thể giải quyết bằng adapter nếu thiết kế ngay từ đầu.

## 9. Architecturally Significant Requirements (ASR)

| Mã ASR | Nội dung | Nguồn |
|---|---|---|
| ASR1 | Flash sale không bán vượt tồn kho, kiểm chứng bằng kịch bản 1.000 người mua 100 sản phẩm trong 10 giây | QA1 |
| ASR2 | Đặt hàng – thanh toán – tồn kho nhất quán bằng Saga có bù trừ, thanh toán lỗi thì hoàn kho | QA2 |
| ASR3 | Tìm kiếm p95 < 500 ms và đặt hàng p95 < 2 giây trong giờ cao điểm | QA5, QA6 |
| ASR4 | Luồng đặt hàng đạt availability cao trong giờ cao điểm, dịch vụ phụ lỗi không chặn luồng chính | QA3, QA7 |

Bốn ASR này là đầu vào bắt buộc cho M2. Mọi pattern, tactic và ADR ở M2 phải truy vết được về ít nhất một ASR trong bảng này. Nếu một lựa chọn công nghệ không giúp đạt ASR nào, nhóm phải bỏ nó hoặc chứng minh nó không làm hại ASR nào.
