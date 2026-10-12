# Thiết kế nâng cấp giao diện: "Bàn giấy và con dấu"

Ngày 12/10/2026. Trạng thái: đã duyệt và đã triển khai cả năm đợt U1–U5 trong ngày; kết quả và các điểm khác bản vẽ ở mục 13.

Bản vẽ: https://claude.ai/artifact/Vfj1DXdUNhw9fvJxgpnYqD (8 khung: Tổng quan, Phê duyệt, So sánh AHP, Đơn mua và nhập kho, Tồn kho và dự báo, Đăng nhập, Hệ thống thiết kế, Thanh điều hướng). Mọi con số trong bản vẽ lấy từ dữ liệu demo đang chạy ngày 11/10/2026.

## 1. Mục tiêu và phạm vi

Giải quyết bốn nhận xét của chủ dự án: giao diện đơn sơ, các khối rời rạc không xếp lớp, màn hình không gắn với nhau, thiếu tương phản và thiếu hình ảnh.

Trong phạm vi: `apps/web` (giao diện, không đổi luồng nghiệp vụ). Ngoài phạm vi: API, CSDL, quyền hạn, chế độ tối, thư viện biểu đồ mới.

## 2. Hiện trạng, có bằng chứng

| Nhận xét | Nguyên nhân trong mã | Bằng chứng |
|---|---|---|
| Thiếu tương phản | Chữ phụ `#8b9ba4` trên nền `#f5f7f8` | Tỷ lệ 2,7:1, chuẩn tối thiểu là 4,5:1 |
| Chữ khó đọc | Cỡ chữ 9 đến 11px gần như khắp nơi | `styles.css`: `.eyebrow` 9px, `.ant-table` 11px, `.status-tag` 10px, `.page-title p` 11px |
| Lẻ tẻ | Hai bộ chữ, hai cỡ chữ cùng lúc | `styles.css` nạp Be Vietnam Pro, `main.tsx` lại đặt Ant Design dùng Segoe UI; chữ trong ô chọn to hơn hẳn chữ trong bảng (11px) |
| Không xếp lớp | Mọi khối chỉ ngăn bằng một nét kẻ | `.work-section{border-top:1px solid}`; bảng và số liệu nằm trần trên nền, không có bề mặt riêng |
| Không gắn khớp | Chuỗi nhu cầu → báo giá → AHP → duyệt → đơn mua → nhập kho không hiện ở đâu | Thanh điều hướng là một danh sách các mục ngang hàng; chứng từ không cho biết nó đang ở chặng nào |
| Thiếu hình ảnh | Không có hình minh họa nào | Trạng thái rỗng dùng `Empty.PRESENTED_IMAGE_SIMPLE`; trang đăng nhập chỉ có chữ |
| Trạng thái khó phân biệt | Nhãn "Chờ duyệt" là chữ xám xanh trên nền xám | Phân biệt bằng màu nhạt, không có biểu tượng |

## 3. Hướng thiết kế

Lấy hình ảnh từ chính công việc mua hàng: chứng từ giấy, con dấu duyệt, thùng hàng, cán cân so sánh.

- **Dải mực**: thanh điều hướng và đầu trang cùng một màu mực xanh đậm, tạo thành khung chữ L. Đầu trang giữ tiêu đề và hành động chính.
- **Xếp chồng**: khối đầu tiên của mỗi trang đè lên dải mực 56px. Chứng từ và việc cần quyết định là "phiếu" có bóng và hai tờ lót phía sau.
- **Dòng chảy mua hàng**: sáu trạm với số chứng từ đang dừng ở mỗi trạm, đặt ngay đầu trang Tổng quan. Trạm đang chờ người đăng nhập được tô màu hổ phách. Mỗi chứng từ có "Hành trình chứng từ" cho biết nó đã qua và sẽ tới những chặng nào.
- **Con dấu**: khi quản lý bấm Duyệt, dấu tròn đỏ "ĐÃ DUYỆT" đóng xuống tờ trình. Đây là chuyển động duy nhất được nhấn mạnh trong toàn ứng dụng.

## 4. Nguyên tắc và nguồn

| Nguyên tắc | Áp dụng | Nguồn |
|---|---|---|
| Vùng chung: phần tử cùng một khung được hiểu là một nhóm | Khay và phiếu thay cho nét kẻ | Laws of UX, Law of Common Region |
| Càng gần đích càng muốn hoàn thành | Dòng chảy sáu trạm, hành trình chứng từ | Laws of UX, Goal-Gradient Effect |
| Thứ khác biệt được nhớ nhất | Chỉ một màu nhấn cho việc đang chờ; chỉ một chuyển động là con dấu | Laws of UX, Von Restorff Effect; hướng dẫn frontend-design của Anthropic |
| Chữ đạt 4,5:1; trạng thái không chỉ dựa vào màu | Bảng màu mới; nhãn trạng thái luôn có biểu tượng và chữ | WCAG 2.2; Vercel Web Interface Guidelines |
| Số so sánh phải thẳng cột | `font-variant-numeric: tabular-nums` cho tiền và số lượng | Vercel Web Interface Guidelines |
| Bóng hai lớp; bo góc con không lớn hơn cha | Phiếu bo 6 với ô nhập bo 6; khay bo 14 với nút bo 10 | Vercel Web Interface Guidelines; Refactoring UI |
| Tránh dấu hiệu "AI làm": nhãn in hoa giãn chữ, chuỗi nối bằng dấu chấm giữa, mũi tên sau chữ nút, thẻ bo tròn giống hệt nhau | Bỏ nhãn "TỔNG QUAN", "WORKSPACE"; bỏ "A · B · C"; bỏ mũi tên; ba loại bề mặt có vai trò khác nhau | Hướng dẫn frontend-design của Anthropic |
| Thứ tự trang tổng quan: số chính, xu hướng, chi tiết, bảng | Bố cục trang Tổng quan | Tổng hợp từ Fusioncharts, Elastic (nguồn nhà cung cấp, tham khảo) |
| Trạng thái rỗng phải chỉ ra bước tiếp theo | Ba mẫu trạng thái rỗng có hình và nút | Nielsen Norman Group |

## 5. Token

**Màu** (sáu màu có tên, hai nền):

| Tên | Mã | Vai trò | Tương phản |
|---|---|---|---|
| Mực | `#0E2A33` | Chữ chính, thanh điều hướng, đầu trang | Chữ trắng trên mực: trên 14:1 |
| Ngọc | `#0B7A69` | Hành động chính, hoàn tất | Trắng trên ngọc: 5,2:1 |
| Kraft | `#C79A5B` | Hàng hóa, hình minh họa | Không dùng cho chữ |
| Hổ phách | `#8A4B08` trên `#FBEBCB` | Đang chờ người quyết định | 5,8:1 |
| Lam | `#1F4E8C` trên `#DDE8F7` | Đang thực hiện | 6,6:1 |
| Son | `#B4232A` | Con dấu, từ chối, lỗi | Trên trắng: 6,5:1 |
| Mặt bàn | `#E9EEEC` | Nền trang | |
| Giấy | `#FFFFFF` | Khay và phiếu | |

Chữ phụ: `#4A6068` (6,6:1 trên trắng, 5,6:1 trên mặt bàn). Viền: `#D5DEDB`, viền ô nhập `#9FB0B5`. Trên mực: chữ phụ `#C4D6DA`, nhấn `#5CC7B2`, nền nổi `#173B46`, nét `#2A4E59`.

**Chữ**: Bitter 600 cho tiêu đề trang (32 đến 38), tên chứng từ (24) và con số chính (30). Be Vietnam Pro cho mọi thứ còn lại: 17/600 tiêu đề khối, 15/600 tên dòng, 14 nội dung, 13 chú thích. Không dùng cỡ dưới 12.

**Bề mặt**:

| Lớp | Hình dạng | Dùng cho |
|---|---|---|
| Dải mực | Nền `#0E2A33` | Điều hướng, đầu trang |
| Khay | Trắng, viền 1px, bo 14, không bóng | Bảng, biểu đồ, danh sách |
| Khay nổi | Như khay, thêm bóng hai lớp | Khối đầu tiên đè lên dải mực |
| Phiếu | Trắng, bo 6, bóng hai lớp, hai tờ lót | Chứng từ, việc cần quyết định, đăng nhập |

Bóng: `0 1px 2px rgba(14,42,51,.10), 0 14px 28px -14px rgba(14,42,51,.26)`. Vùng bấm tối thiểu 44px.

## 6. Thành phần dùng chung

| Thành phần | Thay cho | Ghi chú |
|---|---|---|
| `PageBand` | `PageTitle` | Tiêu đề, mô tả, hành động hoặc tab dạng viên trên nền mực |
| `Tray`, `Sheet` | `Section` | Hai loại bề mặt ở mục 5 |
| `StatusChip` | `Status` | Năm nhóm: chờ (hổ phách), đang làm (lam), xong (ngọc), từ chối (son), nháp (xám); luôn có biểu tượng |
| `Seal` | (mới) | Dấu tròn "ĐÃ DUYỆT", dấu chữ nhật "TỪ CHỐI"; tắt chuyển động khi máy bật giảm chuyển động |
| `GoodsTile` | (mới) | Ô kraft 44px với biểu tượng theo loại hàng (giấy, mực, bút, bìa, băng keo, kẹp, giấy note; mặc định là thùng hàng) |
| `SupplierAvatar` | (mới) | Hình tròn với hai chữ cái đầu của tên riêng nhà cung cấp |
| `StockGauge` | Cột số trong bảng tồn kho | Thanh tồn kho có vạch mức tối thiểu |
| `FlowRail` | Hàng ba số ở Tổng quan | Sáu trạm; đếm từ dữ liệu bootstrap sẵn có |
| `Journey` | (mới) | Hành trình của một chứng từ, dùng trong phiếu đơn mua và tờ trình |
| `EmptyState` | `Empty` của Ant Design | Hình minh họa, một câu, một nút |

## 7. Từng màn hình

- **Thanh điều hướng**: chia ba nhóm. "Quy trình mua" gồm bốn mục nối bằng một nét dọc theo đúng thứ tự công việc, có số đếm việc đang chờ. Người đăng nhập hiện ở cuối thanh.
- **Tổng quan**: tiêu đề nói thẳng việc đang chờ người đăng nhập (ví dụ "Hai nhu cầu mua đang chờ bạn duyệt"), kèm hình minh họa. Dưới đó là Dòng chảy mua hàng, phiếu "Việc chờ bạn", ba số chính, hai biểu đồ, hàng cần bổ sung. Biểu đồ chi tiêu khi mới có một tháng thì hiện một cột và nói rõ lý do, thay vì một chấm trên trục trống.
- **Phê duyệt**: danh sách bên trái, tờ trình bên phải. Tờ trình có thêm khối "Đối chiếu tồn kho" đặt số lượng đề nghị cạnh tồn hiện tại và mức tối thiểu, để quản lý thấy ngay một đề nghị bất thường (ví dụ 1.000 cuộn băng keo khi mức tối thiểu là 50).
- **So sánh AHP**: bốn bước ở đầu trang; phiếu "Nhà cung cấp dẫn đầu" với cán cân; xếp hạng có hai thanh (điểm AHP và tỷ lệ đứng đầu khi mô phỏng); ma trận so sánh cặp tô đậm theo mức hơn; thước đo CR so với ngưỡng 0,10; bảng báo giá tô xanh giá trị tốt nhất mỗi cột.
- **Đơn mua và nhập kho**: mỗi đơn là một khối có thanh tiến độ nhận hàng và nhãn thư (chưa gửi, đã gửi lúc nào). Phiếu đơn mua bên phải có tiến độ từng dòng, tổng tiền, nút "Gửi PO kèm PDF", và Hành trình chứng từ.
- **Tồn kho và dự báo**: dải tóm tắt với hình kệ hàng có một ô trống; mỗi mặt hàng một dòng với ô kraft, thanh tồn kho có vạch tối thiểu, nhãn "Đủ hàng" hoặc "Dưới mức tối thiểu". Hàng thiếu xếp lên đầu.
- **Đăng nhập**: nửa trái là hình minh họa lớn và câu "Mỗi quyết định mua đều có căn cứ."; nửa phải là phiếu đăng nhập.
- **Yêu cầu và báo giá, Danh mục, Nhật ký, Tài khoản**: nhận khung mới (dải mực, khay, nhãn trạng thái, cỡ chữ, ô kraft) và trạng thái rỗng có hình. Nội dung và thao tác giữ nguyên.

## 8. Hình minh họa

Vẽ bằng SVG ngay trong mã: không cần mạng, không vướng bản quyền, nhẹ, đổi màu theo token. Một phong cách: hình phẳng, màu kraft cho hàng, trắng cho giấy, ngọc cho điểm nhấn, son cho con dấu.

Danh sách: cảnh bàn làm việc (Tổng quan), cảnh lớn (Đăng nhập), cán cân (AHP), kệ hàng (Tồn kho), ba hình trạng thái rỗng (khay trống, phong bì, thùng mở), bảy biểu tượng loại hàng.

## 9. Lộ trình triển khai

Mỗi đợt kết thúc bằng: build, chạy test, đi qua 9 màn hình với 5 vai trò bằng trình duyệt, chụp ảnh trước và sau, commit.

| Đợt | Nội dung | File chính |
|---|---|---|
| U1 Nền tảng | Token trong theme Ant Design và biến CSS; một bộ chữ; thanh điều hướng theo nhóm; `PageBand`, `Tray`, `Sheet`, `StatusChip`; bỏ mọi cỡ chữ dưới 12 | `main.tsx`, `styles.css`, `App.tsx`, `components.tsx` |
| U2 Tổng quan | `FlowRail` (hàm đếm trong `logic.ts`, có test), "Việc chờ bạn" theo vai trò, số chính, biểu đồ | `Dashboard.tsx`, `logic.ts` |
| U3 Chứng từ | Phê duyệt hai cột với `Seal` và đối chiếu tồn kho; danh sách và phiếu đơn mua với `Journey` | `Approvals.tsx`, `Orders.tsx`, `Procurement.tsx` |
| U4 AHP và tồn kho | Phiếu kết quả, ma trận tô đậm, thước CR, `StockGauge`, `GoodsTile` | `Ahp.tsx`, `Inventory.tsx`, `Catalog.tsx` |
| U5 Hình ảnh và hoàn thiện | Hình minh họa, `EmptyState`, đăng nhập, kiểm tra điện thoại 390px, bàn phím, giảm chuyển động | `App.tsx`, file mới `illustrations.tsx` |

Không cần đổi API: mọi số trong bản vẽ đều tính được từ dữ liệu bootstrap hiện có.

**Một quyết định cần chủ dự án**: phông chữ hiện tải từ Google Fonts nên cần mạng lúc demo. Đóng gói phông vào ứng dụng (`@fontsource/be-vietnam-pro`, `@fontsource/bitter`) thì chạy được khi mất mạng, đổi lại thêm hai gói phụ thuộc.

## 10. Tiêu chí nghiệm thu

- Không còn chữ nào dưới 12px; chữ thường đạt tương phản từ 4,5:1 (đo bằng script trên 9 màn hình).
- Mọi nhãn trạng thái có biểu tượng và chữ.
- Tab qua được mọi nút và ô nhập, viền focus nhìn thấy rõ.
- Ở bề ngang 390px không có thanh cuộn ngang.
- Bật "giảm chuyển động" thì con dấu hiện ngay, không chạy hiệu ứng.
- 11 test web hiện có và test mới của `logic.ts` đều đạt; 120 kiểm tra API của `scripts/qa` không đổi kết quả.

## 11. Giới hạn của bản vẽ

Bản vẽ được viết tay và chưa được dựng thử để soi lại từng điểm ảnh, nên có thể còn chỗ lệch nhỏ. Bản vẽ có năm màn hình chính; bốn màn hình còn lại theo mục 7.

## 13. Kết quả triển khai (12/10/2026)

Đã kiểm tra trên bản build thật: 10 màn hình với 5 vai trò ở 1440px, và các vai trò thu mua, quản lý, kho ở 390px. Không màn hình nào cuộn ngang, không còn chữ dưới 12px, không còn chữ dưới ngưỡng tương phản (đo bằng script trên kiểu đã tính của trình duyệt), không có lỗi console. Thao tác duyệt, gửi PO và mở phiếu nhận hàng được chạy thử trên một bản demo riêng. Test: web 12, API 124 (8 bài cần PostgreSQL thật không chạy trong lượt này vì không đổi mã CSDL).

Khác bản vẽ, có chủ ý:

- Trạm cuối của Dòng chảy mua hàng là "Đánh giá" (đơn đã nhận đủ, chờ đánh giá), không phải "Hoàn tất", để cả sáu trạm đều đếm việc đang chờ.
- Tab của trang là một công tắc nổi nằm đè lên mép dưới dải mực, bên trái, thay vì nằm bên phải tiêu đề.
- Tiêu đề phiếu tờ trình là tên các mặt hàng, không phải lý do đề nghị (lý do do người dùng gõ, có thể rất ngắn).
- Thanh điểm AHP vẽ theo thang tuyệt đối 0–100%.
- Biểu tượng điều hướng và trạm dùng bộ biểu tượng của Ant Design; biểu tượng loại hàng và hình minh họa là SVG tự vẽ trong `apps/web/src/illustrations.tsx`.
- Phông chữ được đóng gói cùng ứng dụng (`@fontsource/be-vietnam-pro`, `@fontsource/bitter`).

Thêm so với bản vẽ:

- Khối "Đối chiếu tồn kho" nêu rõ khi số lượng đề nghị từ 3 lần mức tối thiểu trở lên (`LARGE_REQUEST_FACTOR` trong `Approvals.tsx`). Đây chỉ là lời nhắc, không chặn thao tác.
- Dữ liệu bootstrap có thêm `mailEnabled` để nhãn thư ghi đúng "Đã gửi thư" hay "Đã xếp gửi".
- Trên màn hình rộng từ 1200px, Phê duyệt và Đơn mua hiện danh sách và phiếu cạnh nhau; hẹp hơn thì phiếu mở trong ngăn kéo như trước.

Chưa làm: viết lại các script thao tác giao diện của đợt QA trước (`scratchpad`, không nằm trong repo) theo cấu trúc trang mới.

### Kiểm tra cho trình đọc màn hình (12/10/2026)

Cách kiểm tra: đọc cây trợ năng của trình duyệt (thứ trình đọc màn hình nhận được) trên các màn hình chính, chạy axe-core 4.14 trên 9 màn hình, trang đăng nhập và hộp thoại tạo yêu cầu, và đi bằng phím Tab. Chưa có ai nghe thử bằng NVDA hay Narrator.

Đã sửa:

- Biểu tượng trang trí không còn bị đọc bằng tên tiếng Anh ("bar-chart", "clock-circle"…).
- Trạng thái chỉ thể hiện bằng màu nay có chữ cho trình đọc: bước AHP và hành trình chứng từ ("Đã xong", "Đang làm", "Chưa tới"), ô tốt nhất trong bảng báo giá, hạng và hai loại phần trăm trong xếp hạng AHP.
- Nút trùng tên được phân biệt ("Tạo yêu cầu: Giấy A4 80gsm").
- Chuyển trang, chọn một tờ trình hay đơn mua, và quyết định duyệt đều được thông báo qua vùng `role="status"`; tiêu đề tab trình duyệt đổi theo trang.
- Trạm của Dòng chảy mua hàng đọc theo thứ tự tên, số, ghi chú.
- Nhóm điều hướng có tên; có nút "Bỏ qua điều hướng"; thanh điều hướng ẩn trên điện thoại không còn nhận Tab.
- Danh sách chứng từ, việc chờ và tồn kho là danh sách thật; cột thao tác có tiêu đề; biểu đồ có mô tả bằng chữ; nút đóng hộp thoại và nút "tab khác" có tên tiếng Việt.

Kết quả sau khi sửa: axe không còn lỗi nào trên 9 màn hình ở 1440px, trang đăng nhập và hộp thoại tạo yêu cầu; viền focus hiện ở mọi phần tử Tab tới.

Còn lại, do thư viện Ant Design: nút tăng giảm của ô số có nhãn tiếng Anh ("Increase Value"); khi các tab không vừa bề ngang (điện thoại), nút "tab khác" nằm trong vùng `tablist`, axe báo lỗi cấu trúc. Biểu đồ chỉ có mô tả tóm tắt, chưa đọc được từng điểm dữ liệu.

## 12. Nguồn tham khảo

- Anthropic, hướng dẫn frontend-design: https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design
- Vercel, Web Interface Guidelines: https://vercel.com/design/guidelines
- Laws of UX: https://lawsofux.com/
- Nielsen Norman Group, Designing Empty States in Complex Applications: https://www.nngroup.com/articles/empty-state-interface-design/
- Refactoring UI (qua các bản tóm tắt của bên thứ ba, chưa đối chiếu với sách gốc)
- Fusioncharts, Dashboard Design Best Practices: https://www.fusioncharts.com/blog/dashboard-design-best-practices/
- WCAG 2.2, tiêu chí 1.4.3 và 1.4.11
