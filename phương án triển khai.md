Kế hoạch triển khai kỹ thuật (Technical Plan)
Để tải dữ liệu tự động từ cổng Thuế điện tử (thuedientu.gdt.gov.vn / dichvucong.gdt.gov.vn), kết xuất hóa đơn XML và tự động lập hồ sơ thuế, phương án triển khai chia làm 4 giai đoạn cụ thể:

Giai đoạn 1: Thu thập dữ liệu từ Cổng Thuế điện tử
Cơ chế xác thực:

Đăng nhập tự động bằng tài khoản thuế doanh nghiệp (MST + mật khẩu).

Giải quyết Captcha bằng mô hình nhận diện ký tự (OCR) hoặc dịch vụ giải captcha tự động.

Duy trì Session Cookie để phục vụ các yêu cầu tải tiếp theo.

Tự động hóa tra cứu & tải xuống (Crawler/API Automation):

Tờ khai & Quyết toán thuế (GTGT, TNDN, QTT TNCN): Gửi truy vấn danh sách tờ khai đã nộp theo khoảng kỳ tính thuế, tải toàn bộ tệp định dạng .xml và thông báo chấp nhận của cơ quan thuế.

Báo cáo tài chính (BCTC): Tải bộ BCTC gốc định dạng .xml (kèm bảng cân đối phát sinh, lưu chuyển tiền tệ, thuyết minh).

Giấy nộp tiền (GNT): Lấy danh sách chứng từ nộp thuế thành công, tải tệp .xml/.pdf để đối soát trạng thái nợ thuế/hoàn thành nghĩa vụ.

Giai đoạn 2: Lấy và chuẩn hóa dữ liệu Hóa đơn điện tử (XML)
Kết nối hệ thống Hóa đơn điện tử (hoadondientu.gdt.gov.vn):

Tải danh sách hóa đơn mua vào và bán ra theo khoảng thời gian.

Tải đồng loạt các file gốc .xml của từng hóa đơn.

Bóc tách và lưu trữ dữ liệu:

Xây dựng module Parser phân tích cấu trúc thẻ XML hóa đơn điện tử chuẩn của Tổng cục Thuế (Thông tư 78/2021/TT-BTC).

Trích xuất các trường: Tên/MST người bán - người mua, ký hiệu, số hóa đơn, ngày lập, nhóm thuế suất (0%, 5%, 8%, 10%, không chịu thuế), tiền hàng, tiền thuế.

Lưu vào cơ sở dữ liệu tạm thời để kiểm tra tính hợp lệ và trạng thái hoạt động của MST người bán.

Giai đoạn 3: Tự động lập Tờ khai 01/GTGT
Tổng hợp số liệu chỉ tiêu:

Chỉ tiêu [22] (Thuế GTGT còn được khấu trừ kỳ trước chuyển sang): Tự động bóc tách từ chỉ tiêu [43] của tờ khai kỳ trước liền kề đã tải ở Giai đoạn 1.

Chỉ tiêu [23], [24], [25] (Hàng hóa, dịch vụ mua vào & thuế được khấu trừ): Tự động gom nhóm từ tệp XML hóa đơn mua vào hợp lệ.

Chỉ tiêu [26] đến [35] (Hàng hóa, dịch vụ bán ra theo từng mức thuế suất): Phân bổ doanh thu và thuế GTGT từ tệp XML hóa đơn bán ra.

Chỉ tiêu [37], [38] (Điều chỉnh tăng/giảm): Bóc tách từ các tờ khai bổ sung (nếu có).

Phụ lục giảm thuế (Nghị quyết giảm 2% thuế GTGT): Lọc các mặt hàng chịu thuế suất 8% từ XML để kết xuất danh mục phụ lục.

Kết xuất dữ liệu đầu ra:

Xuất file XML chuẩn theo lược đồ XSD của phần mềm Hỗ trợ kê khai (HTKK) để người dùng có thể import trực tiếp vào HTKK hoặc ký số nộp qua mạng.

Giai đoạn 4: Lập Báo cáo tài chính & Xuất phần mềm kế toán
Định dạng dữ liệu BCTC:

Đối chiếu dữ liệu BCTC các năm trước từ cổng thuế để xác định số dư đầu kỳ.

Kết hợp sổ chi tiết doanh thu, chi phí từ nguồn hóa đơn XML để hỗ trợ lập bảng Cân đối phát sinh tài khoản.

Xuất file trung gian:

Tạo tệp Excel chuẩn mẫu import dành cho các phần mềm kế toán (như MISA SME/MISA Offline, Fast, Bravo).

Xuất bảng kê chi tiết mua vào - bán ra phục vụ lưu trữ nội bộ và thanh kiểm tra thuế

---

Cập nhật tiến độ (06/11/2026)

Trạng thái theo giai đoạn:
- Giai đoạn 1 (thu thập từ Cổng Thuế): đã làm phần đăng nhập, captcha, tìm kiếm theo cửa sổ 30 ngày, tải ZIP và đồng bộ gia tăng cho tờ khai (module dvc/, đã kiểm thử trên cổng giả lập). Chưa xác minh trên cổng thật. Chưa có tải BCTC và Giấy nộp tiền.
- Giai đoạn 2 (XML hóa đơn): skill-02 đã có quy tắc; chưa thấy module parser triển khai trong dự án.
- Giai đoạn 3 (tờ khai 01/GTGT): đã xác định mẫu TT80 (trước 07/2026) và TT89 (từ 07/2026), chưa có engine sinh chỉ tiêu tự động.
- Giai đoạn 4 (BCTC và xuất MISA): đã có ba bộ mẫu BCTC (TT99 phụ lục IV, TT133, workbook TT200) và đã phân loại vào classification.csv. Chưa ánh xạ chỉ tiêu và chưa xuất Excel MISA.

Nguồn mẫu BCTC bổ sung:
- Thư mục Báo cáo tài chính gồm 28 file docx (12 TT133, 16 TT99) và 1 workbook TT200.
- Chọn bộ mẫu theo chế độ kế toán của doanh nghiệp và kỳ lập; chi tiết trong skills/skill-04-bctc-misa-exporter/skill.md.
- Có 5 file trùng dung lượng trong TT133, chờ xác nhận trước khi xóa.

Việc tiếp theo, theo thứ tự:
1. Xác nhận hiệu lực TT99 cho kỳ lập và chọn chế độ kế toán chính thức.
2. Khảo sát endpoint tải BCTC và Giấy nộp tiền trên cổng thật, sau đó bổ sung vào dvc/.
3. Ánh xạ chỉ tiêu XML BCTC (nhóm F6) sang mẫu đã chọn.
4. Hoàn thiện engine 01/GTGT theo mẫu TT80 và TT89, rồi thêm phụ lục 142.

