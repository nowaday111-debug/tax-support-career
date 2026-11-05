# Skill: Đồng bộ tờ khai từ Cổng thuế điện tử (DVC)
## Mục tiêu
Tự động đăng nhập cổng dịch vụ công thuế bằng tài khoản doanh nghiệp, tìm kiếm hồ sơ đã nộp theo khoảng thời gian, tải file ZIP hồ sơ và lưu theo MST và năm để các bước lập tờ khai, đối chiếu và xuất dữ liệu dùng lại.

## Quy tắc triển khai
1. Đăng nhập:
   - Gọi `/tthc/loginLDAP` với mật khẩu mã hóa base64, `doiTuong=DN`, kèm captcha.
   - Captcha (đăng nhập và tra cứu) do `dvc/captcha/solver.js` tự đọc trên máy (PNG 150x38, 5 ký tự a-z0-9, k-NN + mẫu `model.json`).
     Sai captcha thì lấy mã mới thử lại tối đa `DVC_CAPTCHA_AUTO_TRIES` (mặc định 3) lần rồi mới hỏi người dùng (ảnh kèm mã gợi ý).
     Sai mật khẩu thì dừng ngay, không thử lại. Captcha được cổng chấp nhận được học vào `data/captcha/learned.json`.
   - Lấy captcha dồn dập cổng trả 429: chờ lùi dần (5/10/20 s), không coi là hết phiên.
   - Giữ cookie phiên; phiên hết hạn thì báo lỗi và yêu cầu đăng nhập lại.
   - Từ chối đồng bộ nếu MST đăng nhập khác MST doanh nghiệp đã cấu hình.
2. Tìm kiếm hồ sơ:
   - `/tthc/ho-so/search` trả về HTML (htmx), phân tích bằng `dvc/parse.js`.
   - Mỗi truy vấn tối đa 30 ngày; khoảng dài hơn được chia thành nhiều cửa sổ. Phân trang bằng tham số size.
   - Tab thuế điện tử `POST /tthc/tchs/thuedientu` áp dụng cho hồ sơ trước 07/2025.
3. Tải hồ sơ:
   - `POST /tthc/tchs/downloadhoso` với header `X-XSRF-TOKEN`; phản hồi JSON có trường `content` là base64 của file ZIP.
   - Giải nén bằng `dvc/zip.js`; đọc chỉ tiêu bằng `dvc/xmlinfo.js` (mã, tên, kỳ, loại tờ khai và các chỉ tiêu `ctNN`).
   - Lưu vào `data/tokhai/<MST>/<năm>/`.
4. Đồng bộ gia tăng:
   - Mốc bắt đầu = ngày kết thúc lần thành công gần nhất trừ 7 ngày. Lần đầu lấy từ 01/01 của năm trước.
   - Upsert theo mã hồ sơ; đồng bộ lại thì cập nhật trạng thái, không tạo bản trùng.
   - Hỗ trợ hủy job; hủy giữa chừng không để lại bản ghi dở dang.
5. Chế độ chạy: `DVC_MODE=real` gọi cổng thật bằng adapter Playwright (`dvc/portal-playwright.js`, chạy `fetch` trong ngữ cảnh trang để cookie và CSRF do trình duyệt xử lý); `DVC_MODE=mock` dùng `dvc/portal-mock.js` hoặc `dvc/fake-portal-server.js` cho kiểm thử. Tài khoản thử của cổng giả lập: 0109999999.
6. Kiểm thử: `test/dvc.test.js` (8 bài) và `test/captcha.test.js` (11 bài: giải mã PNG, tách ký tự, độ chính xác trên 13 captcha thật, tự học, luồng tự điền/thử lại/sai mật khẩu/429) — đều đạt.

## Chưa xác minh / chưa làm
- POST đăng nhập thật và cấu trúc tab thuế điện tử trên cổng thật chưa được kiểm chứng.
- Chưa chạy Chromium trên cổng thật.
- Tải Báo cáo tài chính và Giấy nộp tiền (phương án giai đoạn 1) chưa có endpoint trong module; cần khảo sát trước khi viết.
