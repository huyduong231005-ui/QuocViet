# ProcureIQ — nhập hàng và AHP

Đã đọc kế hoạch Word và triển khai theo thứ tự dễ → khó theo yêu cầu mới của bạn. Bản hiện tại chạy cục bộ, tập trung nghiệp vụ thủ công. AI Agent được tắt mặc định và dành cho giai đoạn sau.

| Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| 1 | Đăng nhập, 4 vai trò, mặt hàng, nhà cung cấp, giá tham khảo | Đã triển khai, kiểm thử |
| 2 | Nhu cầu mua → duyệt nhu cầu → RFQ → nhập báo giá thủ công | Đã triển khai, kiểm thử |
| 3 | Cây tiêu chí, so sánh cặp, trọng số AHP, CI/CR, xếp hạng, duyệt lựa chọn | Đã triển khai, kiểm thử |
| 4 | Đơn mua → nhận nhiều đợt → cập nhật tồn kho → đánh giá nhà cung cấp | Đã triển khai, kiểm thử |
| 5 | Dashboard, dự báo trung bình trượt, Monte Carlo, độ nhạy, PDF/Excel, nhật ký | Đã triển khai; kiểm thử tính toán, tải báo cáo và giao diện |
| 6 | Tích hợp AI Agent, OCR, mô hình thật, bộ 30 tài liệu có nhãn | Để sau; mã khung nằm trong `services/agent` |

Thu mua và Kho được gộp thành **Mua hàng & kho** (mã quyền `buyer`). Tài khoản Kho cũ được migration 003 chuyển sang quyền này, giữ ID, email, mật khẩu và liên kết chứng từ. Các phiên đăng nhập Kho cũ hết hiệu lực và cần đăng nhập lại. Nhật ký lịch sử giữ nguyên vai trò lúc thao tác. Quản lý vẫn duyệt hai bước; AI Agent vẫn có trong menu.

## Mở ứng dụng

Máy hiện tại đã cài dependencies và build. Trong PowerShell:

```powershell
cd D:\Quoc_VIet
.\scripts\start.ps1
```

Mở **http://localhost:3000**. Script chạy nền và ghi log vào `.data`. Dừng bằng `.\scripts\stop.ps1`. Nếu mở bằng `npm.cmd start`, dừng tại terminal đó bằng Ctrl+C.

Khi chạy `DEMO_MODE=true`, tài khoản demo có chung mật khẩu **Demo@12345**:

| Email | Quyền |
| --- | --- |
| admin@ahp.local | Toàn bộ nghiệp vụ demo |
| buyer@ahp.local | Mua hàng & kho: danh mục, nhu cầu, RFQ, báo giá, AHP, PO, nhận hàng, đánh giá |
| manager@ahp.local | Tạo nhu cầu, duyệt hai điểm kiểm soát |
| auditor@ahp.local | Xem dữ liệu và xuất báo cáo |

Đây là tài khoản mô phỏng, chỉ tồn tại khi chạy `DEMO_MODE=true`. Ở chế độ thật, quản trị viên tạo tài khoản cho từng người tại trang **Tài khoản**: chọn một trong bốn vai trò, khóa/mở, đặt lại mật khẩu. Mỗi người tự đổi mật khẩu ở menu góc trên bên phải. Khóa tài khoản, đổi vai trò hoặc đổi mật khẩu làm phiên đăng nhập cũ hết hiệu lực ngay.

## Cài ở máy khác

Yêu cầu Node.js >=22. Không cần Python để chạy bước 1–5.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd start
```

API NestJS cũng phục vụ giao diện React đã build. Khi phát triển: mở hai terminal chạy `npm.cmd run dev:api` và `npm.cmd run dev:web` (giao diện cổng 5173).

Khi chưa có `DATABASE_URL`, dữ liệu local lưu bằng PostgreSQL nhúng PGlite trong `.data/postgres`; khởi động lại giữ nguyên dữ liệu, không seed lại. Không mở hai API cùng truy cập thư mục này. Có thể cấu hình PostgreSQL riêng qua `DATABASE_URL` trong `.env` theo `.env.example`; đã kiểm chứng PostgreSQL 18 trên Windows, chưa kiểm chứng Docker.

Với `DEMO_MODE=false`, database mới chỉ khởi tạo một tài khoản admin từ `ADMIN_EMAIL`/`ADMIN_PASSWORD`; mặt hàng, nhà cung cấp, lịch sử và giao dịch đều trống. Tài khoản demo không đăng nhập được ở chế độ này. `.env` chứa mật khẩu và được loại khỏi Git.

### Dữ liệu demo có sẵn chứng từ

Bản tải về chưa có yêu cầu mua, báo giá hay đơn mua nào. Để mọi màn hình có sẵn dữ liệu, chạy một lần trước khi mở ứng dụng:

```powershell
npm.cmd run db demo
```

Lệnh này ghi một câu chuyện nhỏ nhưng trọn vẹn: một đơn mua đã nhận đủ và đã đánh giá, một đơn mua hai mặt hàng đang nhận dở, và một nhu cầu đang chờ duyệt. Dữ liệu được ghi qua đúng lớp nghiệp vụ mà giao diện dùng, vào đúng CSDL mà ứng dụng sẽ mở (PGlite khi chưa có `DATABASE_URL`, PostgreSQL khi có). Lệnh từ chối chạy nếu CSDL đã có yêu cầu mua, nên không ghi đè dữ liệu thật.

Với `DEMO_MODE=true`, đăng nhập bằng các tài khoản `@ahp.local` ở bảng trên. Với `DEMO_MODE=false`, lệnh tạo thêm tài khoản cho những vai trò còn thiếu (`buyer@demo.local`, `manager@demo.local`, `auditor@demo.local`, mật khẩu **Demo@12345**) và nhập danh mục mẫu nếu danh mục đang trống. Các tài khoản này có mật khẩu công khai: đổi mật khẩu hoặc khóa chúng trước khi dùng thật.

Các script `scripts/start.ps1` và `scripts/stop.ps1` dùng UTF-8 có BOM để Windows PowerShell 5.1 đọc đúng tiếng Việt. Kiểm tra cú pháp bằng `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/powershell.test.ps1`.

## Cách làm từng bước

1. Vào **Danh mục**, kiểm tra mặt hàng và ít nhất hai nhà cung cấp đang hoạt động.
2. Vào **Yêu cầu & báo giá**, tạo nhu cầu; một nhu cầu có thể gồm nhiều mặt hàng. Quản lý duyệt cả nhu cầu một lần ở **Phê duyệt**.
3. Tạo RFQ cho từng mặt hàng của nhu cầu đã duyệt, chọn ít nhất hai nhà cung cấp; nhập báo giá còn hiệu lực, giá VND nguyên và VAT tối đa hai chữ số thập phân.
4. Vào **Workspace AHP**, chọn RFQ, chỉnh cây/ma trận và bấm **Tính AHP**. CR >0,1 bị chặn gửi duyệt. Thay đổi báo giá làm phiên cũ mất hiệu lực và cần tính lại.
5. Gửi duyệt lựa chọn; quản lý quyết định. Nếu chọn khác nhà cung cấp đứng đầu phải ghi lý do. Sau duyệt, vào **Đơn mua & nhập kho → Chờ lập PO**: các lựa chọn của cùng một nhà cung cấp được gộp thành một PO, mỗi mặt hàng một dòng.
6. Nhân viên Mua hàng & kho nhận từng đợt, ghi số giao và số đạt cho từng dòng. Số lượng giao không vượt PO; chỉ số lượng đạt yêu cầu tăng tồn kho. Khi nhận đủ mới đánh giá NCC; điểm này được dùng ở các lần AHP sau.
7. Xem tồn kho/dự báo, nhật ký và tải PDF/Excel.

RFQ và nút **Gửi PO** hiện ghi vào hộp gửi mô phỏng trong cơ sở dữ liệu; chưa gửi email cho nhà cung cấp. Lịch sử 24 tháng, thông tin nhà cung cấp và kết quả demo đều là dữ liệu mô phỏng.

Monte Carlo cho tỷ lệ đứng đầu dưới giả định nhiễu log-uniform ±15%, không phải xác suất bảo đảm lựa chọn đúng. Dự báo dùng ba bản ghi tháng gần nhất; đây là công cụ hỗ trợ quyết định trong demo.

## Cơ sở dữ liệu PostgreSQL

CSDL `QuocViet` (PostgreSQL 18, cổng 5433) dùng lược đồ chuẩn hóa `procurement` từ ngày 11/10/2026. API không tự chạy DDL trên PostgreSQL: nó chỉ kiểm tra phiên bản khi khởi động.

```powershell
npm.cmd run db status     # trạng thái, số tài khoản, số bản ghi nghiệp vụ
npm.cmd run db backup     # pg_dump vào .data\backups
npm.cmd run db provision  # tạo/cấp lại quyền cho tài khoản chạy ứng dụng
node scripts\with-test-cluster.cjs src/database/cli.ts migrate   # sao lưu, diễn tập trên cụm thử nghiệm, rồi chuyển đổi
npm.cmd run test:native   # kiểm thử trên PostgreSQL thật (cụm thử nghiệm cổng 55439)
```

### Nhập danh mục từ Excel

Cách thường dùng: trang **Danh mục → Nhập từ Excel**. Chọn file để kiểm tra trước (chưa ghi gì), xem số bản ghi sẽ tạo hoặc danh sách dòng lỗi, rồi bấm **Nhập vào hệ thống**. Nút **Tải file mẫu** cho file đúng định dạng. Cùng chức năng có ở dòng lệnh:

```powershell
npm.cmd run db sample                                   # tạo file mẫu .data\sample-catalog.xlsx
npm.cmd run db import .data\sample-catalog.xlsx         # xem trước: kiểm tra mọi dòng, không ghi gì
npm.cmd run db import .data\sample-catalog.xlsx commit  # ghi vào CSDL
```

File có ba sheet: `Mặt hàng` (SKU, Tên, Đơn vị, Tồn tối thiểu, Tồn đầu), `Nhà cung cấp` (Tên, Email, Điện thoại, Uy tín) và `Giá tham khảo` (SKU, Nhà cung cấp, Đơn giá, Số ngày giao, Điểm chất lượng). Chỉ cần một dòng sai là cả file bị từ chối, kèm tên sheet và số dòng; không có trường hợp nhập một nửa. SKU hoặc tên nhà cung cấp đã có sẽ bị báo trùng. Dữ liệu trong file mẫu là dữ liệu bịa để thử; ngày 11/10/2026 file này đã được nhập vào `QuocViet` để demo.

Lệnh `migrate` cần cụm thử nghiệm đang chạy để khôi phục thử bản sao lưu và diễn tập trước khi đụng tới CSDL thật. Thay đổi lược đồ về sau là file mới `apps/api/migrations/002_….sql`; không sửa `001_core.sql`. Thiết kế và tình trạng từng hạng mục: [spec CSDL](docs/superpowers/specs/2026-10-11-quocviet-database-design.md).

Tồn kho, số đã nhận và trạng thái đơn mua do CSDL tự tính khi có phiếu nhận; không sửa trực tiếp các số này. API kết nối bằng tài khoản `quocviet_app`, không có quyền tạo/sửa bảng và không ghi được sổ kho hay nhật ký. Kết nối quản trị (`MIGRATION_DATABASE_URL` trong `.env`) chỉ dùng cho các lệnh `db migrate`, `db backup`, `db provision`. Sau mỗi lần migrate, lệnh tự cấp lại quyền.

## Kiểm tra trước khi demo

Bộ kiểm tra này dựng một bản ứng dụng riêng ở chế độ thật trên cụm PostgreSQL thử nghiệm (cổng 55439), bắt đầu từ CSDL trống, nên không đụng tới dữ liệu đang dùng:

```powershell
npm.cmd run build
node scripts\with-test-cluster.cjs ..\..\scripts\qa\setup.ts   # tạo CSDL quocviet_qa và tài khoản chạy riêng
node scripts\qa\serve.cjs                                      # chạy bản thử ở http://127.0.0.1:3100 (để cửa sổ này mở)
node scripts\qa\api-check.cjs                                  # 120 kiểm tra: luồng demo và các thao tác sai thường gặp
```

`api-check.cjs` đi hết câu chuyện demo qua API (tài khoản, nhập danh mục, nhu cầu, RFQ, báo giá, AHP, hai điểm duyệt, PO một và nhiều dòng, nhận hàng, đánh giá, báo cáo) và thử các thao tác sai: sai quyền, nhập thiếu, nhận vượt, gửi lặp, sửa sau khi chốt. Nó in từng kiểm tra không đạt và tổng số đạt. Chạy lại cần tạo lại CSDL bằng `setup.ts`.

Lưu ý khi trình diễn: mỗi địa chỉ máy được thử đăng nhập tối đa 30 lần trong 5 phút; vượt quá sẽ bị từ chối tạm thời.

## Tài liệu và bước tiếp theo

- [Kịch bản demo đã chạy](docs/demo.md)
- [Kết quả kiểm thử và giới hạn](docs/test-report.md)
- [Thiết kế, API và quy tắc nghiệp vụ](docs/design.md)
- [Kế hoạch theo giai đoạn](docs/superpowers/plans/2026-10-11-procurement.md)
- [AI đọc báo giá: cấu hình API và demo](docs/agent-integration.md)
- [Dịch vụ Python Agent và phần còn lại](services/agent/README.md)

Để chuyển sang dữ liệu thật cần cơ sở dữ liệu mới, `DEMO_MODE=false`, `JWT_SECRET` >=32 ký tự và thông tin admin riêng. API từ chối dùng lại cơ sở dữ liệu đã seed tài khoản demo. Việc triển khai công khai, SMTP thật, sao lưu vận hành, quản lý người dùng và nghiệm thu với người dùng/giảng viên là các bước riêng chưa thực hiện.
