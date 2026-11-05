// Đọc bảng kết quả "Tra cứu hồ sơ" của dichvucong.gdt.gov.vn (đoạn HTML do htmx trả về).
// Cấu trúc đã quan sát thực tế (11/2026) ở tab "Tra cứu hồ sơ đã nộp trên DVC":
//   thead: STT | Thao tác | Mã hồ sơ | Tên TTHC | Tờ khai | Kỳ tính thuế | Loại tờ khai |
//          Lần nộp bổ sung | Lần nộp (Tờ khai)/File số (DLVC) | Cơ quan thuế tiếp nhận |
//          Ngày nộp | Trạng thái | Hồ sơ đính kèm
//   mỗi <tr> có phần tử data-ma-ho-so="..."; dòng tổng: "Tổng số bản ghi: N".
// Bộ đọc ánh xạ cột THEO TÊN TIÊU ĐỀ (không theo vị trí cố định) để chịu được việc cổng thêm/bớt cột.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function text(html) {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function stripComments(html) { return html.replace(/<!--[\s\S]*?-->/g, ''); }
function stripScripts(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ''); }
function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}
function attr(html, name) {
  const m = html.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) || html.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? decode(m[1]) : null;
}

// Ánh xạ tiêu đề cột -> trường chuẩn. Thứ tự quan trọng: mẫu cụ thể đứng trước mẫu chung.
const HEADER_MAP = [
  [/^stt$/, null],
  [/thao tac/, null],
  [/^ma (ho so|giao dich)/, 'ma_ho_so'],
  [/ten tthc|thu tuc hanh chinh/, 'ten_tthc'],
  [/loai to khai/, 'loai_to_khai'],
  [/^(ten )?to khai$|^ten to khai|^mau to khai/, 'to_khai'],
  [/ky tinh thue|ky ke khai|^ky\b/, 'ky_tinh_thue'],
  [/lan nop bo sung|lan bo sung/, 'lan_bo_sung'],
  [/^lan nop/, 'lan_nop'],
  [/co quan thue/, 'co_quan_thue'],
  [/ngay nop|thoi gian nop/, 'ngay_nop'],
  [/trang thai/, 'trang_thai'],
  [/dinh kem/, null],
];
function fieldFor(header) {
  const h = norm(header);
  for (const [re, f] of HEADER_MAP) if (re.test(h)) return f;
  return 'col_' + h.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function toIsoDateTime(s) {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}` + (m[4] ? `T${m[4]}:${m[5]}:${m[6] || '00'}` : '');
}

function parseSearchResult(html) {
  const clean = stripScripts(stripComments(String(html || '')));
  const plain = text(clean);
  const totalM = plain.match(/T[ổo]ng s[ốo] b[ảa]n ghi:\s*(\d+)/i);
  const tableM = clean.match(/<table[\s\S]*?<\/table>/i);
  const result = { total: totalM ? Number(totalM[1]) : 0, headers: [], rows: [] };
  if (!tableM) return result;
  const table = tableM[0];
  const theadM = table.match(/<thead[\s\S]*?<\/thead>/i);
  const headSrc = theadM ? theadM[0] : (table.match(/<tr[\s\S]*?<\/tr>/i) || [''])[0];
  result.headers = [...headSrc.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1]));
  const fields = result.headers.map(fieldFor);
  const tbodyM = table.match(/<tbody[\s\S]*?<\/tbody>/i);
  const bodySrc = tbodyM ? tbodyM[0] : table.replace(headSrc, '');
  for (const trM of bodySrc.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tr = trM[0];
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
    if (cells.length < 3) continue; // dòng "Không có dữ liệu"
    const row = { raw: {} };
    cells.forEach((c, i) => {
      const f = fields[i];
      row.raw[result.headers[i] || `col${i}`] = c;
      if (f) row[f] = c;
    });
    // Mã hồ sơ: ưu tiên thuộc tính data-* (ổn định hơn text hiển thị)
    row.ma_ho_so = attr(tr, 'data-ma-ho-so') || attr(tr, 'data-mahoso') || row.ma_ho_so || null;
    // Tab "thuế điện tử" (trước 01/07/2025) dùng nút downloadHoSo với các thuộc tính này
    const loaiTraCuu = attr(tr, 'data-loaitracuu');
    if (loaiTraCuu) row.loai_tra_cuu = loaiTraCuu;
    if (/data-is-thue-dien-tu\s*=\s*"?true/i.test(tr)) row.is_thue_dien_tu = true;
    row.ngay_nop_iso = toIsoDateTime(row.ngay_nop);
    if (row.ma_ho_so) result.rows.push(row);
  }
  return result;
}

module.exports = { parseSearchResult, toIsoDateTime, norm, text };
