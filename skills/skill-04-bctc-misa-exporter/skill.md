# Skill: Financial Statement (BCTC) & MISA Offline Exporter
## Mục tiêu
Xử lý dữ liệu Báo cáo tài chính theo mẫu XML đính kèm và kết xuất dữ liệu hóa đơn ra file Excel chuẩn import MISA Offline.

## Quy tắc triển khai
1. Xử lý Báo cáo tài chính (BCTC):
   - Phân tích file mẫu BCTC người dùng cung cấp để xác định chính xác chế độ kế toán (Thông tư 133 hoặc Thông tư 200) và toàn bộ mã chỉ tiêu XML.
   - Đọc BCTC kỳ trước tải từ cổng thuế để lấy số dư đầu kỳ.
   - Ánh xạ dữ liệu phát sinh từ hóa đơn và sổ kế toán vào Bảng cân đối tài khoản, Kết quả hoạt động kinh doanh và Lưu chuyển tiền tệ.
2. Kết xuất Excel Import MISA Offline:
   - Tạo template Excel chuẩn cấu trúc import của MISA (Chứng từ mua hàng, Chứng từ bán hàng).
   - Tự động điền các cột bắt buộc: Hình thức mua/bán, Ngày hạch toán, Ngày chứng từ, Số chứng từ, Số hóa đơn, Ngày hóa đơn, Ký hiệu, Mã khách hàng/NCC, Tên hàng, ĐVT, TK Nợ/TK Có mặc định, Số lượng, Đơn giá, Thành tiền, % Thuế GTGT, Tiền thuế GTGT, TK Thuế.

## Chọn mẫu Báo cáo tài chính theo chế độ kế toán
Thư mục `Báo cáo tài chính` gồm ba bộ mẫu. Chọn bộ theo chế độ kế toán của doanh nghiệp và kỳ lập báo cáo:

1. Thông tư 99 (phụ lục IV, 16 file docx trong `phụ lục IV TT99 mẫu báo cáo tài chính/`): đánh số mục 1 đến 13. Mục 1 đến 4 là báo cáo năm (BCTH tài chính đáp ứng và không đáp ứng giả định hoạt động liên tục, BCKQHĐKD, LCTT trực tiếp). Mục 6 và 10 là thuyết minh; mục 7 đến 13 là báo cáo giữa niên độ. Cần xác nhận hiệu lực của Thông tư 99 cho kỳ lập.
2. Thông tư 133 (12 file docx trong `TT133/`): B01-DN (dạng không đáp ứng và B01a-DN đáp ứng giả định), B02-DN, B03-DN (trực tiếp), B09-DN (hai dạng), cùng phụ lục 1-2 để tra tài khoản và chỉ tiêu. Dành cho doanh nghiệp nhỏ và vừa theo chế độ 133.
3. Thông tư 200 (`bctc-theo-tt200.xlsx`): workbook có công thức. Sheet TONGHOP tổng hợp số phát sinh theo tài khoản; CDSPS là bảng cân đối tài khoản; CDKT, KQHDKD, LCTT và TMBCTC là các báo cáo tương ứng. Ô AF1 sheet TONGHOP nhập tên công ty mẹ. Dùng làm mẫu công thức và đối chiếu, không coi là dữ liệu của doanh nghiệp.

Quy tắc:
- Không xóa file trùng dung lượng (5 file TT133 đuôi "(1)", "(2)") khi chưa được người dùng xác nhận.
- Số liệu kỳ trước lấy từ BCTC đã tải về từ cổng thuế (xem skill-01), không nhập tay.
- Khi ánh xạ chỉ tiêu XML (nhóm F6 trong `classification.csv`), đối chiếu mã chỉ tiêu với mẫu đúng bộ (TT99, TT133 hoặc TT200); không dùng chung mã giữa các bộ.

