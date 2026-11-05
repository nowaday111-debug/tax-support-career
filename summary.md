# Tóm tắt tiến trình dự án hoa-don-to-khai-trial

Cập nhật: 06/11/2026 (lần 6: tự đọc captcha). Phiên bản hiện tại: 0.4.0 (xem mục 10).

## 1. Rà soát dự án

Dự án là ứng dụng thử nghiệm Node.js + Express 5 (file `server.js`, cơ sở dữ liệu JSON `data/db.json`, số tiền lưu dạng số nguyên VND). Ứng dụng đã có các phần: lập tờ khai 01/GTGT theo TT80/2021 (trước 07/2026) và TT89/2026 (từ 07/2026), chỉ tiêu 22/27/37/38/40a/43, phụ lục 142 (chỉ khi có doanh thu thuế suất 8%), chỉ tiêu 32b của tờ khai TT89, bảng kê, khóa/bổ sung hồ sơ.

Phiên bản 0.2.0 bổ sung module đồng bộ tờ khai từ cổng dichvucong.gdt.gov.vn, nằm trong thư mục `dvc/`:

- `dvc/routes.js`: các API `/api/dvc/*` và `/api/filings*`, chế độ chạy `DVC_MODE=real` hoặc `mock`.
- `dvc/sync.js`: lớp `DvcManager` quản lý phiên, job đồng bộ, captcha, chia cửa sổ thời gian tối đa 30 ngày, phân trang, upsert theo mã hồ sơ, tải file và lưu vào `data/tokhai/<MST>/<năm>/`.
- `dvc/portal-playwright.js`: adapter Chromium chạy `fetch` trong ngữ cảnh trang để cookie và CSRF do trình duyệt xử lý.
- `dvc/portal-mock.js`, `dvc/fake-portal.js`, `dvc/fake-portal-server.js`: cổng giả lập để kiểm thử, tài khoản thử 0109999999 / matkhau-thu.
- `dvc/zip.js`: đọc và ghi ZIP tự viết (stored và deflate), CRC32.
- `dvc/parse.js`: đọc bảng kết quả tìm kiếm HTML.
- `dvc/xmlinfo.js`: đọc thông tin tờ khai từ XML (mã, tên, kỳ, loại, các chỉ tiêu `ctNN`).
- `public/dvc.js` và mục "5. Đồng bộ tờ khai" trong `public/index.html`: giao diện đăng nhập, captcha, đồng bộ và bảng tờ khai.
- `test/dvc.test.js`: 8 bài kiểm thử, cả 8 đều đạt.

Các thay đổi khác: `package.json` (v0.2.0, thêm `express`, `playwright`, các script `start:mock`, `test`, `setup-browser`), `Dockerfile`, `docker-compose.yml`, `.env.example`, `README_TRIAL.md`.

Đã kiểm chứng hồi quy: các tính năng 01/GTGT, bảng kê, PL 142, khóa và bổ sung hồ sơ trong `server.js` không bị thay đổi.

## 2. Tiến trình đã hoàn thành

- Khảo sát cổng thật: đăng nhập qua `/tthc/loginLDAP` (mật khẩu base64, `doiTuong=DN`, captcha); tìm kiếm `/tthc/ho-so/search` (HTML qua htmx, tối đa 30 ngày, tham số size); tab thuế điện tử `POST /tthc/tchs/thuedientu` (trước 07/2025); tải hồ sơ `POST /tthc/tchs/downloadhoso` với header `X-XSRF-TOKEN`, trả về JSON chứa `content` base64 là file ZIP.
- Đồng bộ đầy đủ: đăng nhập, captcha (sai thì hỏi lại), tìm kiếm theo cửa sổ thời gian, phân trang, tải file, cập nhật trạng thái khi đồng bộ lại, hủy job, hết phiên.
- Kiểm tra MST: từ chối đồng bộ nếu MST đăng nhập khác MST của doanh nghiệp.
- Đồng bộ gia tăng: mốc bắt đầu là (ngày kết thúc lần thành công gần nhất − 7 ngày); lần đầu lấy từ 01/01 năm trước.
- Thu thập và phân loại 188 file Excel mẫu và 151 file XML mẫu (xem mục 3 và file `classification.csv`).
- Đọc và phân loại thư mục `Báo cáo tài chính` (28 file docx mẫu theo TT133 và phụ lục IV TT99, 1 workbook xlsx theo TT200) vào F6. Xác định 4 nhóm file trùng dung lượng trong TT133 (b01, b02, b03, b09-klt), tổng 5 file thừa, cần xác nhận rồi mới xóa.
- Cập nhật `skills/skill-01-gdt-crawler/skill.md` (trước đây rỗng) theo phần đồng bộ tờ khai đã có trong `dvc/`.
- Cập nhật `skills/skill-03-01gtgt-engine/skill.md` (chọn mẫu TT80 hoặc TT89 theo kỳ) và `skills/skill-04-bctc-misa-exporter/skill.md` (chọn mẫu BCTC theo chế độ kế toán).
- Cập nhật `phương án triển khai.md` với mục nguồn mẫu BCTC và trạng thái các giai đoạn.

## 3. Phân loại file mẫu theo chức năng

Phân loại dựa trên tên file, mô tả chi tiết cho từng file có trong `classification.csv` (cột: loại file, tên file, mã chức năng, chức năng, ghi chú).

| Mã | Chức năng | Excel | XML |
|---|---|---|---|
| F1 | Tờ khai GTGT (01/GTGT và mẫu 02–05/GTGT) | 32 | 25 |
| F2 | Phụ lục và bảng kê giảm thuế GTGT (PL 142, NQ, ND 15/101, 23/24) | 13 | 0 |
| F3 | Bảng kê hóa đơn mua vào–bán ra (KHBS) | 0 | 5 |
| F4 | Tờ khai và phụ lục TNDN | 46 | 0 |
| F5 | Tờ khai, bảng kê và quyết toán TNCN | 44 | 1 |
| F6 | Báo cáo tài chính (BCTC, B01/B02/B03...) | 47 | 112 |
| F6 (thư mục Báo cáo tài chính, không tính trong bảng trên) | BCTC mẫu TT133, TT99 và TT200 | 1 (xlsx) | 28 (docx) |
| F7 | Mẫu đăng ký mã số thuế (PL 01/02/25, MaSoThue) | 6 | 0 |
| F8 | Mẫu hóa đơn, ấn chỉ, biên lai, thông báo (AC, BLP, TBAC, BC26) | 0 | 8 |
| | Tổng (thư mục mẫu HTKK) | 188 | 151 |

Thư mục `Báo cáo tài chính` (29 file gồm 1 xlsx và 28 docx) được phân loại vào F6 trong `classification.csv`, ghi chú theo chế độ kế toán và mục mẫu. Tổng số dòng dữ liệu trong `classification.csv` hiện là 368 (339 dòng cũ và 29 dòng mới).

Ghi chú về cách đọc mẫu:

- File Excel là mẫu HTKK, có nhiều sheet (tờ khai, KHBS giải trình, Header config, HDSD, bảng kê). Ví dụ `04_GTGT_TT89_309` có sheet `01_2` là phần giảm thuế GTGT theo Nghị quyết.
- File XML có hai dạng: `*_xml_<phiên bản>.xml` là bộ khung dữ liệu với các chỉ tiêu `ctNN` (khoảng 33–34 chỉ tiêu với 01/GTGT); file không có hậu tố `_xml` là layout HTKK Sections mã hóa UTF-16. Đã xác minh layout này với 3 file (`01_GTGT_TT80_283`, `01_GTGT_TT89_309`, `KHBS_01_GTGT_250`), các file còn lại chưa xác minh.
- Hậu tố `DD`, `HN`, `TL`, `GND`, `CNKD`, `TTS` và số phiên bản (251, 268, 283, 309...) được ghi nhận nhưng chưa xác nhận ý nghĩa.
- XML mẫu chỉ có cho GTGT, BLP/AC/TBAC/BC26, IN_BIA_TNCN, và BCTC. Chưa có mẫu XML cho TNCN hay TNDN.

## 4. Các hạng mục đã xác minh và chưa xác minh

Đã xác minh: các chỉ tiêu và logic tính toán 01/GTGT giữ nguyên; các API đồng bộ chạy đúng trên cổng giả lập; adapter Playwright chạy đúng với server HTTP giả lập trong test.

Chưa xác minh:

- Request đăng nhập thật (POST) trên cổng thật.
- Cấu trúc bảng tab thuế điện tử (trước 07/2025) trên cổng thật.
- Chưa chạy Chromium trên cổng thật.
- `package-lock.json` chưa được tạo lại vì môi trường không truy cập được registry npm; bộ thư viện cục bộ được dùng qua `NODE_PATH` khi chạy test.
- Chưa có mẫu XML cho TNCN và TNDN.

## 5. Việc tiếp theo

1. Chạy thử trên cổng thật với tài khoản doanh nghiệp để xác minh request đăng nhập và tab thuế điện tử, sau đó cập nhật README.
2. Chạy `npm install` trên máy có mạng để tạo `package-lock.json`.
3. Bổ sung mẫu XML TNCN và TNDN nếu cần cho chức năng tự lập tờ khai.
   Với BCTC: xác định chế độ kế toán của doanh nghiệp (TT99, TT133 hay TT200) và xác nhận hiệu lực từng thông tư cho kỳ cần lập; chỉ giữ một bộ mẫu chính thức, xử lý các file trùng.
4. Xác nhận ý nghĩa các hậu tố DD/HN/TL/GND/CNKD/TTS và các mã phiên bản để hoàn thiện bảng phân loại.
5. Triển khai các chức năng còn lại theo phương án đã đề xuất: tự lập tờ khai chỉ tiêu 22/37/38 và bảng kê, phụ lục 142, đối chiếu tờ khai với giấy nộp tiền, xuất Excel cho MISA.

## 6. Ghi chú về thư mục Báo cáo tài chính (06/11/2026)

Thư mục gồm ba nhóm:

- `TT133/`: 12 file docx, gồm phụ lục 1-2 (hệ thống tài khoản và biểu mẫu BCTC năm), B01-DN (2 dạng: không đáp ứng và đáp ứng giả định hoạt động liên tục gồm B01a), B02-DN, B03-DN (trực tiếp), B09-DN (2 dạng).
- `phụ lục IV TT99 mẫu báo cáo tài chính/`: 16 file docx, gồm BCTH tài chính năm, BCKQHĐKD, LCTT (trực tiếp và gián tiếp), bộ giữa niên độ (mục 7-13), thuyết minh, và bảng phân bổ NVL, CCDC.
- `bctc-theo-tt200.xlsx` (gốc): workbook theo TT200 với các sheet TONGHOP, CDSPS, CDKT, KQHDKD, LCTT, TMBCTC; số liệu kỳ Quý IV/2015 là dữ liệu mẫu.

Có 5 file TT133 trùng dung lượng với bản khác (đuôi "(1)", "(2)"), cần xác nhận rồi chọn bản giữ lại. Chưa đối chiếu nội dung từng dòng chỉ tiêu với mã số trong XML BCTC (F6 xml) hay với Thông tư 99 mới; đây là việc cho giai đoạn 4.

## 7. Bước 1 theo claude.md: phân tích cấu trúc file mẫu (06/11/2026, lần 3)

Đã hoàn thành bước 1, đang **chờ người dùng xác nhận** trước khi sang bước 2 (kiến trúc và data models).

Kết quả nằm trong `docs/`:

- `docs/buoc-1-mapping.md`: bảng ánh xạ 01/GTGT (khung hồ sơ, khác biệt TT80_283 và TT89_309, chỉ tiêu [21]–[43] với đường dẫn XML, Min, công thức và quy tắc kiểm tra), phụ lục NQ 142, cấu trúc XML BCTC TT133/TT200, và 6 câu hỏi cần xác nhận.
- `docs/mapping/01GTGT_chi_tieu_21_43.csv`, `PL142_bang_ke_upload_HTKK.csv`, `BCTC_TT133_B01B.csv` (140 dòng), `BCTC_TT200.csv` (272 dòng), `BCTC_TT99_chi_nhan.csv` (282 dòng, chỉ có tên, chưa có XML).

Phát hiện chính:

- Mẫu XML để trống `maTKhai`, `tenTKhai`, `moTaBMau`, `pbanTKhaiXML`, `maDVu`, `pbanDVu` và không khai báo `xmlns`. Cần 1 file XML thật đã nộp cho mỗi mẫu để lấy các giá trị này.
- `<PLuc>` rỗng trong cả hai mẫu 01/GTGT, nên chưa có tên thẻ XML cho PL 142. Phương án tạm: xuất bảng kê Excel tải lên HTKK theo `Bang_Ke_01_GiamThue_GTGT_NQ142_GTGT_TT80.xls`.
- TT89 thêm `ct32b`, `ct34a`; đổi `NNT/phuongXa` thành `tenXaNNT`/`maXaNNT`; bỏ cấp quận/huyện ở `ct11b`.
- Không có XML mẫu cho BCTC TT99.
- `server.js` đang xuất `<ToKhai01GTGT>` tự đặt, không khớp mẫu; sẽ thay ở bước 3.

Việc tiếp theo: người dùng trả lời 6 câu hỏi ở mục 4 của `docs/buoc-1-mapping.md`, sau đó làm bước 2.

## 8. Bước 1, bản 2: đối chiếu với HTKK 5.8.2 trên máy (06/11/2026, lần 4)

Đọc trực tiếp (chỉ đọc) thư mục cài đặt HTKK: XSD chính thức (`InterfaceTemplates/Validate`), cấu hình `Project/Menu.xml` và một file XML 01/GTGT thật do HTKK kết xuất. Cập nhật `docs/buoc-1-mapping.md` lên bản 2.

Đã chốt:

- Namespace `http://kekhaithue.gdt.gov.vn/TKhaiThue`; `maDVu`=HTKK; `DLyThue` và `PLuc` bỏ hẳn khi không có.
- 01/GTGT đang dùng mẫu TT80: `maTKhai`=842, `pbanTKhaiXML`=2.8.3. Mẫu 01/GTGT TT89 (309) có XSD nhưng **chưa có trong menu HTKK**, chưa có `maTKhai`. Đính chính mục 1: không chọn mẫu cứng theo mốc 07/2026.
- PL 142 có XML: `PLuc/PL_NQ142_GTGT` (mua vào, bán ra, `ChenhLech/ct9`), dùng chung cho NQ 142/174/204.
- [41] kiểu `nonNegativeInteger`, nên ghi giá trị tuyệt đối.
- BCTC: TT99 `maTKhai` 1281 (bản 3.0.5, từ 2026), TT200 402 (2.2.6), TT133 B01b 684 (2.3.2). Có XSD TT99 nên đã lập `BCTC_TT99.csv` đủ đường dẫn XML. 100% đường dẫn BCTC đã đối chiếu với XSD.
- File mới: `docs/mapping/HTKK_danh_muc_to_khai.csv`, `docs/mapping/BCTC_TT99.csv`, `docs/mapping/xsd/*.csv`. File `BCTC_TT99_chi_nhan.csv` không còn dùng.

Còn mở: `ID` dòng PL 142, tên `PL_KQHDSXKD`/`PL_CDTK ` của TT133 (Menu và XSD lệch nhau), định dạng `ct21` khi không đánh dấu. Cần một lần kết xuất thật. Giao diện HTKK đang bị chặn bởi một hộp thoại Claude không nhìn thấy; người dùng cần đóng hộp thoại trước.

## 9. Bước 2–3: module 01/GTGT TT80 (06/11/2026, lần 5) — phiên bản 0.3.0

Người dùng chốt: bước đầu làm 01/GTGT theo TT80, các quyết định còn lại Claude tự chọn (ghi ở `docs/buoc-2-kien-truc.md`, mục 7).

Đã làm:

- Kiến trúc `src/` theo Clean Architecture: domain (models, tiền VND, kỳ), parser hóa đơn TT78 + bảng kê, engine 01/GTGT TT80 + PL 142 + quy tắc kiểm tra HTKK, exporter XML HTKK. Không thêm thư viện ngoài.
- Parser chạy trên 72 hóa đơn thật trong `Desktop\hoa don`: 69 đọc đúng (đối chiếu độc lập bằng Python, lệch 0), 3 file không theo TT78 bị từ chối có lý do.
- XML sinh ra hợp lệ theo XSD chính thức của HTKK (xmllint), kể cả file có PL 142. File XML thật của HTKK cũng hợp lệ với cùng cách kiểm tra.
- `server.js` dùng engine mới. Đã bỏ cách tính cũ (sai nhãn: 29 = 10%, 32 = 8%) và bỏ việc tự chuyển sang TT89 từ 07/2026. Thêm API import hóa đơn XML và cập nhật thông tin công ty.
- Lệnh `node scripts/lap-01gtgt.js` lập tờ khai từ thư mục hóa đơn, xuất XML, bảng kê CSV, báo cáo JSON.
- 41 bài kiểm thử (`npm test`): 40 đạt, 1 bỏ qua (Playwright, có từ trước).

Lưu ý:

- Dữ liệu cũ trong `data/db.json` có thể còn ghi `form_version` TT89; hiện chỉ hiển thị, không còn ảnh hưởng cách tính.
- Kết quả chạy thử trên dữ liệu thật chỉ dùng mẫu (mỗi nhà cung cấp 1 hóa đơn), không phải số liệu kê khai của doanh nghiệp.

Việc tiếp theo:

1. Nhập thử file XML vào HTKK trên máy để xác nhận lần cuối (cần đóng hộp thoại đang chặn HTKK). Đối chiếu `ID` dòng PL 142 với file HTKK kết xuất.
2. Tự động [37]/[38] từ tờ khai bổ sung (KHBS, XSD đã có).
3. Đối chiếu tờ khai với giấy nộp tiền.
4. BCTC (TT99 trước) và xuất Excel MISA.

## 10. Tự đọc và tự điền captcha dichvucong (06/11/2026, lần 6) — phiên bản 0.4.0

Mẫu người dùng đưa: `captcha.md` (ảnh `2di7r`). Lấy thêm 12 captcha thật từ `/tthc/login/getCaptcha` (lấy nhanh ~15 ảnh liên tiếp thì cổng trả **429 Too Many Requests**), gán nhãn bằng mắt, lưu ở `test/fixtures/captcha/<mã>.png`.

Đặc điểm captcha: PNG 150x38 có khung đen 1px, nền xám chuyển màu ngang (~195 → 250), 5 ký tự `a-z0-9` chữ thường, nhiều font đậm (có nghiêng), nét có nhiễu chải, khoảng cách ~19 px.

Đã làm:

- `dvc/captcha/png.js`: giải mã PNG thuần JS (zlib của Node).
- `dvc/captcha/solver.js`: bỏ khung, trừ nền theo cột, làm mờ 3x3, phân ngưỡng, tách 5 ký tự (thành phần liên thông, gộp chấm i, tách ký tự dính), đặc trưng lưới 16x16 làm mờ + vị trí trong dòng, k-NN (k=3). Hàm `learn()` lưu mẫu đã được cổng chấp nhận vào `data/captcha/learned.json`, mẫu học trọng số gấp đôi.
- `dvc/captcha/model.json` (~1,9 MB): 5.400 mẫu gom (k-means 150/ký tự) từ 11.200 captcha tổng hợp sinh bằng `scripts/captcha/gen_synthetic.py` (10 font đậm) + 65 ký tự của 13 captcha thật.
- `dvc/sync.js`: đăng nhập để trống captcha thì tự đọc, sai captcha thì lấy mã mới thử lại (mặc định 3 lần); **sai mật khẩu dừng ngay**. Tra cứu: cổng đòi captcha thì tự đọc trước, hết số lần mới chuyển `NEED_CAPTCHA` (ảnh kèm `guess`). Mọi captcha được chấp nhận (tự đọc hoặc gõ tay) đều được học. Lấy captcha bị 429 thì chờ 5/10/20 s.
- `dvc/portal-playwright.js`: phân biệt HTTP 429 (`RATE_LIMITED`) với hết phiên (trước đây 429 bị báo nhầm là hết phiên).
- `dvc/routes.js`: `GET /api/dvc/captcha`, `POST /api/dvc/captcha/solve`; `/api/dvc/info` có thêm trạng thái tự đọc.
- Giao diện: ô captcha đăng nhập để trống = tự đọc (placeholder hiện mã đoán); khung captcha khi đồng bộ điền sẵn mã đoán; tiến trình hiện "captcha tự đọc đúng x/y".
- Cấu hình `.env`: `DVC_CAPTCHA_AUTO` (mặc định 1), `DVC_CAPTCHA_AUTO_TRIES` (mặc định 3).
- `scripts/captcha/`: `eval.js` (`npm run captcha:eval`), `build_model.js`, `condense.py`, `gen_synthetic.py` để đo và dựng lại mô hình.
- `test/captcha.test.js`: 11 bài, đều đạt; `test/dvc.test.js` 8 bài vẫn đạt.

Độ chính xác (13 captcha thật, mô hình chỉ có mẫu tổng hợp, đo khách quan): **~88–92% ký tự, 7–9/13 captcha đúng cả mã**. Với 3 lần thử, ước tính ~90% lượt không cần người dùng; tăng dần khi tự học. Lỗi hay gặp: `1`/`i` → `t`, `5` → `3`, `n` → `h`, `u` → `g`.

Chưa xác minh:

- Chưa chạy luồng tự đọc đầu-cuối trên cổng thật (đăng nhập thật + tra cứu thật); mới kiểm trên ảnh thật và cổng giả lập.
- Thông báo sai captcha khi đăng nhập trên cổng thật: đang nhận diện theo từ khóa `captcha` / `mã xác nhận` / `mã kiểm tra`. Nếu cổng dùng câu khác, phần mềm sẽ coi là lỗi khác và dừng (an toàn, không thử lại) — cần ghi lại câu thật khi chạy.
- Captcha trang tra cứu (`/tthc/getCaptcha`) giả định cùng kiểu với captcha đăng nhập; chưa lấy mẫu.

Việc tiếp theo (thêm vào danh sách mục 9):

1. Chạy thử đăng nhập + đồng bộ thật để xác nhận câu báo sai captcha và kiểu captcha tra cứu; theo dõi thống kê ở `GET /api/dvc/captcha`.
2. Nếu tỉ lệ tự đọc thấp: gom thêm captcha thật đã gán nhãn vào `test/fixtures/captcha/` và dựng lại `model.json`.
