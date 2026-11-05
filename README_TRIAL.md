# Hóa đơn & Tờ khai — BẢN DÙNG THỬ (Module A, từ đặc tả MVP)

> **BẢN DÙNG THỬ — KHÔNG NỘP THUẾ THẬT, KHÔNG DÙNG DỮ LIỆU THẬT.**
> Không tích hợp nhà cung cấp hóa đơn, không ký số, không nộp lên cổng thuế.
> File XML chỉ để **import vào HTKK**. File bảng kê là **bảng kê chung, không phải
> mẫu MISA Offline theo phiên bản cụ thể** (phiên bản MISA đích chưa được chốt).

## Chạy thử

### Cách 1 — Docker (khuyến nghị khi triển khai)
```bash
cd hoa-don-to-khai-trial
docker compose up --build -d
# Mở http://localhost:3000
# Xem log: docker compose logs -f
# Dừng: docker compose down
```

### Cách 2 — Node trực tiếp (không cần Docker)
```bash
cd hoa-don-to-khai-trial
npm install
node server.js
# Mở http://localhost:3000
```

Cổng mặc định: **3000** (đổi bằng `PORT` trong `.env` hoặc biến môi trường).
Dữ liệu lưu ở `data/db.json`. Xóa file này để làm lại từ đầu với dữ liệu mẫu.

## MỚI (0.2.0) — Đồng bộ tờ khai từ dichvucong.gdt.gov.vn về máy

Mục **5** trên giao diện: đăng nhập cổng **dichvucong.gdt.gov.vn** bằng tài khoản của doanh nghiệp,
rồi kéo **toàn bộ hồ sơ/tờ khai đã nộp** (danh sách + file XML gốc) về máy.

### Cài đặt lần đầu (chạy trên máy Windows/Mac/Linux của doanh nghiệp)
```bash
cd hoa-don-to-khai-trial
npm install                      # cài express + playwright (cập nhật package-lock.json)
npx playwright install chromium  # tải trình duyệt Chromium mà phần mềm điều khiển
node server.js                   # mở http://localhost:3000
```
Dùng thử không cần tài khoản thật: `npm run start:mock` (cổng **giả lập**, dữ liệu bịa,
tài khoản `0109999999` / `matkhau-thu`, captcha đọc trên ảnh — ảnh giả lập là SVG nên luôn phải nhập tay).

### Cách dùng
1. Nhập **tên đăng nhập (MST)** → **Lấy mã captcha** → nhập **mật khẩu** → **Đăng nhập**.
   Ô captcha **để trống** thì phần mềm tự đọc mã (ô hiện gợi ý `tự đọc: xxxxx`), sai thì tự lấy mã mới thử lại;
   muốn tự nhập thì gõ mã vào ô như bình thường.
   Có thể chọn sẵn công ty; nếu MST đăng nhập khác MST công ty đã chọn, phần mềm từ chối để không lẫn dữ liệu.
   Không chọn thì phần mềm tự tạo công ty theo MST đăng nhập.
2. Chọn **Từ ngày – Đến ngày** (lần đầu gợi ý 01/01 năm trước; các lần sau gợi ý tự động từ lần đồng bộ trước
   lùi 7 ngày để cập nhật trạng thái hồ sơ mới nộp) → **Đồng bộ**.
3. Khi cổng đòi captcha, phần mềm **tự đọc và tự điền**. Chỉ khi tự đọc sai liên tiếp (mặc định 3 lần/lượt)
   khung vàng mới hiện ảnh captcha kèm mã đã đoán sẵn trong ô → sửa nếu cần → **Tiếp tục** (Enter).
4. Kết quả: bảng "Tờ khai đã đồng bộ" + file trên máy tại `data/tokhai/<MST>/<năm>/`
   (`<mã hồ sơ>.zip` là file gốc của cổng, `<mã hồ sơ>__*.xml` là các file XML bên trong).
   Phần mềm đọc sẵn từ XML: mã mẫu, kỳ kê khai, chính thức/bổ sung, lần bổ sung, MST, các chỉ tiêu `ctNN`.

### Phần mềm làm gì với cổng (đã khảo sát trên cổng thật 11/2026)
| Việc | Endpoint của cổng |
|---|---|
| Ảnh captcha đăng nhập | `GET /tthc/login/getCaptcha` |
| Đăng nhập (doanh nghiệp: `doiTuong=DN`, mật khẩu base64 như trang web làm) | `POST /tthc/loginLDAP` |
| Tra cứu hồ sơ đã nộp trên DVC (từ 01/07/2025) — tối đa **30 ngày/lượt**, lấy 100 dòng/trang | `GET /tthc/ho-so/search` |
| Tra cứu hồ sơ nộp trên Thuế điện tử cũ (trước 01/07/2025) | `POST /tthc/tchs/thuedientu` |
| Tải hồ sơ (ZIP chứa XML, trả về base64) | `POST /tthc/tchs/downloadhoso` (`-tdt` cho hồ sơ cũ) |

- Phần mềm chạy một **Chromium thật** (Playwright) và gửi mọi yêu cầu **từ bên trong trang của cổng**, nên cookie phiên,
  cookie chống bot và token CSRF được xử lý như khi người dùng thao tác tay.
- Khoảng thời gian được chia thành các lượt ≤ 30 ngày, tự tách tại mốc 01/07/2025 (DVC / Thuế điện tử).
- **Captcha tự đọc** (xem mục "Tự đọc captcha" bên dưới). Trên cổng thật đã quan sát: sau khi qua captcha cho một
  lượt tra cứu, chuyển trang trong cùng lượt không cần captcha mới. Phần mềm gửi yêu cầu trước, chỉ lấy captcha khi cổng
  trả lỗi captcha, nên số captcha là tối thiểu mà cổng cho phép (thường ≤ 1 lần/30 ngày dữ liệu).
- Chống trùng theo **mã hồ sơ**; chạy lại chỉ thêm hồ sơ mới, cập nhật trạng thái (lưu lịch sử đổi trạng thái)
  và tải bù file còn thiếu/lỗi.
- **Mật khẩu không được lưu** (chỉ đi qua bộ nhớ để gửi lên cổng 1 lần, không ghi log). Phiên tự đóng sau 30 phút không dùng.
- Nghỉ 1,2 giây giữa các yêu cầu (`DVC_DELAY_MS`) để không gây tải cho cổng.

### Tự đọc captcha (từ bản 0.4.0)
Captcha của cổng: ảnh PNG 150×38, 5 ký tự `a-z0-9` chữ thường, nền xám chuyển màu, nét chữ có nhiễu chải
(mẫu: `captcha.md`, 13 ảnh thật đã gán nhãn trong `test/fixtures/captcha/`).

- Bộ đọc nằm ở `dvc/captcha/` (`png.js` giải mã PNG, `solver.js` xử lý ảnh + k-NN, `model.json` mẫu khởi tạo ~1,9 MB),
  **viết thuần JavaScript, chạy trên máy, không gửi ảnh ra dịch vụ ngoài, không cần cài thêm gì.** Mất ~25 ms/ảnh.
- Các bước: bỏ khung → trừ nền theo từng cột → làm mờ 3×3 lấp nhiễu chải → phân ngưỡng → tách 5 ký tự (thành phần
  liên thông, gộp chấm chữ i, tách ký tự dính theo cột ít mực nhất) → mỗi ký tự thành lưới 16×16 + vị trí trong dòng
  (phân biệt o/0, p/q/g/y) → so k-NN (k=3) với thư viện mẫu.
- Mẫu khởi tạo: 5.400 mẫu gom từ 56.000 ký tự **tổng hợp** (10 font đậm, xoay, nhiễu giống cổng) + 13 captcha thật.
  Đo trên 13 ảnh thật với mô hình chỉ có mẫu tổng hợp: **~88–92% ký tự đúng, ~55–60% captcha đúng cả 5 ký tự**.
  Vì sai thì tự lấy mã mới thử lại (mặc định 3 lần), tỉ lệ qua được không cần người dùng ước tính ~90%.
- **Tự học**: mỗi captcha được cổng chấp nhận (tự đọc hay gõ tay) được lưu thành mẫu thật vào
  `data/captcha/learned.json` (chỉ lưu vector đặc trưng, tối đa 6.000 ký tự) và được ưu tiên gấp đôi mẫu tổng hợp —
  dùng càng nhiều càng đọc đúng. Xóa file này để học lại từ đầu.
- **An toàn tài khoản**: đăng nhập sai **mật khẩu** thì dừng ngay, không tự thử lại; chỉ thử lại khi cổng báo sai captcha.
  Lấy captcha dồn dập cổng trả `429 Too Many Requests` (đã gặp 11/2026) → phần mềm chờ 5 s, 10 s, 20 s rồi thử lại.
- Cấu hình (`.env`): `DVC_CAPTCHA_AUTO=0` để tắt hẳn (quay về nhập tay), `DVC_CAPTCHA_AUTO_TRIES=3` số lần tự thử/lượt.
- API: `GET /api/dvc/captcha` (trạng thái, số mẫu, thống kê đúng/sai trong phiên chạy),
  `POST /api/dvc/captcha/solve {base64}` (thử đọc 1 ảnh, không gọi cổng).
- Đo lại độ chính xác: `npm run captcha:eval` (thư mục ảnh đặt tên theo mã đúng, vd `2di7r.png`);
  thêm `--no-real` để đo khách quan chỉ với mẫu tổng hợp. Dựng lại `model.json`: xem đầu file `scripts/captcha/build_model.js`
  (cần Python + Pillow + numpy, chỉ dùng khi phát triển).

### Mức độ kiểm chứng (nói thẳng)
- **Đã kiểm chứng trên cổng thật** (bằng tài khoản người dùng đăng nhập sẵn trong trình duyệt): tên các trường đăng nhập,
  endpoint đăng nhập, cấu trúc bảng kết quả tab DVC, phân trang/size=100 không cần captcha mới, endpoint tải hồ sơ trả ZIP chứa XML.
- **Đã kiểm thử tự động** (`npm test`, 8 bài): bộ đọc bảng, chia khoảng ngày, giải nén, đọc XML, toàn bộ luồng đồng bộ
  (captcha sai/đúng, phân trang, tải file, hủy, phiên hết hạn, chạy lại tăng dần) với cổng giả lập; và **bộ kết nối
  Playwright thật** chạy với máy chủ giả lập HTTP mô phỏng cổng.
- **Chưa kiểm chứng trên cổng thật:** lệnh đăng nhập do phần mềm tự gửi (`loginLDAP`), và **tab Thuế điện tử cũ** (trước 01/07/2025)
  — cấu trúc bảng kết quả tab này mới suy ra từ mã JavaScript của trang. Lần chạy thật đầu tiên nên đặt `DVC_HEADLESS=0`
  để nhìn trình duyệt, và đồng bộ thử 1 tháng gần nhất trước.
- Chưa làm: tải "thông báo" của cơ quan thuế kèm từng hồ sơ (endpoint `tchs/downloadthongbao` đã thấy, chưa nối),
  đăng nhập bằng VNeID/chữ ký số, tài khoản đại lý thuế khai thay (MST ủy quyền).
- Cổng có thể chặn đăng nhập đồng thời: khi phần mềm đăng nhập, phiên đang mở trên trình duyệt khác có thể bị đăng xuất.

## Luồng thử end-to-end (khoảng 5 phút)

1. Mở trang, bấm **Nạp dữ liệu mẫu**. Hệ thống tạo công ty mẫu
   `0100000001 — Công ty TNHH Mẫu Dùng Thử` và 3 kỳ mẫu.
2. Chọn kỳ **2026-06** (TT80/2021), bấm **Tính tờ khai** và kiểm chứng:
   - Chỉ tiêu **27 = 15.000.000** (10.000.000 bán ra 10% + 5.000.000 bán ra 8%)
   - Chỉ tiêu **28 = 1.400.000**, **25 = 960.000**, **36 = 440.000**,
     **40 = 440.000**, **43 = 0**
   - Có **PL 142** vì có bán ra thuế suất 8%: [08] thuế được giảm 100.000
     (5.000.000 x 2%), [06] thuế mua vào 8% là 160.000, [09] = [08] − [06] = −60.000
   - Hóa đơn đã hủy 3.000.000 ở trạng thái BLOCKED, đóng góp 0.
3. Chọn kỳ **2026-07**, bấm **Tính tờ khai** và kiểm chứng:
   - Chỉ tiêu **32 = 27 = 15.000.000** (12.000.000 + 4.000.000 − 1.000.000 hàng bán
     bị trả lại, ghi âm ở nhóm 10%), **33 = 1.420.000**.
4. Chọn kỳ **2026-08** (chỉ mua vào giảm thuế), bấm **Tính tờ khai**:
   hệ thống **không sinh PL 142** và ghi rõ lý do.
5. Thử chống trùng: thêm lại hóa đơn `0100000001 / 1 / C26TAA / 0000001`
   vào kỳ 2026-06 — hệ thống trả lỗi 409, không tạo bản ghi mới.
6. Thử khóa kỳ + bổ sung: ở kỳ 2026-06 bấm **Khóa kỳ**, sau đó thử thêm
   hóa đơn vào kỳ đó — bị chặn 403. Bấm **Lập tờ khai bổ sung** với lý do
   và điều chỉnh 37/38 — bản chính thức đã khóa giữ nguyên, chỉ bản bổ sung
   mới mang 37/38.
7. Đối soát: ghi giấy nộp tiền GTGT 440.000 cho kỳ 2026-06 rồi bấm
   **Xem đối soát** — kết quả MATCHED. Ghi 300.000 thì kết quả UNDERPAID,
   còn thiếu 140.000.
8. Xuất file: tải XML HTKK, bảng kê CSV và bảng kê Excel `.xls` từ kỳ đã chọn.
   Kỳ chưa khóa thì file XML có tiền tố `NHAP-` trong tên file.
9. (Tùy chọn, làm trên kỳ chưa khóa hoặc sau khi xóa `data/db.json` và nạp
   lại mẫu) Thử import CSV: 1 dòng mới + 1 dòng trùng khóa với hóa đơn
   0000001 — kết quả: tạo 1, trùng 1, lỗi 0.

## Quy tắc tính (từ 0.3.0: theo nhãn chỉ tiêu HTKK 01/GTGT TT80)

- Mọi kỳ dùng mẫu **01/GTGT TT80** (HTKK maTKhai 842, bản 2.8.3). HTKK 5.8.2 chưa phát
  hành 01/GTGT TT89 nên ứng dụng không còn tự chuyển sang TT89 từ 07/2026.
- Engine ở `src/engines/gtgt01/` (xem `docs/buoc-2-kien-truc.md`). Bán ra: không chịu thuế
  -> [26]; 0% -> [29]; 5% -> [30]/[31]; 10% và 8% -> [32]/[33] (thuế thực tế trên hóa đơn);
  KKKNT -> [32a]. [27] = [29]+[30]+[32]+[32a]; [28] = [31]+[33]; [34] = [26]+[27]; [35] = [28];
  [36] = [35] − [25]; X = [36] − [22] + [37] − [38] − [39a]; [40a] = X nếu X ≥ 0;
  [40] = [40a] − [40b]; [41] = |X| nếu X < 0; [43] = [41] − [42].
- Chỉ tiêu **22** = chỉ tiêu **43** của tờ khai chính thức kỳ liền trước;
  kỳ đầu nhập tay (mặc định 0). Không lấy từ tờ khai bổ sung.
- Hàng bán bị trả lại (ô "Hàng bán bị trả lại") ghi số âm ở nhóm thuế suất tương ứng.
- File XML HTKK sinh theo XSD chính thức (`schemas/htkk/`), cần nhập đủ thông tin công ty
  (địa chỉ, mã/tên tỉnh, mã/tên cơ quan thuế) qua `PATCH /api/companies/:id`.
- Chỉ tiêu **37/38 chỉ từ tờ khai bổ sung** (nhập kèm lý do), không bao giờ
  tự sinh từ hóa đơn phát sinh trong kỳ hiện tại.
- **PL 142 chỉ sinh khi có bán ra thuế suất 8%.** Chỉ mua vào 8% thì không sinh
  và giao diện giải thích lý do. Thẻ XML `PLuc/PL_NQ142_GTGT` (dùng chung NQ 142/174/204).
- Máy trạng thái hóa đơn: RECEIVED (lúc nhận, nội bộ) → READY / WARNING /
  BLOCKED → INCLUDED (khi khóa kỳ). Hóa đơn WARNING phải được xác nhận
  mới tính vào tờ khai. Hóa đơn đã hủy ở BLOCKED, đóng góp 0.
  Hóa đơn gốc đã bị thay thế không tính trùng với hóa đơn thay thế.
- Khóa chống trùng: MST người bán + ký hiệu mẫu + ký hiệu hóa đơn + số hóa đơn
  (theo công ty). Trùng thì từ chối, không ghi đè.
- Kỳ đã khóa (LOCKED/FILED) không sửa trực tiếp được qua giao diện hay API;
  mọi sửa đi qua tờ khai bổ sung, bản chính thức giữ nguyên.

## API chính (đều trả JSON tiếng Việt khi lỗi)

- `GET /api/health` — kiểm tra sống
- `POST /api/seed` — nạp dữ liệu mẫu (chỉ tạo 1 lần)
- `POST /api/companies`, `GET /api/companies`
- `POST /api/periods`, `GET /api/periods`, `GET /api/periods/:id`
- `POST /api/periods/:id/invoices` — nhập tay
- `POST /api/periods/:id/invoices/import` — import CSV (JSON `{csv: "..."}`,
  header: `seller_tax_code,seller_name,template_symbol,symbol,invoice_number,issue_date,direction,kind,item_name,net_amount,vat_rate,vat_amount,total_amount,deductible,is_deduction`)
- `POST /api/periods/:id/invoices/:invId/ack-warning`
- `POST /api/periods/:id/declaration/calculate`
- `POST /api/periods/:id/lock`, `POST /api/periods/:id/filed`
- `POST /api/periods/:id/supplements` — `{reason, adj37, adj38, extra_invoices: []}`
- `POST /api/periods/:id/payments`, `GET /api/periods/:id/reconciliation`
- `GET /api/periods/:id/exports/htkk.xml`
- `GET /api/periods/:id/exports/ledger.csv`
- `GET /api/periods/:id/exports/ledger.xls`
- `GET /api/audit` — 200 nhật ký gần nhất

## Đã làm và chưa làm (nói thẳng)

**Đã làm (bản dùng thử, đã chạy thử bằng API thật):** thiết lập kỳ tháng/quý
với mẫu TT80/TT89 theo kỳ; nhập tay + import CSV + dữ liệu mẫu; máy trạng
thái RECEIVED → READY/WARNING/BLOCKED → INCLUDED; chống trùng; hủy/thay thế/
điều chỉnh không tính như hóa đơn thường; tính 01/GTGT (22/27/37/38/40/43);
bảng kê mua vào/bán ra; PL 142 theo đúng điều kiện kích hoạt; khóa kỳ +
tờ khai bổ sung; đối soát tờ khai với giấy nộp tiền theo từng loại thuế;
xuất XML HTKK (import only) và bảng kê CSV/XLS chung.

**Chưa làm (không có trong bản dùng thử):** tích hợp nhà cung cấp hóa đơn
tự động (không có lấy hóa đơn 70–80% nào); tra cứu MST hàng loạt; kiểm tra
rủi ro nhà cung cấp 3 mức; báo cáo tài chính đầy đủ; quyết toán TNCN đầy đủ
(chỉ ghi nhận và đối soát giấy nộp tiền TNCN); ký số và nộp thay lên cổng
thuế; mẫu Excel MISA Offline theo phiên bản cụ thể; phân quyền nhiều vai trò
theo MST (bản dùng thử là 1 người dùng, không đăng nhập).

**Chưa kiểm thử:** build Docker (máy này không có Docker — xem bên dưới);
import file XML thật vào HTKK thật; import file bảng kê vào MISA Offline thật.
Các kiểm thử này cần môi trường có Docker/HTKK/MISA và phải làm trước khi
dùng cho số liệu thật.

## Ghi chú triển khai

- Không có đăng nhập trong bản dùng thử: chỉ dùng nội bộ / mạng tin cậy,
  tuyệt đối không đưa dữ liệu thật lên bản này.
- Sao lưu trước khi nâng cấp: copy `data/db.json` và `server.js`.
