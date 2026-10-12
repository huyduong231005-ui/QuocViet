# Nâng cấp web QuocViet sau CSDL

Ngày 11/10/2026. Người dùng đã cho phép tiếp tục hoàn thiện web và chủ động sáng tạo; CSDL được ưu tiên hoàn tất trước. Tài liệu này xác định hướng nâng cấp trong phạm vi dự án nhập hàng, không mở sang kế toán/ERP hoặc tự bật Agent.

## Mục tiêu

Web phục vụ một quy trình nhập hàng dùng được với dữ liệu thật: danh mục → nhu cầu nhiều mặt hàng → duyệt → báo giá → lựa chọn bằng AHP → PO → nhập từng đợt → theo dõi kho → đánh giá NCC. Mỗi màn hình chỉ rõ việc cần làm tiếp, phản hồi thao tác và lý do bị chặn. Người dùng không cần hiểu tên bảng, khóa ngoại hay cấu hình kỹ thuật để vận hành.

Chọn văn phòng phẩm và vật tư tiêu hao doanh nghiệp làm nhóm tham chiếu theo quyền lựa chọn người dùng đã giao: giấy, bút, bìa hồ sơ, mực in, băng keo. Đây là nội dung ví dụ/tài liệu và dữ liệu kiểm thử riêng; không tự điền vào QuocViet thật. Hệ thống không khóa vào ngành này. Không đặt giá hay tồn kho ngoài thị trường thành dữ liệu thật của người dùng.

Đối chiếu nhóm hàng với [danh mục và nhãn hàng văn phòng của Thiên Long](https://www.thienlonggroup.com/page/hoi-dap). Nguồn chỉ hỗ trợ chọn nhóm sản phẩm quen thuộc, không dùng để khẳng định thị phần, giá mua hay xếp hạng nhà cung cấp.

## Trải nghiệm và hình thức

Định hướng thị giác: workspace sáng, chữ rõ, navy định hướng và teal cho thao tác chính, mật độ thông tin đủ để làm việc nhưng có khoảng trống giữa các nhóm. Bố cục mỗi trang gồm tiêu đề và việc cần làm, bộ lọc, bảng/chứng từ, rồi drawer chi tiết khi cần. Chuyển động chỉ phục vụ mở/đóng drawer, phản hồi thao tác và thu gọn điều hướng; tôn trọng reduced motion, không thêm hiệu ứng trang trí vào dữ liệu nghiệp vụ.

Giữ nền React/Ant Design, màu navy và teal, chữ Việt rõ ràng. Nâng cấu trúc thông tin và khoảng cách, không làm trang quảng cáo. Sidebar gọn, tiêu đề trang cụ thể, bảng có tìm kiếm/bộ lọc/trạng thái, thao tác chính rõ, drawer xem chứng từ và số liệu theo từng dòng. Responsive trên điện thoại, focus bàn phím, nhãn biểu mẫu, tương phản và reduced motion được kiểm tra.

Tên doanh nghiệp QuocViet xuất hiện trong workspace; không đổi ngầm danh tính nhà cung cấp hoặc thông tin pháp lý. Đăng nhập chế độ thật để trống mật khẩu và không hiển thị tài khoản demo. Chế độ demo được đánh dấu rõ khi thực sự bật. Thông báo dashboard phản ánh dữ liệu thật; trạng thái trống hướng dẫn thêm danh mục/tạo yêu cầu, không vẽ số liệu giả.

## Phần cần hoàn thiện

1. **Đăng nhập và tài khoản:** phân quyền 5 vai trò hiện có, màn hình admin tạo/cập nhật vai trò/khóa tài khoản/đổi mật khẩu, kiểm tra quyền tại backend. Không tự đăng ký công khai. Không log/đưa password hash hoặc mật khẩu vào bootstrap. Không khóa/xóa admin cuối cùng đang hoạt động. Token của tài khoản bị khóa hoặc đổi quyền phải hết hiệu lực ngay ở lần gọi tiếp.
2. **Danh mục:** tìm kiếm SKU/tên, lọc NCC hoạt động, thông tin giá rõ trước VAT, form có kiểm tra lỗi và giải thích tồn đầu. Cấm sửa tồn bằng ô tùy ý; xem lịch sử nhập và số dư liên quan. Xuất mẫu/CSV có hướng dẫn, nếu mở import thì bắt buộc preview + validation + commit transaction; không coi import chưa làm là chức năng đã có.
3. **Nhu cầu và phê duyệt:** form nhiều dòng với sản phẩm/số lượng, chống trùng/lỗi, một nhu cầu có một quyết định gate1. Hộp thư quản lý xem đủ nội dung, chọn NCC ở gate2 và giải thích khi chọn khác đề xuất. Giữ kiểm tra quyền/trạng thái bên server.
4. **Báo giá và AHP:** mỗi RFQ xét một dòng nhu cầu/một mặt hàng. Nhu cầu nhiều dòng có nhiều RFQ độc lập, không cộng điểm AHP giữa sản phẩm khác đơn vị. Màn hình cho biết còn thiếu báo giá nào, báo giá hết hạn, CR và lý do không thể gửi duyệt. Ma trận/cây tiêu chí, ranking, Monte Carlo và độ nhạy dùng kết quả backend. Snapshot có thể xem lại theo phiên.
5. **PO và nhập kho:** tạo PO từ một hoặc nhiều phiên đã duyệt có cùng NCC; mỗi dòng có snapshot riêng, không đặt trùng RFQ. Form nhận nhiều dòng, nhập một phần, số giao và số đạt rõ, chống retry lặp bằng khóa giữ nguyên. Bảng PO dùng số dòng và tiến độ từng dòng thay vì cộng các đơn vị khác nhau thành một con số gây hiểu nhầm. Không sửa điều khoản PO sau tạo.
6. **Kho và đánh giá:** xem số dư, tồn tối thiểu, dự báo có giải thích nguồn, biến động tồn đầu/nhập hàng có chứng từ và người thực hiện. Đánh giá NCC sau nhận đủ PO; PO một dòng giữ công thức cũ. Với nhiều dòng, acceptance_score là trung bình tỷ lệ đạt từng dòng theo giá trị dòng trước thuế để tránh cộng số lượng khác đơn vị; đánh giá chất lượng/dịch vụ chung của PO và điểm giao được giải thích. Ghi nhận rõ cách tính trong báo cáo.
7. **Báo cáo và nhật ký:** Excel/PDF tiếng Việt dễ đọc, tên hàng/NCC thay vì chỉ UUID, số tiền/đơn vị/VAT, nhiều dòng, ngày tạo và phạm vi báo cáo. Nhật ký có lọc hành động/ngày/người, truy về chứng từ và không lộ dữ liệu đăng nhập. Export có trạng thái loading/error và kiểm tra quyền.

## Hợp đồng nhiều dòng

Quyền giữ rõ theo năm vai trò: admin quản trị tài khoản và toàn bộ nghiệp vụ; buyer quản lý danh mục, tạo nhu cầu/RFQ/báo giá/AHP/PO và đánh giá; manager tạo nhu cầu và quyết định hai điểm duyệt; warehouse tạo phiếu nhận; auditor chỉ đọc. Cả năm vai trò được đọc chứng từ, kho, nhật ký và xuất báo cáo giống quyền đọc hiện có. Không vai trò nào dùng quyền đọc để ghi. API quản lý tài khoản chỉ dành cho admin; Agent vẫn tắt.

Dự báo hiện dùng lịch sử được cung cấp, hoặc tồn tối thiểu khi chưa có lịch sử đủ dùng; giao diện ghi đúng nguồn và khoảng dữ liệu. Phiếu nhập là hàng đi vào kho, không tự coi là nhu cầu tiêu thụ để tạo dự báo. Giá trị tồn dựa trên giá danh mục là ước tính và được ghi rõ. Màn hình kho/chứng từ đọc từ số dư và ledger thật.

Giữ đầu vào một dòng đang có như đường tương thích. API mới hỗ trợ requests.items, orders.sessionIds và receipts.items theo danh sách dòng. RFQ mới chọn requestLineId; nếu yêu cầu một dòng vẫn hiểu requestId như trước. Khi đọc, trả items có ID riêng và số liệu từng dòng; trường một dòng cũ chỉ áp dụng khi có đúng một dòng. UI/report mới luôn dùng items, không âm thầm lấy dòng đầu của chứng từ nhiều dòng.

Mọi dòng được validate trước khi ghi; chứng từ nhiều dòng tạo trong một transaction. Sort dòng khi chuẩn hóa payload idempotency và lấy khóa theo ID; cùng nội dung đổi thứ tự không được cộng tồn lại. Giới hạn số dòng phù hợp, báo lỗi đúng vị trí, và không cho một receipt chứa dòng của PO khác. Mọi sửa đổi schema cho phần này dùng migration tiếp theo, không sửa migration đã áp dụng.

Phiếu nhận khóa PO rồi các dòng theo ID; khi ghi ledger, sắp xếp toàn cục theo productId rồi receiptLineId để hai PO cùng có nhiều sản phẩm không khóa số dư theo thứ tự ngược nhau. Kiểm thử PostgreSQL với hai pool độc lập phải bao phủ tình huống thứ tự dòng trái ngược.

Tổng PO là tổng số tiền đã VAT được làm tròn theo từng dòng bằng công thức VND hiện có. Cộng và kiểm tra bằng BigInt/SQL numeric; từ chối toàn bộ PO nếu tổng vượt Number.MAX_SAFE_INTEGER, dù từng dòng riêng lẻ hợp lệ. Không đổi ngầm biểu diễn tiền của API.

Với đánh giá nhiều dòng, trọng số dòng là số lượng đặt × đơn giá trước VAT. Điểm đạt = 100 × tổng(số đạt × đơn giá) / tổng(số đặt × đơn giá). Điểm giao từng dòng dùng ngày nhận cuối của chính dòng đó, ngày hẹn = ngày tạo PO + deliveryDays của dòng, và công thức hiện có max(1, 100 − 10 × ceil(số ngày trễ)); không trễ được 100. Điểm giao PO là trung bình điểm giao dòng theo cùng trọng số trước VAT. Tất cả đơn giá và số lượng đặt đều dương, nên mẫu số luôn dương. Tính tổng/trọng số với giới hạn tiền an toàn và làm tròn điểm ở độ chính xác được ghi rõ trong kiểm thử; giao diện giải thích từng dòng. qualityScore = (chất lượng do người dùng chấm + điểm đạt) / 2; overallScore giữ 0,5 chất lượng + 0,3 giao hàng + 0,2 dịch vụ. Một PO nhiều dòng có một đánh giá chung và product_id NULL qua migration mới; PO một dòng giữ product_id và công thức cũ, không gắn đánh giá nhiều dòng vào sản phẩm đầu tiên.

## Chất lượng cần chứng minh

- Một luồng ít nhất hai sản phẩm chạy từ nhu cầu đến nhận từng phần và đánh giá, có hai điểm duyệt và báo cáo đúng số dòng/tổng tiền.
- Mỗi vai trò đúng quyền; admin cuối cùng được bảo vệ; không demo credentials ở chế độ thật; không rò hash/token/password qua API, log hoặc export.
- Browser kiểm tra desktop và mobile: đăng nhập, tạo danh mục, form nhiều dòng, phê duyệt, AHP, PO/receipt, tìm kiếm và trạng thái trống/lỗi/loading.
- Kiểm thử nghiệp vụ/API/SQL, build, kiểm thử native concurrency của CSDL tiếp tục đạt sau nâng cấp web.
- Các truy vấn lọc chính dùng SQL có điều kiện; không hứa khả năng hàng triệu bản ghi khi bootstrap còn trả toàn danh sách. Phân trang server được triển khai khi đổi các trang danh sách, và nêu giới hạn thực tế trong bàn giao.
- QuocViet thật không bị đổ dữ liệu minh họa. Các luồng test chạy ở database riêng; việc vận hành thật bắt đầu từ danh mục do người dùng nhập.

Agent để sau. Gửi email thật, LLM trả phí, triển khai public và dịch vụ ngoài chưa cấu hình không được hiển thị như đã hoạt động. Người dùng đã cho phép cải tiến local; các hành động với tài khoản/dịch vụ ngoài cần thông tin/ủy quyền cụ thể khi đến bước đó.
