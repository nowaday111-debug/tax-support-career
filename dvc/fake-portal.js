// CỔNG GIẢ LẬP dichvucong.gdt.gov.vn — CHỈ DÙNG ĐỂ DÙNG THỬ / KIỂM THỬ, dữ liệu hoàn toàn bịa.
// Mô phỏng đúng các hành vi đã quan sát trên cổng thật (11/2026):
//  - Đăng nhập: GET /tthc/login/getCaptcha, POST /tthc/loginLDAP {tenDN, matKhau(base64), doiTuong, captcha}
//    -> JSON {status:'200'|'201'|..., desc}
//  - Tra cứu DVC: GET /tthc/ho-so/search?tuNgay&denNgay(DD/MM/YYYY)&captcha&page&size
//    sai captcha -> HTTP 400 + thông báo; khoảng ngày > 30 ngày -> 400
//    cùng truy vấn đã qua captcha thì chuyển trang / đổi size KHÔNG cần captcha mới
//  - Tra cứu thuế điện tử (trước 01/07/2025): POST /tthc/tchs/thuedientu (form)
//  - Tải hồ sơ: POST /tthc/tchs/downloadhoso {maHoSo} (header X-XSRF-TOKEN) -> {fileName,fileType,content(base64 zip)}
const crypto = require('crypto');
const { zip } = require('./zip');

const FAKE_USER = { tenDN: '0109999999', matKhau: 'matkhau-thu', mst: '0109999999', ten: 'CÔNG TY TNHH MẪU DÙNG THỬ' };
const DVC_START = '2025-07-01';

function pad(n) { return String(n).padStart(2, '0'); }
function vnDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function isoFromVn(s) { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; }
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Sinh bộ hồ sơ giả: mỗi tháng 01/GTGT (tháng trước) + 05/KK-TNCN; mỗi quý BC26/AC; một bản bổ sung.
function buildFilings() {
  const list = [];
  let seq = 1000;
  const add = (date, tk, ky, opts = {}) => {
    seq += 7;
    const src = date < DVC_START ? 'TDT' : 'DVC';
    const ymd = date.replace(/-/g, '').slice(2);
    list.push({
      ma_ho_so: src === 'DVC' ? `G99.01-${ymd}-${String(seq).padStart(8, '0')}` : `11320${ymd}${String(seq).padStart(6, '0')}`,
      source: src, date, time: `${pad(8 + (seq % 9))}:${pad(seq % 60)}`, tk, ky,
      loai: opts.bs ? 'Bổ sung' : 'Chính thức', lan_bs: opts.bs ? 1 : 0,
      trang_thai: opts.status || 'Đã chấp nhận',
    });
  };
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 10) break;
      const prev = m === 1 ? `12/${y - 1}` : `${pad(m - 1)}/${y}`;
      add(`${y}-${pad(m)}-${pad(10 + (m % 8))}`, { ma: '842', ten: '01/GTGT - Tờ khai thuế giá trị gia tăng (TT80/2021)' }, prev);
      add(`${y}-${pad(m)}-${pad(12 + (m % 6))}`, { ma: '864', ten: '05/KK-TNCN - Tờ khai thuế thu nhập cá nhân (TT80/2021)' }, prev);
      if ([1, 4, 7, 10].includes(m)) {
        const q = m === 1 ? `Q4/${y - 1}` : `Q${(m - 1) / 3}/${y}`;
        add(`${y}-${pad(m)}-${pad(20 + (m % 5))}`, { ma: '1180', ten: 'BC26/AC - Báo cáo tình hình sử dụng hóa đơn' }, q);
      }
    }
  }
  add('2026-09-25', { ma: '842', ten: '01/GTGT - Tờ khai thuế giá trị gia tăng (TT80/2021)' }, '07/2026', { bs: true, status: 'Đã tiếp nhận' });
  // Đủ nhiều bản ghi trong 1 cửa sổ để kiểm thử phân trang (size 10)
  for (let i = 0; i < 12; i++) add(`2026-09-${pad(1 + i)}`, { ma: '1180', ten: 'BC26/AC - Báo cáo tình hình sử dụng hóa đơn' }, `Q${1 + (i % 2)}/2026`);
  return list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

function declarationXml(f) {
  const [kyA, kyB] = f.ky.split('/');
  const kieu = f.ky.startsWith('Q') ? 'Q' : 'M';
  const ct = f.tk.ma === '842'
    ? '<CTieuTKhaiChinh><ct21>0</ct21><ct22>0</ct22><ct23>8000000</ct23><ct24>800000</ct24><ct25>800000</ct25><ct34>15000000</ct34><ct35>1400000</ct35><ct36>600000</ct36><ct40a>600000</ct40a><ct40>600000</ct40><ct43>0</ct43></CTieuTKhaiChinh>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu><HSoKhaiThue id="_NODE_TO_SIGN"><TTinChung><TTinDVu><maDVu>GIA_LAP</maDVu></TTinDVu>
<TTinTKhaiThue><TKhaiThue><maTKhai>${f.tk.ma}</maTKhai><tenTKhai>${esc(f.tk.ten)}</tenTKhai><moTaBMau>(Dữ liệu giả lập)</moTaBMau><pbanTKhaiXML>2.0.0</pbanTKhaiXML>
<loaiTKhai>${f.lan_bs ? 'B' : 'C'}</loaiTKhai><soLan>${f.lan_bs}</soLan><KyKKhaiThue><kieuKy>${kieu}</kieuKy><kyKKhai>${esc(f.ky)}</kyKKhai><kyKKhaiTuNgay>01/${kieu === 'M' ? kyA : '01'}/${kyB}</kyKKhaiTuNgay><kyKKhaiDenNgay>28/${kieu === 'M' ? kyA : '03'}/${kyB}</kyKKhaiDenNgay></KyKKhaiThue>
<ngayLapTKhai>${f.date}</ngayLapTKhai></TKhaiThue>
<NNT><mst>${FAKE_USER.mst}</mst><tenNNT>${esc(FAKE_USER.ten)}</tenNNT></NNT></TTinTKhaiThue></TTinChung>
${ct}</HSoKhaiThue></HSoThueDTu>`;
}

function dvcTableHtml(rows, total, page, size) {
  const totalPage = Math.max(1, Math.ceil(total / size));
  const pages = Array.from({ length: totalPage }, (_, i) => `<li class="page-item ${i + 1 === page ? 'active' : ''}"><a class="page-link" onclick="onChangePage(${i + 1},${size})">${i + 1}</a></li>`).join('');
  const body = rows.map((f, i) => `<tr>
    <td class="align-middle text-center labelTableBody">${(page - 1) * size + i + 1}</td>
    <td class="align-middle text-center labelTableBody"><i class="bi bi-eye" onclick="viewDetail(this)" data-ma-ho-so="${esc(f.ma_ho_so)}"></i></td>
    <td class="align-middle labelTableBody">${esc(f.ma_ho_so)}</td>
    <td class="text-start labelTableBody"><a href="javascript:void(0);" onclick="viewDetail(this)" data-ma-ho-so="${esc(f.ma_ho_so)}"><span>9.999999 - Thủ tục khác</span></a></td>
    <!--doi voi to khai 02 GTGT thi hien thi them ma hso du an cho nguoi dung de chon-->
    <td class="text-start labelTableBody">${esc(f.tk.ten)}</td>
    <td class="align-middle labelTableBody">${esc(f.ky)}</td>
    <td class="align-middle labelTableBody">${f.loai}</td>
    <td class="align-middle labelTableBody">${f.lan_bs}</td>
    <td class="align-middle labelTableBody">1</td>
    <td class="align-middle labelTableBody">99999 - Thuế cơ sở GIẢ LẬP</td>
    <td class="align-middle labelTableBody">${vnDate(f.date)} ${f.time}</td>
    <td class="align-middle labelTableBody"><span class="badge bg-success">${esc(f.trang_thai)}</span><br></td>
    <!-- <td class="align-middle labelTableBody"><a>Xem tài liệu</a></td> -->
  </tr>`).join('\n');
  return `<div id="table-container"><div class="d-flex">Trang ${page}/<span id="totalPage">${totalPage}</span> - Tổng số bản ghi: ${total}
  <ul class="pagination mb-0">${pages}</ul></div>
  <table class="table"><thead><tr><th>STT</th><th>Thao tác</th><th>Mã hồ sơ</th><th>Tên TTHC</th><th>Tờ khai</th><th>Kỳ tính thuế</th><th>Loại tờ khai</th><th>Lần nộp bổ sung</th><th>Lần nộp (Tờ khai)/File số (DLVC)</th><th>Cơ quan thuế tiếp nhận</th><th>Ngày nộp</th><th>Trạng thái</th><th>Hồ sơ đính kèm</th></tr></thead>
  <tbody>${body || '<tr><td colspan="13">Không có dữ liệu</td></tr>'}</tbody></table></div>`;
}

// Bảng tab "thuế điện tử" — cấu trúc trên cổng thật CHƯA được quan sát, giả lập theo các hàm JS của trang
// (changePage_tdt(el) dùng data-page/data-size; downloadHoSo(el) dùng data-mahoso, data-loaitracuu, data-is-thue-dien-tu)
function tdtTableHtml(rows, total, page, size) {
  const totalPage = Math.max(1, Math.ceil(total / size));
  const pages = Array.from({ length: totalPage }, (_, i) => `<a class="page-link" onclick="changePage_tdt(this)" data-page="${i}" data-size="${size}">${i + 1}</a>`).join('');
  const body = rows.map((f, i) => `<tr><td>${page * size + i + 1}</td>
    <td><i class="bi bi-download" onclick="downloadHoSo(this)" data-mahoso="${esc(f.ma_ho_so)}" data-loaitracuu="1" data-is-thue-dien-tu="true"></i></td>
    <td>${esc(f.ma_ho_so)}</td><td>${esc(f.tk.ten)}</td><td>${esc(f.ky)}</td><td>${f.loai}</td><td>${f.lan_bs}</td>
    <td>${vnDate(f.date)} ${f.time}</td><td>${esc(f.trang_thai)}</td></tr>`).join('\n');
  return `<div><div class="bangKetQuaTraCuu_tdt">${pages} Tổng số bản ghi: ${total}</div>
  <div class="table-responsive"><table><thead><tr><th>STT</th><th>Thao tác</th><th>Mã giao dịch</th><th>Tờ khai</th><th>Kỳ tính thuế</th><th>Loại tờ khai</th><th>Lần nộp bổ sung</th><th>Ngày nộp</th><th>Trạng thái</th></tr></thead>
  <tbody>${body}</tbody></table></div></div>`;
}

function captchaSvg(code) {
  const chars = code.split('').map((c, i) => `<text x="${14 + i * 22}" y="${30 + ((i * 7) % 9)}" font-size="26" font-family="monospace" transform="rotate(${(i % 2 ? 8 : -8)} ${14 + i * 22} 30)">${c}</text>`).join('');
  const lines = [0, 1, 2].map(i => `<line x1="0" y1="${10 + i * 12}" x2="140" y2="${30 - i * 8}" stroke="#999"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="44"><rect width="140" height="44" fill="#f2f2f2"/>${lines}${chars}</svg>`);
}

class FakePortalBackend {
  constructor() {
    this.filings = buildFilings();
    this.sessions = new Map(); // sid -> {captcha, loggedIn, verifiedQuery, csrf}
    this.requestLog = [];
  }
  newSid() { const sid = crypto.randomBytes(12).toString('hex'); this.sessions.set(sid, { captcha: null, loggedIn: false, verifiedQuery: null, listed: null, csrf: crypto.randomBytes(16).toString('hex') }); return sid; }
  sess(sid) { return this.sessions.get(sid); }
  newCaptcha(sid) { const s = this.sess(sid); s.captcha = Array.from({ length: 5 }, () => 'abcdefghkmnpqrstuvwxyz23456789'[crypto.randomInt(30)]).join(''); return { mime: 'image/svg+xml', body: captchaSvg(s.captcha) }; }
  peekCaptcha(sid) { return this.sess(sid)?.captcha; } // chỉ dùng trong kiểm thử tự động
  login(sid, { tenDN, matKhau, doiTuong, captcha }) {
    const s = this.sess(sid);
    if (!s.captcha || captcha !== s.captcha) { s.captcha = null; return { status: '400', desc: 'Mã captcha không chính xác' }; }
    s.captcha = null;
    let pw = '';
    try { pw = Buffer.from(String(matKhau || ''), 'base64').toString('utf8'); } catch { pw = ''; }
    if (doiTuong !== 'DN' || tenDN !== FAKE_USER.tenDN || pw !== FAKE_USER.matKhau) return { status: '401', desc: 'Thông tin tên đăng nhập hoặc mật khẩu chưa đúng' };
    s.loggedIn = true;
    return { status: '200', desc: 'OK' };
  }
  // q: {tuNgay, denNgay, captcha, page, size}; source 'DVC' | 'TDT'
  search(sid, q, source) {
    const s = this.sess(sid);
    if (!s || !s.loggedIn) return { http: 302, body: 'login' };
    const from = isoFromVn(q.tuNgay), to = isoFromVn(q.denNgay);
    if (!from || !to || from > to) return { http: 400, body: 'Khoảng thời gian không hợp lệ' };
    if (daysBetween(from, to) > 30) return { http: 400, body: 'Khoảng thời gian tìm kiếm không được quá 30 ngày!' };
    const key = `${source}|${from}|${to}`;
    if (q.captcha) {
      if (q.captcha !== s.captcha) { s.captcha = null; return { http: 400, body: 'Mã captcha không chính xác' }; }
      s.captcha = null; s.verifiedQuery = key;
    } else if (s.verifiedQuery !== key) {
      return { http: 400, body: 'Vui lòng nhập mã captcha' };
    }
    const all = this.filings.filter(f => f.source === source && f.date >= from && f.date <= to && (!q.maHoSo || f.ma_ho_so === q.maHoSo));
    const size = Number(q.size) || 10;
    // Như cổng thật (đã kiểm chứng 11/2026): phiên chỉ cho tải những hồ sơ nằm trong KẾT QUẢ TRA CỨU GẦN NHẤT.
    const remember = rows => { s.listed = new Set(rows.map(f => f.ma_ho_so)); return rows; };
    if (source === 'DVC') {
      const page = Number(q.page) || 1;
      return { http: 200, body: dvcTableHtml(remember(all.slice((page - 1) * size, page * size)), all.length, page, size) };
    }
    const page = Number(q.page) || 0; // tab TĐT đánh số trang từ 0 (giả định)
    return { http: 200, body: tdtTableHtml(remember(all.slice(page * size, (page + 1) * size)), all.length, page, size) };
  }
  // GET /tthc/tchs/validateIdTkhai?idTKhai=... -> '200' nếu hồ sơ thuộc kết quả tra cứu gần nhất, ngược lại '400'
  validateIdTkhai(sid, maHoSo) {
    const s = this.sess(sid);
    if (!s || !s.loggedIn) return { http: 302, body: '' };
    return { http: 200, body: s.listed && s.listed.has(maHoSo) ? '200' : '400' };
  }
  download(sid, maHoSo, csrf) {
    const s = this.sess(sid);
    if (!s || !s.loggedIn) return { http: 302, json: null };
    if (csrf !== s.csrf) return { http: 403, json: { error: 'CSRF không hợp lệ' } };
    if (!s.listed || !s.listed.has(maHoSo)) return { http: 500, json: { error: 'Hồ sơ truyền lên không hợp lệ' } };
    const f = this.filings.find(x => x.ma_ho_so === maHoSo);
    if (!f) return { http: 200, json: { fileName: null, fileType: null, content: null } };
    const z = zip([{ name: `files_${maHoSo}_0.xml`, data: declarationXml(f) }]);
    return { http: 200, json: { fileName: `files_${maHoSo}.zip`, fileType: 'application/zip', content: z.toString('base64') } };
  }
}

module.exports = { FakePortalBackend, FAKE_USER, DVC_START, vnDate, isoFromVn };
