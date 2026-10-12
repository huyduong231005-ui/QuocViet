# Kế hoạch thực hiện theo bước — cập nhật 11/10/2026

Nguồn: kế hoạch Word “Kế hoạch thực hiện dự án nhập hàng AHP + AI Agent”. Chỉ dẫn mới của người dùng được ưu tiên: chia nhỏ, làm từ dễ đến khó, để AI Agent sau. Không quy đổi kết quả demo thành nghiệm thu hay kết quả nghiên cứu trên dữ liệu thật.

Kiến trúc hiện tại: React/Ant Design → REST NestJS → PostgreSQL/PGlite. AHP và kiểm tra phê duyệt thuộc backend. Python Agent là giai đoạn tiếp theo, chưa bật trong giao diện/API mặc định.

## Bước 1 — Nền tảng và danh mục

- [x] Đọc nội dung Word, hai ảnh tham chiếu và chốt hợp đồng API.
- [x] Khởi tạo npm workspaces, Git, build và cấu hình mẫu.
- [x] Đăng nhập, mật khẩu băm, token có hạn và phân quyền 5 vai trò.
- [x] Mặt hàng, NCC, giá tham khảo; dữ liệu demo 24 tháng được ghi rõ mô phỏng.
- [x] Kiểm thử API quyền và tạo mặt hàng qua trình duyệt.

## Bước 2 — Luồng thu thập báo giá thủ công

- [x] Tạo nhu cầu và điểm duyệt thứ nhất.
- [x] Chỉ tạo RFQ sau khi nhu cầu được duyệt; mời ít nhất hai NCC.
- [x] Nhập/sửa báo giá, validation giá VND/VAT/số lượng/hạn.
- [x] Chỉ hiện NCC được mời; không mất bản nháp khi lưu thất bại.
- [x] Hộp gửi RFQ giả lập, không tự gửi email ngoài.
- [x] Chạy luồng thật trên trình duyệt với 2 báo giá.

## Bước 3 — AHP và duyệt lựa chọn

- [x] Power iteration, CI/CR, ma trận nghịch đảo, kiểm tra giá trị hữu hạn.
- [x] Cây nhóm tiêu chí, trọng số cục bộ/toàn cục, tiêu chí chi phí/lợi ích.
- [x] Snapshot bất biến, xếp hạng; CR >0,1 không được gửi duyệt.
- [x] Điểm duyệt thứ hai, chặn PO nếu chưa duyệt/phiên cũ/báo giá hết hạn.
- [x] Monte Carlo có seed và phân tích độ nhạy.
- [x] Kiểm thử ma trận có nghiệm biết trước và duyệt trên trình duyệt.

## Bước 4 — Thực hiện đơn mua

- [x] Tạo PO từ đúng snapshot đã duyệt; không tạo PO lặp theo RFQ.
- [x] Tổng tiền VND chính xác bằng số nguyên, từ chối số vượt giới hạn an toàn.
- [x] Nhận nhiều đợt, chống retry cộng kho lặp, chống giao vượt PO.
- [x] Chỉ cộng hàng đạt yêu cầu vào tồn; một đánh giá cuối khi nhận đủ.
- [x] Dùng phản hồi NCC trong lần AHP tiếp theo.
- [x] Demo 100 ram → nhận 40 + 60 → tồn 120 lên 220 → đánh giá.

## Bước 5 — Báo cáo và bàn giao local

- [x] Dashboard, dự báo trung bình trượt, nhật ký và xuất PDF/Excel.
- [x] Kiểm thử persistence khi mở lại PostgreSQL nhúng.
- [x] Rà soát độc lập và sửa lỗi bảo mật, tiền tệ và biểu mẫu được phát hiện.
- [x] Kiểm thử 17 bài API + 7 bài logic web; build API/web đạt.
- [x] Kiểm tra trình duyệt desktop và màn hình nhỏ; sửa nút điều hướng đè tiêu đề.
- [x] README, kịch bản demo, sơ đồ luồng/dữ liệu, script start/stop và CI mẫu.
- [x] Kiểm chứng lại startup script và dữ liệu demo sau restart bản build cuối.
- [x] Ghi báo cáo kiểm thử cuối và lưu nguồn bằng commit local; bàn giao hướng dẫn chạy.

## Bước 6 — AI Agent (để sau)

Đã giữ mã khung FastAPI/LangGraph, parser và tests tại `services/agent`. Unit tests ở bước chuẩn bị: 19 đạt, 1 tiêu chí corpus được bỏ qua có lý do. Không coi đây là agent tích hợp đã hoàn tất.

- [ ] Chạy tích hợp NestJS ↔ Python qua tool thật với hai điểm interrupt và khởi động lại.
- [ ] Cấu hình mô hình/khóa riêng, ghi token, thử dữ liệu và tờ trình thật.
- [ ] OCR trên máy, bộ 30 tài liệu có nhãn và đánh giá độ chính xác thực đo.
- [ ] SMTP thật, retry/khôi phục email, nghiệm thu thao tác người dùng.

## Các phần vận hành và học thuật tiếp theo

- [ ] PostgreSQL ngoài, Docker Compose, backup/restore và deployment.
- [ ] Màn hình quản lý tài khoản; rà soát vận hành với dữ liệu thật.
- [ ] Use case/BPMN theo chuẩn môn học, báo cáo nghiên cứu, slides và video demo.
- [ ] Người dùng/giảng viên nghiệm thu; không tự ghi đã được đồng ý.

Chi tiết kỹ thuật trong `docs/design.md`; chứng cứ và giới hạn trong `docs/test-report.md`.
