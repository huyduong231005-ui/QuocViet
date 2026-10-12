# Báo cáo kiểm thử giai đoạn nghiệp vụ — 11/10/2026

Môi trường: Windows của người dùng, Node24/npm11, API NestJS, React/AntD, PostgreSQL nhúng PGlite. API local cổng3000; không dùng dữ liệu doanh nghiệp hay SMTP ngoài. Mọi số liệu dưới đây là kết quả thực chạy hoặc được ghi rõ giới hạn.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd ci` | Thành công từ lockfile |
| `npm.cmd test` — API | **17 đạt, 0 lỗi** |
| `npm.cmd test` — logic web | **7 đạt, 0 lỗi** |
| `npm.cmd run build` | TypeScript API/web và Vite đạt |
| HTTP thật | Login 5 vai trò; sai mật khẩu/thiếu token bị401; thao tác không đủ quyền bị403; dữ liệu sai bị400; PDF/Excel trả đúng định dạng và có nội dung |
| Nghiệp vụ transaction | Chặn RFQ/PO chưa duyệt; báo giá hết hạn hoặc session stale; chống nhập quá số lượng, retry phiếu nhập và tạo PO lặp |
| AHP | 3 trường hợp biết nghiệm, ma trận không nhất quán, n=1/2, reciprocity/NaN, cây nhóm, cost/benefit, seed Monte Carlo, độ nhạy |
| Tiền VND | Kiểm tra số nguyên, VAT hai chữ số thập phân, tính bằng BigInt và làm tròn một lần; từ chối tổng vượt số nguyên an toàn |
| Persistence | Test đóng/mở lại DB trên đĩa đạt; bản demo sau hai lần restart vẫn giữ tồn220, PO received, 2 phiếu nhập và 1 đánh giá |
| Startup | `scripts/start.ps1` và `scripts/stop.ps1` chạy thành công; health báo agentEnabled=false |
| Windows PowerShell 5.1 | Tái hiện lỗi parse `stop.ps1` khi UTF-8 không BOM; đổi start/stop sang UTF-8 có BOM; kiểm tra cú pháp và dừng/khởi động API bằng đúng Windows PowerShell 5.1 đều đạt |
| PostgreSQL 18 ngoài | Trên cluster thử nghiệm riêng: kiểm tra sai mật khẩu, database không trống (kể cả schema tự đặt), từ chối ghi đè cấu hình, ký tự đặc biệt trong mật khẩu, migration, đăng nhập và persistence đạt. Kiểm tra truyền mật khẩu qua stdin và ACL cục bộ đạt |
| Database thật ở chế độ trống | Kết nối database người dùng cung cấp: 17 bảng, một admin riêng, mọi bảng nghiệp vụ có 0 bản ghi; `demoMode=false`, `agentEnabled=false`; đăng nhập admin đạt và tài khoản demo bị401 |
| Agent để sau | API trả403 cho start/extract/tools kể cả đúng khóa agent khi tắt; không tạo run |
| Trình duyệt | Chrome: tạo mặt hàng → nhu cầu → duyệt1 → RFQ → 2 báo giá → AHP → duyệt2 → PO → nhập40+60 → đánh giá → tồn220 |
| Biểu mẫu | SKU trùng bị từ chối, bản nháp giữ nguyên; dropdown NCC đúng RFQ; receipt có khóa retry ổn định |
| Responsive | Kiểm tra 390×844 và 1440×900; menu hoạt động, bảng cuộn ngang; sửa nút sidebar mặc định đè tiêu đề trên mobile |
| Review độc lập | Review đặc tả và chất lượng đã đồng ý giai đoạn core sau các sửa lỗi |

Ảnh và các mã demo ở [demo.md](demo.md). Hai kích thước trình duyệt chỉ là mẫu kiểm thử, chưa phải kiểm tra mọi thiết bị.

## Các lỗi đã tìm và sửa

- Tiêm dependency khi chạy HTTP tests: thêm khai báo Inject tường minh.
- JSONB thay đổi thứ tự khóa gây retry phiếu nhập khác nội dung giả: dùng so sánh cấu trúc.
- Chặn xóa NCC đang được RFQ dùng; kiểm tra lại hạn snapshot tại điểm duyệt2.
- Từ chối khởi động non-demo trên DB đã có tài khoản demo.
- Tổng tiền có thể vượt giới hạn số nguyên JavaScript: chuyển tính toán sang BigInt và validation.
- Form khởi tạo lại khi mutation loading có thể xóa dữ liệu nhập: chỉ khởi tạo khi mở form.
- Dropdown báo giá hiển thị NCC không được mời: lọc theo RFQ và loại NCC ngừng hoạt động.
- Nút menu AntD mặc định đè phần đầu trang mobile: tắt trigger phụ, giữ menu ở header.
- Script PowerShell chứa tiếng Việt được lưu UTF-8 không BOM, làm Windows PowerShell 5.1 đọc sai và báo thiếu dấu nháy; sửa mã hóa và thêm kiểm tra parse chạy trên Windows PowerShell.

Trong quá trình thay build lúc trình duyệt đang mở, trang cũ có một lần thiếu lazy chunk. Nạp lại bản build mới khôi phục giao diện; khi phát triển cần reload sau build. Không ghi lỗi này thành lỗi điều hướng mobile.

## Giới hạn còn lại

- Agent tắt mặc định. Mã Python chuẩn bị có 19 tests đạt, 1 skipped cho bộ30 mẫu chưa làm. Chưa kiểm chứng tích hợp Python↔NestJS, mô hình thật, OCR thật hay checkpoint PostgreSQL ngoài; kết quả đó không nằm trong 24 tests core.
- Email RFQ/PO là outbox mô phỏng. Chưa gửi email, mua hàng, triển khai công khai hay chạy Docker.
- CI đã có cấu hình, chưa chạy trên GitHub vì repo chưa có remote.
- Vite còn cảnh báo chunk chính khoảng872KB trước gzip; đã tách các màn hình tải theo nhu cầu nhưng chưa tối ưu cho mạng chậm.
- `npm audit` còn **2 cảnh báo moderate** cùng chuỗi ExcelJS→uuid, **0 high/critical**. Chưa xử lý triệt để cảnh báo phụ thuộc này; không tự hạ ExcelJS sang major cũ bằng audit force. Cần xử lý trước triển khai vận hành ngoài máy local.
- Chưa có giao diện quản lý tài khoản, nghiệm thu người dùng/giảng viên, báo cáo nghiên cứu/slides/video hay đánh giá tài liệu thật.
- Xuất báo cáo đã kiểm tra HTTP và định dạng; chưa nghiệm thu dàn trang PDF/Excel với người dùng.

Phần PostgreSQL 18 ngoài được xác minh bổ sung ngày 11/10/2026; cluster thử nghiệm đã dừng và được giữ trên máy. Kết quả này không xác minh checkpoint PostgreSQL của AI Agent. Dữ liệu demo nhúng được giữ riêng; chưa nhập dữ liệu nghiệp vụ thật.

Tài liệu này báo cáo giai đoạn nghiệp vụ local, không khẳng định toàn bộ kế hoạch15 tuần đã hoàn thành.
