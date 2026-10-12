# Tích hợp AI toàn diện trong ProcureIQ — 4 Tầng năng lực

Cập nhật ngày 12/10/2026. Hệ thống ProcureIQ hiện đã hoàn thiện và tích hợp **4 tầng năng lực AI** toàn diện, tuân thủ chặt chẽ nguyên tắc **Human-in-the-Loop** (AI hỗ trợ và chuẩn bị dữ liệu, con người giữ quyền quyết định cuối cùng):

---

## 4 Tầng năng lực AI trong ProcureIQ

```
┌─────────────────────────────────────────────────────────────────┐
│                     PROCUREIQ AI ARCHITECTURE                   │
├─────────────────────────────────┬───────────────────────────────┤
│ 1. AI Đọc hiểu tài liệu        │ Gemini Structured Outputs     │
│    (Quotation Extraction)       │ Regex pre-extract + Grounding │
├─────────────────────────────────┼───────────────────────────────┤
│ 2. AI Cảnh báo rủi ro           │ Đối sánh 5 kỳ giá lịch sử,    │
│    (Anomaly Detection)          │ Catalog, Tiến độ & Uy tín NCC │
├─────────────────────────────────┼───────────────────────────────┤
│ 3. AI Soạn thảo giao tiếp       │ Soạn thư mời báo giá RFQ &    │
│    (Communication Drafting)     │ Thư đặt hàng PO tự động       │
├─────────────────────────────────┼───────────────────────────────┤
│ 4. AI Tự điều phối quy trình   │ LangGraph Workflow + Checkpoint│
│    (Self-orchestration)         │ 2 Cổng phê duyệt con người    │
└─────────────────────────────────┴───────────────────────────────┘
```

1. **Tầng 1: Đọc hiểu tài liệu & trích xuất báo giá (Quotation Extraction)**
   - Sử dụng Google Gemini (`gemini-3.5-flash-lite`) với Schema JSON nghiêm ngặt và đối soát trích dẫn gốc (grounding evidence).
   - Tối ưu hóa token: Regex pre-extract bỏ qua LLM khi đủ dữ liệu, tiền lọc tài liệu (`prune_document_for_llm`) giảm 75% input tokens, giới hạn `maxOutputTokens`.

2. **Tầng 2: Phát hiện bất thường & Cảnh báo rủi ro (Anomaly Detection)**
   - Ngay khi có đơn giá trích xuất, backend đối chiếu với lịch sử giá 5 kỳ gần nhất, giá danh mục (catalog) và giá bình quân thị trường.
   - Cảnh báo trực quan theo màu:
     - 🔴 **Đỏ**: Đơn giá tăng > 15%, hoặc NCC có điểm đánh giá đơn hàng gần nhất < 60/100.
     - 🟡 **Vàng**: Đơn giá tăng 5–15%, hoặc NCC có tỷ lệ trễ hạn giao hàng cao.
     - 🟢 **Xanh**: Đơn giá giảm hoặc thấp hơn giá bình quân thị trường.

3. **Tầng 3: AI soạn thảo văn bản giao tiếp (Email Drafting)**
   - AI tự động soạn thư mời thầu RFQ hoặc thư gửi Đơn mua hàng PO bằng tiếng Việt trang trọng, chuẩn xác số liệu và điều khoản.
   - Nhân viên có thể xem trước trong Modal, chỉnh sửa trực tiếp, sao chép hoặc gửi ngay.

4. **Tầng 4: LangGraph Workflow tự điều phối (Autonomous Orchestration)**
   - Cấu hình qua cờ `AGENT_ENABLED=true`.
   - Chuỗi 6 Node: `Phát hiện nhu cầu -> Cổng duyệt 1 (Human Gate 1) -> Thu thập báo giá -> Tính AHP & Tờ trình -> Cổng duyệt 2 (Human Gate 2) -> Lập đơn mua PO`.
   - Sử dụng cơ chế `interrupt()` của LangGraph: Agent tự động dừng chờ quyết định của cấp quản lý và tự phục hồi khi có phê duyệt.

---

## Kịch bản Demo Toàn diện (End-to-End Walkthrough)

### Kịch bản 1: AI Agent tự điều phối toàn bộ quy trình mua sắm

1. **Khởi tạo quy trình:**
   - Đăng nhập bằng tài khoản Quản trị viên (`admin@ahp.local` / `Demo@12345`) hoặc Nhân viên Mua hàng (`buyer@ahp.local`).
   - Mở menu **AI Agent**, bấm nút **"Bắt đầu quy trình"**.
   - Chọn mặt hàng (ví dụ: `Bìa hồ sơ A4` hoặc `Giấy A4 Double A`), nhập số lượng đề nghị (hoặc để trống để Agent phát hiện nhu cầu từ tồn kho).
   - Bấm **"Bắt đầu"**.

2. **Cổng phê duyệt 1 (Gate 1 - Nhu cầu mua hàng):**
   - Agent chạy node `detect_need`, tạo yêu cầu mua sắm và dừng lại ở trạng thái `waiting_gate1`.
   - Trên màn hình AI Agent xuất hiện thông báo: *"Quy trình đang chờ duyệt nhu cầu mua"*.
   - Bấm **"Mở yêu cầu duyệt"** để sang trang **Phê duyệt**.
   - Quản lý kiểm tra đối chiếu tồn kho, lý do đề nghị và bấm **"Chấp thuận"**.
   - **Agent tự động kích hoạt tiếp:** Chuỗi hành động tự động tạo RFQ, thu thập báo giá các NCC, chạy thuật toán AHP đa tiêu chí và lập Tờ trình lựa chọn NCC tối ưu.

3. **Cổng phê duyệt 2 (Gate 2 - Lựa chọn nhà cung cấp):**
   - Agent dừng lại ở trạng thái `waiting_gate2`.
   - Người quản lý mở trang **Phê duyệt**, xem bảng xếp hạng AHP, điểm trọng số và xác suất đứng đầu qua mô phỏng Monte Carlo.
   - Bấm **"Chấp thuận"** tờ trình.
   - **Agent tự động hoàn tất:** Node `finalize` được kích hoạt, tạo Đơn mua hàng PO chính thức. Quy trình chuyển sang trạng thái `completed`.

---

### Kịch bản 2: AI Soạn thảo email giao tiếp (RFQ & PO)

1. **Soạn thư mời báo giá RFQ:**
   - Mở menu **Yêu cầu và báo giá**, tìm RFQ đang mở.
   - Bấm nút **"Soạn thư mời"** cạnh nhà cung cấp.
   - Modal hiển thị tiêu đề và nội dung thư mời thầu do AI chuẩn bị sẵn với thông tin sản phẩm, số lượng, quy cách.
   - Bấm **"AI soạn lại"** để đổi phong cách hoặc bấm **"Sao chép nội dung"** / **"Xác nhận & gửi"**.

2. **Soạn thư gửi Đơn mua hàng PO:**
   - Mở menu **Đơn mua và nhập kho**.
   - Tại các PO chờ gửi thư, bấm **"Xem / AI soạn thư PO"**.
   - AI sinh nội dung thư đặt hàng trang trọng đính kèm thông tin mặt hàng, số lượng và yêu cầu xác nhận thời gian giao.

---

### Kịch bản 3: Trích xuất báo giá & Cảnh báo bất thường (Anomaly Detection)

1. Mở menu **Yêu cầu và báo giá**, chọn **Trích xuất tài liệu**.
2. Chọn RFQ và Nhà cung cấp, dán nội dung báo giá hoặc chọn file `demo-quotation.pdf`.
3. Bấm **"Trích xuất bản nháp"**:
   - Hệ thống hiển thị bảng trích xuất số liệu (đơn giá, số lượng, ngày giao, VAT).
   - Panel **Phát hiện bất thường & Đối sánh giá** ngay lập tức đối chiếu:
     - Biểu đồ và so sánh đơn giá với báo giá 5 kỳ gần nhất.
     - So sánh thời gian giao hàng và điểm uy tín/đánh giá của nhà cung cấp.
     - Hiển thị cảnh báo trực quan nếu đơn giá tăng đột biến hoặc nhà cung cấp có rủi ro trễ hẹn.

---

## Hướng dẫn Kiểm thử tự động

```powershell
# 1. Kiểm thử Python Agent (toàn bộ 30 tests bao gồm Gemini, Extraction, Email Drafting, LangGraph)
& "services\agent\.venv\Scripts\python.exe" -m pytest services\agent\tests

# 2. Kiểm thử API Backend (toàn bộ 122 tests bao gồm Anomaly Benchmark, Human Gates, Lifecycle)
npm test -w apps/api

# 3. Kiểm thử đóng gói Frontend React
npm run build -w apps/web
```

