# Luồng và dữ liệu của giai đoạn nghiệp vụ

Sơ đồ mô tả bản đã triển khai. API kiểm tra quyền, trạng thái, hạn báo giá và CR trong transaction; giao diện chỉ hỗ trợ thao tác.

```mermaid
flowchart LR
  A[Mua hàng tạo nhu cầu] --> B{Quản lý duyệt nhu cầu}
  B -->|Từ chối| X[Kết thúc yêu cầu]
  B -->|Duyệt| C[Tạo RFQ cho ít nhất hai NCC]
  C --> D[Nhập báo giá thủ công]
  D --> E[Tính AHP và kiểm tra CR]
  E -->|CR lớn hơn 0.1| F[Điều chỉnh so sánh]
  F --> E
  E -->|CR đạt| G{Quản lý duyệt lựa chọn}
  G -->|Duyệt phiên còn hiệu lực| H[Tạo PO từ snapshot]
  H --> I[Thủ kho nhận từng đợt]
  I --> J[Cộng số lượng đạt vào tồn kho]
  J --> K[Nhận đủ và đánh giá NCC]
  K --> E
```

```mermaid
erDiagram
  PRODUCT ||--o{ REQUEST : needs
  PRODUCT ||--o{ PRICE : priced
  SUPPLIER ||--o{ PRICE : offers
  REQUEST ||--o| RFQ : creates
  REQUEST ||--o{ APPROVAL : reviewed
  RFQ ||--o{ QUOTATION : receives
  SUPPLIER ||--o{ QUOTATION : submits
  RFQ ||--o{ AHP_SESSION : compared
  AHP_SESSION ||--o{ APPROVAL : selection
  AHP_SESSION ||--o| ORDER : approved_order
  ORDER ||--o{ RECEIPT : delivered
  ORDER ||--o| EVALUATION : final_feedback
```

Database dùng các bảng PostgreSQL có khóa chính `id` và nội dung JSONB. Khóa ngoại cho quan hệ nghiệp vụ, chỉ mục unique cho SKU, email, giá NCC–mặt hàng, RFQ–yêu cầu, báo giá NCC–RFQ, PO–RFQ, khóa chống nhập lặp và đánh giá–PO. Quan hệ danh sách nhà cung cấp trong RFQ được kiểm tra ở service.

Mỗi lần tính AHP lưu bản chụp báo giá và dữ liệu tiêu chí. Sửa báo giá làm phiên trước mất hiệu lực; PO luôn đọc bản chụp đã duyệt. Một yêu cầu có tối đa một RFQ, một RFQ có tối đa một PO. Phiếu nhập retry cùng khóa và nội dung không cộng tồn lại; cùng khóa nhưng nội dung khác bị từ chối. Chỉ có một đánh giá cuối cùng khi PO đã nhận đủ.
