# Skill: E-Invoice XML Parser & Ledger Builder
## Mục tiêu
Bóc tách chính xác các thẻ XML hóa đơn điện tử (chuẩn Thông tư 78/2021/TT-BTC) thành cấu trúc dữ liệu chuẩn hóa.

## Quy tắc triển khai
1. Xử lý đa dạng cấu trúc XML:
   - Đọc dữ liệu từ các nhánh chuẩn `<DLHDon>`, `<NDHDon>`, `<NBan>`, `<NMua>`, `<DSHHDVu>`, `<TToan>`.
   - Xử lý an toàn các trường hợp thiếu thẻ, sai lệch kiểu dữ liệu (số thập phân, chuỗi rỗng) hoặc hóa đơn điều chỉnh/thay thế (`<TTHDLQuan>`).
2. Chuẩn hóa Bảng kê:
   - Tạo Bảng kê tổng hợp mua vào – bán ra (phân nhóm theo thuế suất: Không chịu thuế, 0%, 5%, 8%, 10%).
   - Tạo Bảng kê chi tiết hàng hóa, dịch vụ (bóc tách từng dòng `<HHDVu>`: mã hàng, tên hàng, ĐVT, số lượng, đơn giá, thành tiền, thuế suất, tiền thuế).
## Triển khai (06/11/2026)
- Mã nguồn: `src/parsers/invoiceXmlParser.js` (hóa đơn) và `src/parsers/ledgerBuilder.js` (bảng kê, CSV).
- Chỉ nhận gốc `<HDon>` theo TT78; gốc khác (`HoaDonDienTu`, `Invoice`) bị từ chối có lý do, không đoán.
- Tổng theo thuế suất lấy từ `TToan/THTTLTSuat/LTSuat`; thiếu thì cộng từ dòng hàng (TChat 3 mang dấu âm, TChat 4 bỏ qua) và cảnh báo.
- TSuat chuẩn hóa: 0/5/8/10, KCT, KKKNT, KHAC:x% (KHAC phải xử lý tay). Ngoại tệ quy đổi theo TGia.
- Đã chạy trên 72 hóa đơn thật: 69 đọc đúng (khớp đối chiếu độc lập), 3 bị từ chối do không phải TT78.
