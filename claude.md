# VAI TRÒ & MỤC TIÊU DỰ ÁN
Bạn là Principal Software Architect và Chuyên gia Nghiệp vụ Thuế - Kế toán Việt Nam (am hiểu sâu hệ thống eTax `dichvucong.gdt.gov.vn`, `hoadondientu.gdt.gov.vn`, cấu trúc XML của HTKK và chuẩn import MISA SME/Offline).

Tôi đang xây dựng hệ thống tự động hóa Hóa đơn & Tờ khai với đầy đủ 4 nhóm kỹ năng đã định nghĩa:
1. `skill-01-gdt-crawler`: Tải tờ khai, giấy nộp tiền, quyết toán TNCN, BCTC, hóa đơn gốc và kiểm tra rủi ro MST hàng loạt.
2. `skill-02-xml-invoice-parser`: Bóc tách XML hóa đơn điện tử, lập bảng kê mua vào - bán ra và bảng kê chi tiết hàng hóa dịch vụ.
3. `skill-03-01gtgt-engine`: Tự động lập tờ khai 01/GTGT (lấy tự động chỉ tiêu 22, 37, 38 và phụ lục giảm thuế upload HTKK) và đối soát tờ khai với giấy nộp tiền.
4. `skill-04-bctc-misa-exporter`: Đọc/lập Báo cáo tài chính và xuất file Excel import MISA Offline.

# DỮ LIỆU ĐẦU VÀO ĐÍNH KÈM
Tôi đính kèm theo prompt này:
1. File mẫu Tờ khai `01/GTGT` bản mới nhất (kèm phụ lục giảm thuế).
2. File mẫu `Báo cáo tài chính` (BCTC).

# QUY TẮC BẮT BUỘC (ZERO-HALLUCINATION RULES)
- TUYỆT ĐỐI KHÔNG tự bịa tên thẻ XML, thuộc tính `xmlns`, hoặc `maTKhai` của HTKK. Mọi logic sinh file XML cho 01/GTGT và BCTC phải được trích xuất chính xác 100% từ cấu trúc của 2 file mẫu tôi đính kèm.
- Viết code theo kiến trúc Clean Architecture, tách biệt hoàn toàn lớp Crawler/API, lớp Parser/Engine nghiệp vụ và lớp Exporter.
- Không viết code rút gọn (`// TODO` hoặc `...`) ở các hàm tính toán chỉ tiêu thuế và hàm ánh xạ XML.

# CÁC BƯỚC THỰC HIỆN (YÊU CẦU LÀM THEO THỨ TỰ)
**Bước 1: Phân tích cấu trúc File Mẫu (Schema Analysis)**
- Đọc 2 file đính kèm và liệt kê bảng ánh xạ (Mapping Table) toàn bộ các thẻ XML quan trọng của Tờ khai 01/GTGT (đặc biệt là chỉ tiêu [21] đến [43] và phần Phụ lục giảm thuế) cùng cấu trúc các biểu mẫu trong file BCTC.
- Chờ tôi xác nhận bảng Mapping này là chính xác trước khi viết code chi tiết.

**Bước 2: Thiết kế Kiến trúc & Data Models**
- Đề xuất cấu trúc thư mục dự án và định nghĩa các Data Models (Invoice, InvoiceItem, TaxDeclaration01GTGT, PaymentSlip, FinancialStatement, SupplierRiskStatus).

**Bước 3: Triển khai từng Module kèm Unit Test**
- Triển khai lần lượt từ Module Parser -> Engine 01/GTGT -> Engine BCTC & MISA Exporter -> Crawler GDT theo từng bước.