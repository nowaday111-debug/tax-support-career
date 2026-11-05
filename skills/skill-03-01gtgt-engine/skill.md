# Skill: 01/GTGT Declaration & Reconciliation Engine
## Mục tiêu
Tự động tính toán và sinh file XML Tờ khai 01/GTGT kèm Phụ lục giảm thuế hợp lệ 100% khi import vào HTKK, đồng thời đối soát nghĩa vụ nộp thuế.

## Quy tắc nghiệp vụ cốt lõi
1. Tuân thủ tuyệt đối mẫu XML đính kèm:
   - KHÔNG tự ý đoán tên thẻ XML. Phải phân tích file mẫu `01_GTGT` do người dùng cung cấp để giữ nguyên Namespace, `xmlns`, `mst`, cấu trúc `<HSoThueDTu>` và `<CTieuTKhaiChinh>`.
2. Logic tính toán các chỉ tiêu:
   - Chỉ tiêu [22]: Trích xuất tự động từ chỉ tiêu [43] của tờ khai 01/GTGT kỳ trước liền kề.
   - Chỉ tiêu [23], [24], [25]: Tổng hợp từ hóa đơn mua vào hợp lệ (loại trừ hóa đơn của nhà cung cấp rủi ro/bỏ trốn nếu được cấu hình).
   - Chỉ tiêu [26] đến [35]: Phân bổ doanh thu và thuế GTGT đầu ra theo đúng nhóm thuế suất từ hóa đơn bán ra.
   - Chỉ tiêu [37], [38]: Tự động tổng hợp số chênh lệch từ các tờ khai bổ sung (KHBS) của các kỳ trước nộp trong kỳ hiện tại.
   - Phụ lục giảm thuế (PL 142 / NQ giảm thuế GTGT): Tự động lọc các dòng hàng hóa dịch vụ có thuế suất 8% để điền vào phần phụ lục giảm thuế đính kèm tờ khai.
3. Tra soát Tờ khai & Giấy nộp tiền:
   - Đối chiếu số thuế phát sinh phải nộp (Chỉ tiêu [40] trên tờ khai 01/GTGT, hoặc số phải nộp trên QTT TNCN/TNDN) với số tiền thực nộp trên Giấy nộp tiền (theo Mã chương, Mã tiểu mục, Kỳ thuế) để xuất báo cáo chênh lệch.

## Chọn mẫu 01/GTGT (cập nhật 06/11/2026)
- HTKK 5.8.2 chỉ có 01/GTGT TT80 trong menu: maTKhai 842, pbanTKhaiXML 2.8.3 (Project/Menu.xml). Mọi kỳ dùng mẫu này.
- 01/GTGT TT89 (309) đã có XSD nhưng HTKK chưa phát hành, chưa có maTKhai. Không dùng cho tới khi HTKK có mục menu.
- Cấu hình mẫu ở `src/config/htkkForms.js`; XSD kiểm tra ở `schemas/htkk/`.
- Doanh thu 8% ghi vào [32]/[33] (thuế thực tế), phần giảm kê ở `PLuc/PL_NQ142_GTGT`; quy tắc HTKK: [33] = [32] x 10% - [08].
- PL 142 chỉ lập khi có bán ra 8%.
- Mã nguồn: `src/engines/gtgt01/` (engine, selection, pl142, rules), exporter `src/exporters/htkk/gtgt01Tt80Xml.js`.
- Chi tiết: `docs/buoc-1-mapping.md`, `docs/buoc-2-kien-truc.md`.
