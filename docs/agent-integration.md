# Tích hợp Agent — bước 1: đọc báo giá thành bản nháp

Ngày 12/10/2026. Trọng tâm hiện tại là kết nối React → NestJS → Python → API mô hình. Tính AHP và việc ghi chứng từ vẫn thuộc backend; nhân viên xác nhận các trường trước khi lưu.

## Đã triển khai

- `AGENT_EXTRACTION_ENABLED=true` bật đọc báo giá độc lập với `AGENT_ENABLED` của quy trình tự điều phối.
- Dịch vụ Python chạy nền cùng app khi dùng `scripts/start.ps1`; `scripts/stop.ps1` dừng cả hai tiến trình do script quản lý.
- Trang AI Agent hiển thị kết nối dịch vụ và việc đã cấu hình mô hình hay chưa. “Đã cấu hình” không có nghĩa là key đã được nhà cung cấp xác thực hoặc còn hạn mức.
- Gemini trả dữ liệu qua [Structured Outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output); tích hợp OpenAI tùy chọn dùng [function calling](https://developers.openai.com/api/docs/guides/function-calling?api-mode=chat). Các trường thiếu được trả `null`.
- Chỉ nhận các giá trị mô hình có đoạn dẫn nguyên văn và được bộ đọc độc lập xác nhận. Mô hình không được ghi chứng từ, duyệt yêu cầu hay tự tạo điểm chất lượng từ nhận xét định tính.
- Trích xuất không ghi báo giá. Chỉ “Xác nhận & lưu” mới ghi; nếu NCC đã có báo giá trong RFQ đang mở thì bước xác nhận cập nhật báo giá đó và có thể làm phiên AHP cũ mất hiệu lực.
- Giao diện hiển thị số trường đọc được, trạng thái xử lý qua mô hình hoặc quy tắc và các trường cần bổ sung. Số trường đọc được không phải độ chính xác hay xác suất đúng.
- Bước 1 chỉ hỗ trợ văn bản và PDF có chữ ở giao diện. Ảnh/PDF scan cần OCR được cài và kiểm chứng ở bước sau.

## Cấu hình Gemini (đang chọn)

Trên web ở `http://localhost:3000`:

1. Đăng nhập tài khoản **Quản trị viên**. Trong chế độ demo: `admin@ahp.local` / `Demo@12345`. Tài khoản Mua hàng & kho có thể đọc báo giá nhưng không thay API key dùng chung.
2. Mở **AI Agent → Sử dụng AI**. Xác nhận câu hỏi **“Bạn có muốn sử dụng AI không?”** để mở ô nhập key.
3. Dán một Gemini API key vào ô ẩn. Có thể bấm **+ Thêm key**, hoặc dán nhiều key cách nhau bằng dấu phẩy. Ô nhập chấp nhận cả chuỗi dạng `GEMINI_API_KEY=...` và key có dấu nháy khi sao chép; key không hiển thị lại sau khi lưu.
4. Bấm **Lưu và sử dụng AI**. Trang cập nhật số key đã cấu hình ngay, không cần khởi động lại ứng dụng. Key được giữ trên server trong `.env` đã loại khỏi Git; trình duyệt không lưu key.
5. Chuyển tới **Yêu cầu và báo giá → Trích xuất tài liệu** để kiểm tra lời gọi thật. Trạng thái “đã cấu hình” chỉ xác nhận key được lưu, chưa chứng minh Google đã chấp nhận key.

Nếu muốn cấu hình từ PowerShell, ở thư mục dự án chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-agent.ps1 -Install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-gemini.ps1 -Restart
```

Lệnh đầu chỉ cần khi chưa có môi trường Python. Lệnh thứ hai hỏi một hoặc nhiều Gemini API key bằng ô nhập ẩn tại terminal; Enter ở một ô trống để kết thúc. Nếu đã cấu hình key và chỉ muốn khởi động lại, Enter ngay ở ô đầu giữ các key cũ. Key được lưu trong `.env` đã loại khỏi Git và chỉ dịch vụ Python gửi tới Google; không gửi key vào chat hoặc mã frontend. Mặc định dùng `gemini-3.5-flash-lite`, mô hình ổn định mà [Google mô tả phù hợp với đọc tài liệu](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite). Có thể đổi bằng `-Model`.

Các key được chọn lần lượt giữa các yêu cầu. Khi gặp 429 hoặc lỗi dịch vụ tạm thời, ứng dụng thử tối đa ba key đã cấu hình. Nếu cả ba đều hết hạn mức, giao diện báo rõ và dùng bản nháp đọc bằng quy tắc. [Google áp hạn mức theo dự án, không theo từng key](https://ai.google.dev/gemini-api/docs/rate-limits); nhiều key trong cùng dự án không tăng hạn mức chung. Trang trạng thái chỉ xác nhận key đã được cấu hình, chưa xác nhận Google chấp nhận key.

Để chuẩn bị và thử bộ đọc khi chưa có key:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-gemini.ps1 -PrepareOnly -Restart
```

Trạng thái lúc này ghi “Chưa cấu hình API AI”; bản nháp được đọc bằng quy tắc. Mô hình Gemini chỉ được gọi sau khi có ít nhất một key.

Tích hợp OpenAI cũ vẫn có thể dùng bằng `scripts/configure-ai.ps1 -Restart`; muốn dùng endpoint tương thích khác, truyền `-BaseUrl` và `-Model` cho script đó.

## Demo trên giao diện

1. Đăng nhập bằng tài khoản Mua hàng & kho.
2. Vào AI Agent, kiểm tra dịch vụ đã kết nối và cấu hình mô hình.
3. Vào Yêu cầu và báo giá, chọn Trích xuất tài liệu.
4. Chọn RFQ đang mở và NCC đã được mời. Chọn `services/agent/fixtures/demo-quotation.txt` hoặc `demo-quotation.pdf`, hoặc dán nội dung báo giá.
5. Bấm Trích xuất bản nháp. Kiểm tra số lượng 15, đơn giá 68.000, VAT 8%, giao 3 ngày và hạn 31/12/2099. Đây là số liệu giả lập, phải dùng RFQ phù hợp để thử.
6. Điểm chất lượng không có trong mẫu nên phải bổ sung thủ công từ nguồn đánh giá được xác nhận. Kiểm tra toàn bộ trường rồi Xác nhận & lưu; Hủy sẽ không ghi báo giá.
7. Khi đủ báo giá đã xác nhận, chuyển qua So sánh AHP theo luồng nghiệp vụ hiện có.

Nếu dùng một NCC đã có báo giá, thao tác xác nhận sẽ cập nhật báo giá đó; hãy đọc cảnh báo phiên AHP trước khi lưu. Không dùng mẫu demo để thay dữ liệu nghiệp vụ thực.

Tạo lại PDF mẫu:

```powershell
services/agent/.venv/Scripts/python.exe services/agent/generate_demo.py
```

## Kiểm thử và giới hạn

```powershell
services/agent/.venv/Scripts/python.exe -m pytest services/agent/tests -q
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qa/ai-config.test.ps1
cd apps/api
../../node_modules/.bin/tsx.cmd --test test/agent-extraction.test.ts test/http.test.ts
```

Kiểm thử HTTP chạy dịch vụ Python thật và NestJS trên CSDL thử trong bộ nhớ; chỉ API mô hình được giả lập. Nó kiểm tra schema, đoạn dẫn, trường thiếu, phân quyền, NCC không được mời, bản nháp không ghi dữ liệu, xác nhận mới ghi, API lỗi và dịch vụ mất kết nối.

Kiểm tra ngày 12/10/2026: build đạt; 26 kiểm thử Python đạt, 1 kiểm thử bộ dữ liệu đánh giá còn bỏ qua; kiểm thử HTTP NestJS → Python đạt. Gemini được kiểm thử bằng API giả lập cho cấu trúc JSON, xoay key, giới hạn 429 và kiểm tra đoạn dẫn. Bản chạy tại localhost chọn Gemini nhưng chưa có key, đọc PDF mẫu thành bản nháp (15 đơn vị, 68.000 VND, thiếu điểm chất lượng); báo giá trong CSDL giữ nguyên. Máy chưa có OCR.

Chưa kiểm chứng gọi nhà cung cấp mô hình thật khi chưa có API key. Chưa hoàn tất tích hợp workflow tự điều phối hai điểm duyệt, OCR, checkpoint PostgreSQL hoặc bộ 30 tài liệu đánh giá. Hai file mẫu không phải bộ huấn luyện và không chứng minh độ chính xác trên tài liệu thực.
