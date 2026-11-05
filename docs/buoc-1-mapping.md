# Bước 1: Phân tích cấu trúc file mẫu (Schema Analysis)

Lập ngày 06/11/2026 theo `claude.md`, bước 1. Bản 2: đối chiếu trực tiếp với phần mềm HTKK 5.8.2 trên máy người dùng. Trạng thái: **chờ xác nhận**, chưa viết code bước 2 và 3.

Mọi tên thẻ, kiểu dữ liệu và mã dưới đây lấy từ file của HTKK. Chỗ nào HTKK không có thông tin thì ghi "chưa có", không tự điền.

## 0. Nguồn

Thứ tự tin cậy, từ cao xuống:

| # | Nguồn (trong `C:\Program Files (x86)\HTKK\`) | Nội dung |
|---|---|---|
| 1 | `InterfaceTemplates/TKhaiThue.xsd`, `TKhaiThue_DBHC.xsd` và `InterfaceTemplates/Validate/<mẫu>.xsd` | Lược đồ XSD chính thức dùng để kiểm tra file. Gồm namespace, tên thẻ, thứ tự, kiểu dữ liệu, số lần lặp |
| 2 | `Project/Menu.xml` | Cấu hình từng tờ khai: `maTKhai`, `pbanTKhaiXML`, `tenTKhai`, `moTaBMau`, ngày hiệu lực, thẻ XML của từng phụ lục |
| 3 | `DataFiles/<MST>/tmpExport.xml` | Một file XML 01/GTGT TT80 thật do HTKK kết xuất (kỳ Q4/2025), dùng để xem định dạng giá trị thực tế |
| 4 | `InterfaceTemplates/xml/*.xml`, `mẫu excel upload/*.xls` | Khung thẻ và tên chỉ tiêu (đã dùng ở bản 1) |

Không thao tác được giao diện HTKK: có một hộp thoại bị che đang chặn cửa sổ (xem mục 5). Mọi thông tin dưới đây lấy bằng cách **chỉ đọc** file, không sửa dữ liệu nào trong HTKK.

Các file trong `docs/mapping/`:

| File | Nội dung |
|---|---|
| `01GTGT_chi_tieu_21_43.csv` | 31 chỉ tiêu: đường dẫn XML, kiểu XSD (TT80/TT89), Min/Max, ô Excel, mô tả |
| `HTKK_danh_muc_to_khai.csv` | `maTKhai`, `pbanTKhaiXML`, `tenTKhai`, `moTaBMau`, hiệu lực và thẻ XML phụ lục của các mẫu GTGT và BCTC |
| `BCTC_TT133_B01B.csv` (140), `BCTC_TT200.csv` (272), `BCTC_TT99.csv` (282) | Mã số, tên chỉ tiêu, đường dẫn XML đầy đủ. Đã đối chiếu: 100% đường dẫn có trong XSD |
| `PL142_bang_ke_upload_HTKK.csv` | Cột của bảng kê Excel PL 142 |
| `xsd/XSD_*.csv` (7 file) | XSD đã trải phẳng: đường dẫn, kiểu, minOccurs/maxOccurs, nillable, mô tả |
| `BCTC_TT99_chi_nhan.csv` | **Đã thay bằng `BCTC_TT99.csv`, có thể xóa** |

## 1. Thông tin chung của hồ sơ (đã xác định)

| Thẻ | Giá trị |
|---|---|
| Gốc | `<HSoThueDTu xmlns="http://kekhaithue.gdt.gov.vn/TKhaiThue" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` |
| `HSoKhaiThue` | thuộc tính `id="ID_1"` |
| `TTinDVu` | `maDVu`=`HTKK`, `tenDVu`=`HỖ TRỢ KÊ KHAI THUẾ`, `pbanDVu`=phiên bản HTKK (file mẫu ghi `5.5.5`; máy hiện chạy 5.8.2), `ttinNhaCCapDVu`=`TỔNG CỤC THUẾ HÀ NỘI` |
| `loaiTKhai` | `C` (chính thức), `B` (bổ sung), `T` (thay thế) |
| `soLan` | Số lần bổ sung; tờ khai lần đầu ghi `0` |
| `kieuKy` | `D`, `M`, `Y`, `K`, `Q`, `LD` hoặc `DK`. 01/GTGT theo quý: `Q`, `kyKKhai`=`4/2025`, `kyKKhaiTuNgay`/`DenNgay` dạng `dd/MM/yyyy`; `kyKKhaiTuThang`/`DenThang` để trống |
| Ngày | `ngayLapTKhai`, `ngayKy`: `yyyy-MM-dd` |
| `mst` | Mẫu: 10 số, 10 số + `-` + 3 số, hoặc 12 số |
| `DLyThue` | minOccurs=0: **bỏ hẳn thẻ** khi không có đại lý thuế (file thật không có thẻ này) |
| `PLuc` | minOccurs=0: **bỏ hẳn thẻ** khi không có phụ lục |
| Chữ ký số `CKyDTu` | Có trong `TKhaiThue.xsd` (TT80), đã chú thích bỏ trong `TKhaiThue_DBHC.xsd` (TT89). Không thuộc phạm vi file nhập HTKK |

Khác biệt khối `NNT`: lược đồ TT80 dùng `phuongXa`; lược đồ TT89 dùng `tenXaNNT` và `maXaNNT`.

## 2. Tờ khai 01/GTGT

### 2.1. Mẫu nào đang dùng

Theo `Menu.xml` của HTKK 5.8.2:

| Mẫu | maTKhai | pbanTKhaiXML | Trạng thái |
|---|---|---|---|
| 01/GTGT (TT80/2021), lược đồ `01_GTGT_TT80_283.xsd` | **842** | **2.8.3** | **Đang dùng.** Tờ khai Q3/2026 trên máy cũng lập bằng mẫu này |
| 01/GTGT (TT89/2026), lược đồ `01_GTGT_TT89_309.xsd` | chưa có | chưa có | Đã có XSD và khung XML, nhưng **chưa có trong menu HTKK**. Các mẫu TT89 khác (03, 04, 05/GTGT) có hiệu lực từ 01/10/2026, `maTKhai` mới (2034, 2035, 2122), bản 3.0.9 |

`tenTKhai` = `TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (Mẫu số 01/GTGT)`. `moTaBMau` = `(Ban hành kèm theo Thông tư số 80/2021/TT-BTC ngày 29 tháng 9 năm 2021 của Bộ trưởng Bộ Tài chính)`.

**Đính chính bản 1:** `summary.md` ghi "từ 07/2026 dùng mẫu TT89". Theo HTKK hiện tại thì chưa đúng với 01/GTGT. Engine cần chọn mẫu theo cấu hình (`maTKhai` và bản), không cứng theo ngày. Khi HTKK phát hành 01/GTGT TT89, chỉ cần thêm cấu hình mới.

### 2.2. Chỉ tiêu [21]–[43]

Thứ tự dòng dưới đây đúng thứ tự thẻ trong XSD (phải giữ nguyên khi sinh file). Đường dẫn tính từ `HSoThueDTu/HSoKhaiThue/CTieuTKhaiChinh/`.

| CT | Đường dẫn | TT80 | TT89 | Nội dung / công thức (theo mô tả XSD và mẫu Excel HTKK) |
|---|---|---|---|---|
| [21] | `ct21` | ✓ | ✓ | Không phát sinh mua, bán trong kỳ |
| [22] | `ct22` | ✓ | ✓ | Thuế còn được khấu trừ kỳ trước chuyển sang |
| [23], [24] | `GiaTriVaThueGTGTHHDVMuaVao/ct23`, `/ct24` | ✓ | ✓ | Giá trị, thuế HHDV mua vào |
| [23a], [24a] | `HangHoaDichVuNhapKhau/ct23a`, `/ct24a` | ✓ | ✓ | Trong đó nhập khẩu |
| [25] | `ct25` | ✓ | ✓ | Thuế mua vào được khấu trừ kỳ này |
| [26] | `ct26` | ✓ | ✓ | Bán ra không chịu thuế |
| [27], [28] | `HHDVBRaChiuThueGTGT/ct27`, `/ct28` | ✓ | ✓ | TT80: [27]=[29]+[30]+[32]+[32a]. TT89: [27]=[29]+[30]+[32]+[32a]−[32b]. [28]=[31]+[33] |
| [29] | `ct29` | ✓ | ✓ | Bán ra 0% |
| [30], [31] | `HHDVBRaChiuTSuat5/ct30`, `/ct31` | ✓ | ✓ | Bán ra 5% |
| [32], [33] | `HHDVBRaChiuTSuat10/ct32`, `/ct33` | ✓ | ✓ | Bán ra 10% |
| [32a] | `ct32a` | ✓ | ✓ | TT80: không tính thuế. TT89: không kê khai tính nộp thuế |
| [32b] | `ct32b` | | ✓ | Không tính vào giá tính thuế |
| [34a] | `ct34a` | | ✓ | Không thuộc phạm vi điều chỉnh của luật thuế GTGT |
| [34], [35] | `TongDThuVaThueGTGTHHDVBRa/ct34`, `/ct35` | ✓ | ✓ | TT80: [34]=[26]+[27]. TT89: [34]=[26]+[27]+[34a]. [35]=[28] |
| [36] | `ct36` | ✓ | ✓ | [36]=[35]−[25] |
| [37], [38] | `ct37`, `ct38` | ✓ | ✓ | Điều chỉnh giảm / tăng thuế còn được khấu trừ các kỳ trước |
| [39a] | `ct39a` | ✓ | ✓ | Thuế nhận bàn giao được khấu trừ |
| [40a] | `ct40a` | ✓ | ✓ | [40a]=([36]−[22]+[37]−[38]−[39a]) khi ≥ 0 |
| [40b] | `ct40b` | ✓ | ✓ | Bù trừ thuế dự án đầu tư; [40b] ≤ [40a] |
| [40] | `ct40` | ✓ | ✓ | [40]=[40a]−[40b] |
| [41] | `ct41` | ✓ | ✓ | \|[36]−[22]+[37]−[38]−[39a]\| khi biểu thức ≤ 0 |
| [42] | `ct42` | ✓ | ✓ | Đề nghị hoàn; [42] ≤ [41] |
| [43] | `ct43` | ✓ | ✓ | [43]=[41]−[42] |

Kiểu theo XSD:

| Kiểu XSD | Chỉ tiêu |
|---|---|
| `xs:boolean` | [21]. File thật ghi `1` khi đánh dấu |
| `xs:nonNegativeInteger` (không âm) | [22], [40a], [40], [41] |
| `xs:long` (cho phép âm) | các chỉ tiêu còn lại |

Mọi chỉ tiêu đều `nillable`. File thật ghi đủ các thẻ, giá trị `0` khi không phát sinh.

Riêng TT89 có thêm `ct32b`, `ct34a` (đặt sau `ct32a`, trước `TongDThuVaThueGTGTHHDVBRa`) và bỏ `ct11b_quanHuyen_*`.

**[41] lưu số không âm** (kiểu `nonNegativeInteger`). Câu hỏi 4 của bản 1 đã có lời giải: ghi giá trị tuyệt đối của ([36]−[22]+[37]−[38]−[39a]) khi biểu thức này ≤ 0.

`tieuMucHachToan` chỉ nhận một trong các giá trị `1701`, `1704`, `1705`, `0000`, `1761`, `1052`, `1056`, `1057`. File thật dùng `1701`.

### 2.3. Phụ lục của 01/GTGT TT80 (theo `Menu.xml` và XSD)

| Sheet HTKK | Thẻ XML dưới `PLuc` |
|---|---|
| 01-2/GTGT | `PLuc_01_2_GTGT` |
| 01-3/GTGT | `Pluc_01_3_GTGT` (chữ "l" thường, đúng như XSD) |
| 01-6/GTGT (CSSX) | `Pluc_01_6_GTGT_CSSX` |
| 01-6/GTGT (ĐTVT) | `Pluc_01_6_GTGT_DVVT` |
| PL 43/2022/QH15 | `PL_NQ43_GTGT` |
| PL_GiamThue_GTGT_23_24 | `PL_NQ101_GTGT` |
| **PL 142/2024/QH15-174/2024/QH15-204/2025/QH15** | **`PL_NQ142_GTGT`** |
| 01-KHBS, 01-1/KHBS | `PL01_KHBS`, `PL01_1_KHBS` (lược đồ riêng `KHBS_01_GTGT_TT80_283.xsd`) |

Lưu ý: sheet PL 142 trên HTKK dùng chung cho NQ 142/2024, 174/2024 và 204/2025.

### 2.4. Phụ lục giảm thuế `PL_NQ142_GTGT` (giống nhau ở TT80 và TT89)

```
PLuc/PL_NQ142_GTGT                                  [0..1]
├─ HH_DV_MuaVaoTrongKy                              [0..1]  I. Mua vào 8%
│  ├─ BangKeTenHHDV @ID                             [1..n]
│  │  ├─ tenHHDVMuaVao      string                  (2)
│  │  ├─ giaTriHHDVMuaVao   long                    (3)
│  │  └─ thueGTGTHHDV       long                    (4)
│  ├─ tongCongGiaTriHHDVMuaVao   long               tổng (3)
│  └─ tongCongThueGTGTHHDV       long               tổng (4)  = [06]
├─ HH_DV_BanRaTrongKy                               [0..1]  II. Bán ra
│  ├─ BangKeTenHHDV @ID                             [1..n]
│  │  ├─ tenHHDV            string                  (2)
│  │  ├─ giaTriHHDV         long                    (3)
│  │  ├─ thueSuatTheoQuyDinh long  (mặc định 10)    (4)
│  │  ├─ thueSuatSauGiam    decimal (8 khi giảm 20%) (5)=(4)×80%
│  │  └─ thueGTGTDuocGiam   long                    (6)=(3)×[(4)−(5)]
│  ├─ tongCongGiaTriHHDV         long               tổng (3)
│  └─ tongCongThueGTGTDuocGiam   long               tổng (6)  = [08]
└─ ChenhLech                                        [1..1]
   └─ ct9                   long                    [09]=[08]−[06]
```

Từ đây, **PL 142 sinh được bằng XML**, không cần qua bảng kê Excel.

Mô tả trong XSD xác nhận [09] = [08] − [06]. Cách gán [06] = tổng cột (4) mục I và [08] = tổng cột (6) mục II khớp với cấu trúc trên, nhưng XSD không ghi tên [06]/[08] ở các thẻ tổng. Mức tin cậy: cao.

Thuộc tính `ID` của `BangKeTenHHDV` là chuỗi. HTKK đánh số dòng nhưng chưa thấy file thật có dòng phụ lục, nên **giá trị cụ thể của `ID` chưa xác minh** (dự kiến "1", "2", …).

Mã hồ sơ (`MaHoSo`) của PL 142 trong HTKK là `002609`.

## 3. Báo cáo tài chính

### 3.1. Mã tờ khai (theo `Menu.xml`)

| Bộ | maTKhai | pbanTKhaiXML | Hiệu lực trong HTKK |
|---|---|---|---|
| TT99/2025 năm (`99_BCTC`) | **1281** | 3.0.5 | từ 01/01/2026 |
| TT99 giữa niên độ đầy đủ / tóm lược | 1282 / 1283 | 3.0.5 | từ 01/01/2026 |
| TT200 năm (`200_01_CDKT`) | 402 | 2.2.6 | 01/01/2015 – 31/12/2026 |
| TT133 B01a-DNN / **B01b-DNN** / B01-DNNKLT / B01-DNSN | 683 / **684** / 685 / 686 | 2.3.2 | từ 01/01/2017 |

`tenTKhai` và `moTaBMau` của từng bộ nằm trong `HTKK_danh_muc_to_khai.csv`.

### 3.2. Cấu trúc XML (theo XSD)

| Bộ | `CTieuTKhaiChinh` | `PLuc` |
|---|---|---|
| TT99 (`99_BCTC_305.xsd`) | `hoatDongLienTuc`, `hoatDongKhongLienTuc` (boolean); khối `BCTHTC_HoatDongLienTuc` (126 chỉ tiêu) hoặc `BCTHTC_HoatDongKhongLienTuc` (71 chỉ tiêu), mỗi khối gồm `ThuyetMinh`/`SoCuoiNam`/`SoDauNam` + người ký | `PL_KQHDSXKD` (21), `PL_LCTTTT` (27), `PL_LCTTGT` (37); mỗi phụ lục gồm `ThuyetMinh`/`NamNay`/`NamTruoc` |
| TT200 (`200_01_CDKT_226.xsd`) | `CDKT_HoatDongLienTuc` (115) / `CDKT_HoatDongKhongLienTuc` (73) | như TT99 nhưng KQ 20 chỉ tiêu, thêm khối `PhanKy` |
| TT133 B01b (`133_B01B_DNN_BCTC_232.xsd`) | `ThuyetMinh`/`SoCuoiNam`/`SoDauNam` (65) + 7 thẻ người ký, kiểm toán | `PL_KQHDSXKD` (16), `PL_LCTTTT` (24), `PL_LCTTGT` (35), `PL_CDTK` (bảng cân đối tài khoản: 124 tài khoản × Nợ/Có × đầu kỳ/phát sinh/cuối kỳ) |

Kiểu số tiền: TT99 và TT133 dùng `xs:long`; TT200 dùng `xs:decimal`. Thuyết minh là chuỗi.

Câu hỏi "phụ lục `PL_*` nằm trong `<PLuc>`" của bản 1 đã được xác nhận qua XSD và `Menu.xml`.

### 3.3. Điểm bất thường trong file của HTKK (cần một lần kết xuất thật để chốt)

- `Menu.xml` của TT133 ghi phụ lục KQ là `PL_KQHDXSKD`, còn XSD ghi `PL_KQHDSXKD`. File XML được kiểm tra theo XSD, nên dự án dùng `PL_KQHDSXKD`.
- XSD TT133 khai báo tên `PL_CDTK ` (có dấu cách cuối), là tên thẻ không hợp lệ. Có thể HTKK không kiểm tra phụ lục này theo XSD. Tạm thời dùng `PL_CDTK` và chưa làm phần cân đối tài khoản cho tới khi có file kết xuất thật.

## 4. Câu hỏi còn lại

Đã giải quyết: câu 1 (namespace, `maTKhai`, phiên bản), câu 2 (PL 142 sinh được bằng XML), câu 4 ([41] không âm). Còn lại:

1. **01/GTGT TT89**: HTKK chưa phát hành mẫu này nên chưa có `maTKhai`. Đồng ý **chỉ làm engine theo TT80 (842, bản 2.8.3)** và để cấu hình sẵn chỗ cho TT89?
2. **Một lần kết xuất thật** để chốt: thuộc tính `ID` của dòng PL 142, tên thẻ `PL_KQHDSXKD`/`PL_CDTK` của TT133, định dạng `ct21` khi không đánh dấu (`0` hay `false`). Cách làm ở mục 5.
3. Doanh thu 8% ghi vào [32] với [33] = [32] × 10% − [08]: đúng như quy tắc HTKK (mục 6). Bạn xác nhận?
4. [23a]/[24a], [32b], [34a] nhập tay: đồng ý?
5. BCTC: HTKK hiện có TT99 (từ 2026), TT200 (tới hết 2026) và TT133. Chọn bộ nào làm chính thức trước?

## 5. Về việc thao tác HTKK

Cửa sổ HTKK trên máy đang bị chặn bởi một hộp thoại mà Claude không nhìn thấy (bị che vì thuộc tiến trình chưa được cấp quyền). Có thể là hộp thoại hỏi ghi dữ liệu khi đóng tờ khai Q3/2026. Claude không bấm vào hộp thoại này vì không biết nội dung.

Nếu cần kết xuất thật (câu 2), bạn đóng hộp thoại đó trước. Sau đó Claude sẽ lập một tờ khai thử ở một kỳ không dùng, nhập vài dòng PL 142, kết xuất XML và đối chiếu. Hoặc bạn tự kết xuất một tờ khai có PL 142 rồi để file vào thư mục dự án.

## 6. Quy tắc kiểm tra và nguồn dữ liệu

XSD không chứa quy tắc tính. Các quy tắc dưới đây lấy từ sheet `Header` của `01_GTGT_TT89_309.xls` (Y là lỗi chặn, N là cảnh báo); mẫu TT80 có cùng nhóm quy tắc.

| Quy tắc | Mức |
|---|---|
| [22] khác [43] của tờ khai lần đầu kỳ trước liền kề | N |
| [23a] ≤ [23]; [24a] ≤ [23a] (nguyên văn); \|25\| ≤ \|24\|; \|24\| ≤ \|23\| | Y |
| [40b] ≤ [40a] | Y |
| [31] khác [30] × 5%; [33] khác [32] × 10% | N |
| [33] khác [32] × 10% − chỉ tiêu [08] trên PL NQ 142/2024/QH15 | N |
| [31] > [30]; [33] > [32] | Y |

Nguồn dữ liệu dự kiến:

| CT | Nguồn |
|---|---|
| [22] | [43] của tờ khai lần đầu kỳ trước liền kề (đã tải qua `dvc/`) |
| [23], [24], [25] | Hóa đơn mua vào hợp lệ (skill-02) |
| [23a], [24a], [32b], [34a] | Chưa có nguồn tự động, nhập tay |
| [26], [29]–[33], [32a] | Hóa đơn bán ra theo thuế suất; doanh thu 8% vào [32], phần giảm sang PL 142 |
| [37], [38] | Tờ khai bổ sung (KHBS) các kỳ trước |
| [39a], [40b], [42] | Nhập tay |
| Còn lại | Tính theo công thức ở mục 2.2 |
