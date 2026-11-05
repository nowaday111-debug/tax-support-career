// Đọc thông tin chung từ file XML tờ khai (chuẩn XML hồ sơ thuế điện tử của cơ quan thuế:
// HSoThueDTu > HSoKhaiThue > TTinChung > TTinTKhaiThue > TKhaiThue / NNT; chỉ tiêu ở CTieuTKhaiChinh).
// Đọc "mềm": thiếu thẻ nào thì để null, không ném lỗi — cấu trúc có thể khác giữa các mẫu tờ khai.
const { text } = require('./parse');

function tag(xml, name) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'));
  return m ? text(m[1]) : null;
}
function block(xml, name) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'));
  return m ? m[1] : '';
}

function parseDeclarationXml(xmlBuf) {
  const xml = Buffer.isBuffer(xmlBuf) ? xmlBuf.toString('utf8') : String(xmlBuf);
  const tk = block(xml, 'TKhaiThue') || xml;
  const nnt = block(xml, 'NNT') || xml;
  const ky = block(tk, 'KyKKhaiThue') || tk;
  const info = {
    ma_tkhai: tag(tk, 'maTKhai'),
    ten_tkhai: tag(tk, 'tenTKhai'),
    mo_ta_bieu_mau: tag(tk, 'moTaBMau'),
    phien_ban: tag(tk, 'pbanTKhaiXML'),
    loai_tkhai: tag(tk, 'loaiTKhai'), // C = chính thức, B = bổ sung (theo chuẩn XML thuế)
    so_lan: tag(tk, 'soLan'),
    kieu_ky: tag(ky, 'kieuKy'), // M/Q/Y/D
    ky_kkhai: tag(ky, 'kyKKhai'),
    ky_tu_ngay: tag(ky, 'kyKKhaiTuNgay'),
    ky_den_ngay: tag(ky, 'kyKKhaiDenNgay'),
    mst: tag(nnt, 'mst'),
    ten_nnt: tag(nnt, 'tenNNT'),
    ngay_lap: tag(xml, 'ngayLapTKhai'),
    indicators: {},
  };
  // Chỉ tiêu dạng <ct22>..</ct22>, <ct40a>..</ct40a> trong phần tờ khai chính (nếu có)
  const main = block(xml, 'CTieuTKhaiChinh') || '';
  for (const m of main.matchAll(/<ct(\d+[a-z]?)\b[^>]*>([^<]*)<\/ct\1>/gi)) {
    const v = m[2].trim();
    info.indicators[m[1]] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return info;
}

module.exports = { parseDeclarationXml };
