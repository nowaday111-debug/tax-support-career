# Bước 2–3: Kiến trúc, data models và module 01/GTGT TT80

Lập ngày 06/11/2026 theo `claude.md`, sau khi xác nhận bước 1 (`docs/buoc-1-mapping.md`). Phạm vi đợt này: **tờ khai 01/GTGT mẫu TT80** (HTKK maTKhai 842, bản 2.8.3) và phụ lục giảm thuế PL 142. Phiên bản dự án: 0.3.0.

## 1. Cấu trúc thư mục

Theo Clean Architecture: lớp nghiệp vụ không phụ thuộc HTTP, file hay cổng thuế.

```
src/
├─ domain/                 Lõi nghiệp vụ, không phụ thuộc gì
│  ├─ models.js            Data models (JSDoc) + hằng số thuế suất, tính chất dòng hàng
│  ├─ money.js             Tiền VND số nguyên, làm tròn bằng BigInt, phân bổ phần dư lớn nhất
│  └─ period.js            Kỳ tháng/quý, chuỗi kỳ theo định dạng HTKK
├─ config/
│  └─ htkkForms.js         maTKhai, phiên bản, tên mẫu... lấy từ HTKK (Menu.xml + file kết xuất thật)
├─ infrastructure/
│  └─ xml/miniXml.js       Bộ đọc XML không cần thư viện (UTF-8/UTF-16, namespace, thực thể)
├─ parsers/                LỚP PARSER
│  ├─ invoiceXmlParser.js  Hóa đơn điện tử TT78 (<HDon>) -> Invoice
│  └─ ledgerBuilder.js     Bảng kê mua vào – bán ra, bảng kê chi tiết HHDV, xuất CSV
├─ engines/gtgt01/         LỚP ENGINE NGHIỆP VỤ
│  ├─ selection.js         Chọn hóa đơn của kỳ: chiều mua/bán, chống trùng, thay thế, ngoài kỳ
│  ├─ engine.js            Tính chỉ tiêu [21]–[43]
│  ├─ pl142.js             Phụ lục PL_NQ142_GTGT (NQ 142/174/204)
│  └─ rules.js             Quy tắc kiểm tra của HTKK (Y = chặn, N = cảnh báo)
├─ exporters/htkk/         LỚP EXPORTER
│  └─ gtgt01Tt80Xml.js     XML nhập HTKK theo XSD 01_GTGT_TT80_283
└─ index.js                Ghép Parser -> Engine -> Exporter
dvc/                       LỚP CRAWLER (có từ 0.2.0): đồng bộ tờ khai từ dichvucong.gdt.gov.vn
schemas/htkk/              Bản sao XSD chính thức của HTKK, dùng để kiểm thử
scripts/lap-01gtgt.js      Lệnh lập tờ khai từ thư mục hóa đơn
config/doanh-nghiep.example.json   Mẫu cấu hình người nộp thuế
test/                      Unit test (node:test), không cần thư viện ngoài
```

`server.js` (ứng dụng web dùng thử) gọi engine và exporter mới; phần tính cũ đã bỏ.

## 2. Data models (`src/domain/models.js`)

| Model | Nội dung chính |
|---|---|
| `Invoice` | khóa chống trùng `MST bán|KHMSHDon|KHHDon|SHDon`, mẫu số, ký hiệu, số, ngày lập, tiền tệ/tỷ giá, MCCQT, người bán/mua, `items`, `rateGroups` (tổng theo thuế suất), `totals`, `related` (thay thế/điều chỉnh), `warnings` |
| `InvoiceItem` | STT, tính chất `TChat` (1 hàng hóa, 2 khuyến mại, 3 chiết khấu, 4 ghi chú), mã, tên, ĐVT, số lượng, đơn giá, thành tiền, thuế suất |
| `TaxDeclaration01GTGT` | mẫu, kỳ, `ct` (chỉ tiêu), `pl142`, `checks`, nguồn số liệu từng chỉ tiêu |
| `PL142` | Mục I mua vào 8%, Mục II bán ra 8%, [06], [08], [09] |
| `PaymentSlip` | giấy nộp tiền: số, ngày, mã chương, tiểu mục, kỳ, số tiền (dùng ở bước đối soát) |
| `FinancialStatement` | chế độ (TT99/TT200/TT133), mẫu, năm, chỉ tiêu theo mã số (bước BCTC) |
| `SupplierRiskStatus` | MST, trạng thái trên cổng thuế, cờ rủi ro (bước kiểm tra MST hàng loạt) |

Tiền luôn là số nguyên VND; số lẻ trong hóa đơn được làm tròn nửa xa số 0 theo từng nhóm thuế suất của từng hóa đơn.

## 3. Parser hóa đơn

Đã đối chiếu với 72 hóa đơn thật trong `Desktop\hoa don` (36 nhà cung cấp, tháng 4–9/2026):

- 69 file `<HDon>` theo TT78: đọc được hết. Tổng theo thuế suất khớp 100% với kết quả đọc độc lập bằng Python.
- 3 file có gốc khác (`<HoaDonDienTu>`, `<Invoice>`): bị từ chối có lý do, không đoán cấu trúc.

Thuế suất gặp trong thực tế: 8%, 10%, KCT, KKKNT, và rỗng ở dòng ghi chú. Tính chất dòng gặp đủ 1, 2, 3, 4. Có hóa đơn ghi số lẻ (898148.15), hóa đơn bán hàng mẫu số 2 không có bảng thuế suất, và hóa đơn có thẻ `<TTHDLQuan/>` rỗng.

Tổng tiền của tờ khai lấy từ bảng tổng hợp theo thuế suất `THTTLTSuat` mà người bán đã chốt, không cộng lại từ dòng hàng. Nếu hóa đơn thiếu bảng này, parser cộng từ dòng hàng (chiết khấu mang dấu âm) và ghi cảnh báo.

## 4. Engine 01/GTGT TT80

| Chỉ tiêu | Cách lấy |
|---|---|
| [21] | Đánh dấu khi kỳ không có hóa đơn và không có số nhập tay |
| [22] | Nhập tay nếu có, nếu không lấy [43] kỳ trước (khác nhau thì cảnh báo N như HTKK) |
| [23], [24] | Mua vào: các nhóm 0/5/8/10% của hóa đơn GTGT (mẫu số 1). Nhóm KCT, KKKNT, hóa đơn bán hàng chỉ vào [23] khi bật `includeNoVatPurchasesIn23` |
| [25] | [24] trừ thuế của hóa đơn trong danh sách `nonDeductibleKeys` |
| [26] / [29] / [30]-[31] / [32]-[33] / [32a] | Bán ra KCT / 0% / 5% / **10% và 8%** / KKKNT |
| [23a], [24a], [37], [38], [39a], [40b], [42] | Nhập tay |
| Còn lại | Công thức: [27]=[29]+[30]+[32]+[32a]; [28]=[31]+[33]; [34]=[26]+[27]; [35]=[28]; [36]=[35]−[25]; X=[36]−[22]+[37]−[38]−[39a]; [40a]=X nếu X≥0; [40]=[40a]−[40b]; [41]=\|X\| nếu X<0; [43]=[41]−[42] |

Hàng 8% ghi vào [32]/[33] với số thuế thực tế trên hóa đơn; phần được giảm kê ở PL 142. Cách này khớp quy tắc HTKK "[33] = [32] × 10% − [08] trên PL NQ 142/2024/QH15", và đã thử với dữ liệu thật: lệch 0 đồng.

Chọn hóa đơn:

- Chống trùng theo khóa.
- Loại hóa đơn gốc khi có hóa đơn thay thế trong cùng bộ dữ liệu.
- Hóa đơn bán ra ngoài kỳ bị loại.
- Hóa đơn mua vào ngoài kỳ mặc định vẫn khấu trừ, kèm ghi chú (cấu hình `purchasesOutOfPeriod`).
- Hóa đơn có thuế suất KHAC bị loại để xử lý tay.

Mọi hóa đơn bị loại đều có lý do trong báo cáo.

PL 142 chỉ lập khi có bán ra 8% (giữ quyết định trước đây của dự án). Nhóm 8% của từng hóa đơn được phân bổ xuống các dòng hàng 8% theo thành tiền (dòng chiết khấu mang dấu âm), rồi gộp theo tên hàng. Nhờ vậy tổng phụ lục luôn khớp tờ khai.

## 5. Exporter XML HTKK

Sinh đúng thứ tự thẻ của XSD, với giá trị khung lấy từ HTKK: namespace, `maTKhai` 842, `pbanTKhaiXML` 2.8.3, `maDVu` HTKK. Không có đại lý thì bỏ thẻ `DLyThue`; không có phụ lục thì bỏ thẻ `PLuc`. Exporter từ chối xuất khi còn lỗi chặn (mức Y) hoặc thiếu thông tin bắt buộc.

Đã kiểm tra bằng XSD chính thức của HTKK (xmllint):

- File XML thật do HTKK kết xuất: hợp lệ (dùng để xác nhận cách kiểm tra là đúng).
- File do hệ thống sinh, cả có và không có PL 142, kỳ quý và kỳ tháng: hợp lệ.
- File sinh từ 66 hóa đơn mua vào thật và từ 2 hóa đơn bán ra thật có PL 142: hợp lệ.

## 6. Cách dùng

```
node scripts/lap-01gtgt.js --hoa-don "C:\Users\...\Desktop\hoa don" --ky 2026-Q3 --cau-hinh config/doanh-nghiep.json
```

Lệnh tạo trong `output/<MST>_<kỳ>/`:

- file XML để nhập vào HTKK (chỉ khi không còn lỗi chặn),
- `bang-ke-tong-hop.csv`, `bang-ke-chi-tiet.csv`,
- `bao-cao.json`: chỉ tiêu, phụ lục, kiểm tra, hóa đơn bị loại và lý do.

Trên ứng dụng web có thêm API `POST /api/periods/:id/invoices/import-xml` và `PATCH /api/companies/:id` (nhập địa chỉ, tỉnh, cơ quan thuế để xuất XML).

Chạy kiểm thử: `npm test` (41 bài; bài kiểm tra bằng XSD tự bỏ qua nếu máy chưa có xmllint).

## 7. Quyết định tự chọn (người dùng giao "tự làm")

| Vấn đề | Quyết định | Lý do |
|---|---|---|
| Mẫu 01/GTGT | Chỉ TT80 (842, 2.8.3) | HTKK 5.8.2 chưa có 01/GTGT TT89 |
| Doanh thu 8% | Vào [32]/[33], phần giảm ở PL 142 | Đúng quy tắc kiểm tra của HTKK |
| [23a], [24a], [39a], [40b], [42] | Nhập tay | Chưa có nguồn dữ liệu (tờ khai hải quan...) |
| Mua vào KCT/KKKNT, hóa đơn bán hàng | Không vào [23] (có tùy chọn bật) | Không có thuế GTGT đầu vào |
| Mua vào ngoài kỳ | Vẫn khấu trừ, có ghi chú | Thường gặp hóa đơn về muộn; có tùy chọn loại |
| `ID` dòng PL 142 | "1", "2", ... | XSD chỉ yêu cầu chuỗi; **chưa có file kết xuất thật để đối chiếu** |
| `pbanDVu` | 5.8.2 (bản HTKK trên máy) | File thật ghi theo bản HTKK lúc kết xuất |

## 8. Chưa làm / cần kiểm chứng

- Nhập thử file XML vào HTKK trên máy để xác nhận lần cuối (XSD đã hợp lệ).
- Hóa đơn điều chỉnh: đang cộng theo dấu ghi trên hóa đơn và có ghi chú để rà soát. Chưa có mẫu hóa đơn điều chỉnh thật.
- [37], [38] tự động từ tờ khai bổ sung (KHBS); XSD KHBS đã có trong `docs/mapping/xsd/`.
- Đối chiếu tờ khai với giấy nộp tiền, BCTC, xuất MISA: các bước sau.
