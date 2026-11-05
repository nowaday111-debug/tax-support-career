// Bộ kết nối THẬT tới dichvucong.gdt.gov.vn, chạy một trình duyệt Chromium (Playwright) trên máy của
// doanh nghiệp. Mọi yêu cầu được gửi TỪ BÊN TRONG trang của cổng (page.evaluate + fetch) nên cookie phiên,
// cookie chống bot (TS...) và token CSRF được trình duyệt tự xử lý giống hệt người dùng bấm tay.
//
// Endpoint đã quan sát trên cổng thật (11/2026):
//   GET  /tthc/login/getCaptcha?<ts>       ảnh captcha đăng nhập
//   POST /tthc/loginLDAP                   form: tenDN, matKhau=base64(utf8), doiTuong=DN|CN, captcha
//                                          -> JSON {status:'200'|'201', value, desc}
//   GET  /tthc/getCaptcha?<ts>             ảnh captcha trang tra cứu (sau khi đăng nhập)
//   GET  /tthc/ho-so/search?...            tra cứu hồ sơ đã nộp trên DVC (htmx, trả HTML); sai captcha -> HTTP 400
//                                          tối đa 30 ngày/lần; tham số page,size (size=100 hoạt động)
//   POST /tthc/tchs/thuedientu             tra cứu hồ sơ nộp trên thuế điện tử trước 01/07/2025
//   GET  /tthc/tchs/validateIdTkhai?idTKhai=<mã>  trang thật gọi trước khi tải; trả '200' | '400'
//   POST /tthc/tchs/downloadhoso           JSON {maHoSo}, header X-XSRF-TOKEN -> {fileName,fileType,content(base64 zip)}
//   !! Cổng CHỈ cho tải hồ sơ nằm trong KẾT QUẢ TRA CỨU GẦN NHẤT của phiên (kiểm chứng 06/11/2026): hồ sơ của
//      lần tra cứu trước -> validate '400', downloadhoso HTTP 500 {"error":"Hồ sơ truyền lên không hợp lệ"}.
//      => phải tải ngay sau mỗi lần tra cứu (sync.js lo việc này).
//   Gọi dồn dập -> HTTP 429 "Too Many Requests": chờ rồi thử lại.
//   POST /tthc/tchs/downloadhoso-tdt?loaiTraCuu=..  tương tự cho hồ sơ thuế điện tử cũ
//
// KHÔNG tự giải captcha: captcha luôn do người dùng nhập.

const DEFAULT_BASE = 'https://dichvucong.gdt.gov.vn';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RATE_LIMIT_WAITS = [5000, 15000, 30000];

class PlaywrightPortal {
  constructor(opts = {}) {
    this.base = (opts.baseUrl || process.env.DVC_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
    this.headless = opts.headless ?? (process.env.DVC_HEADLESS !== '0');
    this.timeoutMs = Number(process.env.DVC_TIMEOUT_MS || 45000);
    this.browser = null; this.context = null; this.page = null;
  }

  async open() {
    let chromium;
    try { ({ chromium } = require('playwright')); }
    catch { throw new Error('Chưa cài Playwright. Chạy: npm install && npx playwright install chromium'); }
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', acceptDownloads: false });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);
    await this.page.goto(this.base + '/tthc/login', { waitUntil: 'domcontentloaded' });
  }

  async _fetchImage(path) {
    const r = await this.page.evaluate(async (p) => {
      const res = await fetch(p + '?' + Date.now(), { cache: 'no-store', credentials: 'same-origin' });
      const bytes = new Uint8Array(await res.arrayBuffer());
      let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return { status: res.status, mime: res.headers.get('content-type') || 'image/png', base64: btoa(s), redirected: res.redirected, url: res.url };
    }, path);
    if (r.status !== 200 || /\/login(\?|$)/.test(new URL(r.url).pathname) && path !== '/tthc/login/getCaptcha')
      throw Object.assign(new Error('Không lấy được ảnh captcha (phiên có thể đã hết hạn)'), { code: 'SESSION_EXPIRED' });
    return { mime: r.mime.split(';')[0], base64: r.base64 };
  }

  getLoginCaptcha() { return this._fetchImage('/tthc/login/getCaptcha'); }

  async login({ username, password, captcha, doiTuong = 'DN' }) {
    const r = await this.page.evaluate(async ({ u, p, c, d }) => {
      const meta = n => document.querySelector(`meta[name=${n}]`)?.getAttribute('content');
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' };
      if (meta('csrf-header') && meta('csrf-token')) headers[meta('csrf-header')] = meta('csrf-token');
      const body = new URLSearchParams({ tenDN: u, matKhau: btoa(unescape(encodeURIComponent(p))), doiTuong: d, captcha: c });
      const res = await fetch('/tthc/loginLDAP', { method: 'POST', headers, body, credentials: 'same-origin' });
      const t = await res.text();
      try { return { http: res.status, json: JSON.parse(t) }; } catch { return { http: res.status, text: t.slice(0, 300) }; }
    }, { u: username, p: password, c: captcha, d: doiTuong });
    const j = r.json || {};
    if (!(j.status == '200' || j.status == '201')) {
      return { ok: false, message: j.desc || r.text || `Đăng nhập thất bại (HTTP ${r.http})` };
    }
    await this.page.goto(this.base + '/tthc/home', { waitUntil: 'domcontentloaded' });
    const who = await this.page.evaluate(() => ({
      isLogon: typeof isLogon !== 'undefined' ? isLogon : null,
      mst: typeof mst !== 'undefined' ? mst : null,
      ten: (document.querySelector('.ten_dn') || {}).textContent?.trim() || null,
    }));
    if (who.isLogon !== 'Y') return { ok: false, message: 'Cổng báo đăng nhập thành công nhưng trang chủ không ở trạng thái đã đăng nhập' };
    // Mở sẵn trang Tra cứu hồ sơ: có meta CSRF và là "nguồn" hợp lệ cho các yêu cầu tra cứu/tải về
    await this.page.goto(this.base + '/tthc/tchs', { waitUntil: 'domcontentloaded' });
    return { ok: true, mst: who.mst, ten: who.ten };
  }

  getSearchCaptcha() { return this._fetchImage('/tthc/getCaptcha'); }

  // q: {tuNgay, denNgay (DD/MM/YYYY), captcha, page, size}
  async searchDvc(q) {
    const params = {
      maNghiepVu: '', maTTHC: '', maToKhai: '', maHoSo: q.maHoSo || '', tuNgay: q.tuNgay, denNgay: q.denNgay,
      scope_tdt1: 'SELF', mstUyQuyen_tdt1: '', captcha: q.captcha || '', page: String(q.page || 1), size: String(q.size || 100),
    };
    return this._search(async (p) => {
      const res = await fetch('/tthc/ho-so/search?' + new URLSearchParams(p), {
        headers: { 'HX-Request': 'true', 'HX-Current-URL': location.href, 'HX-Target': 'table-container', accept: 'text/html-partial' },
        credentials: 'same-origin',
      });
      return { http: res.status, url: res.url, body: await res.text() };
    }, params);
  }

  async searchTdt(q) {
    const params = {
      page: q.page === undefined || q.page === null ? '' : String(q.page), size: q.size ? String(q.size) : '',
      maToKhai_tdt: '', maGiaoDichTthc_tdt: q.maHoSo || '', tuNgay_tdt: q.tuNgay, denNgay_tdt: q.denNgay,
      scope_tdt2: 'SELF', mstUyQuyen_tdt2: '', captcha: q.captcha || '',
    };
    return this._search(async (p) => {
      const meta = n => document.querySelector(`meta[name=${n}]`)?.getAttribute('content');
      const csrf = document.querySelector('#form_search_tdt input[name=_csrf]')?.value || meta('csrf-token') || '';
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'HX-Request': 'true', 'HX-Current-URL': location.href, accept: 'text/html-partial' };
      headers[meta('csrf-header') || 'X-XSRF-TOKEN'] = meta('csrf-token') || csrf;
      const res = await fetch('/tthc/tchs/thuedientu', { method: 'POST', headers, body: new URLSearchParams({ _csrf: csrf, ...p }), credentials: 'same-origin' });
      return { http: res.status, url: res.url, body: await res.text() };
    }, params);
  }

  async _search(fn, params) {
    let r;
    for (let i = 0; ; i++) {
      r = await this.page.evaluate(fn, params);
      if (!(r.http === 429 || /too many requests/i.test(r.body || '')) || i >= RATE_LIMIT_WAITS.length) break;
      await sleep(RATE_LIMIT_WAITS[i]);
    }
    if (r.http === 429) return { status: 'ERROR', message: 'Cổng báo gửi yêu cầu quá nhanh (HTTP 429), thử lại sau ít phút' };
    if (r.http === 200 && /\/login(\?|$)/.test(new URL(r.url).pathname)) return { status: 'SESSION_EXPIRED', message: 'Phiên đăng nhập đã hết hạn' };
    if (r.http === 200 && /name=["']tenDN["']/.test(r.body)) return { status: 'SESSION_EXPIRED', message: 'Phiên đăng nhập đã hết hạn' };
    if (r.http === 400) {
      const msg = r.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      // Cổng trả 400 cho cả sai captcha lẫn lỗi tham số; phân biệt theo nội dung thông báo
      if (!msg || /captcha/i.test(msg)) return { status: 'CAPTCHA', message: msg || 'Cần nhập captcha' };
      return { status: 'ERROR', message: msg };
    }
    if (r.http !== 200) return { status: 'ERROR', message: `Cổng trả HTTP ${r.http}` };
    return { status: 'OK', html: r.body };
  }

  // Chỉ gọi ngay sau lần tra cứu có chứa hồ sơ này (xem ghi chú đầu file).
  async download({ ma_ho_so, is_thue_dien_tu, loai_tra_cuu }) {
    const url = is_thue_dien_tu ? `/tthc/tchs/downloadhoso-tdt?loaiTraCuu=${encodeURIComponent(loai_tra_cuu || '')}` : '/tthc/tchs/downloadhoso';
    let r;
    for (let i = 0; ; i++) {
      r = await this.page.evaluate(async ({ url, m }) => {
        const meta = n => document.querySelector(`meta[name=${n}]`)?.getAttribute('content');
        const tk = document.querySelector("input[name='_csrf']")?.value || (typeof token !== 'undefined' && token) || meta('csrf-token') || '';
        // Giống nút "Tải xuống" trên trang thật: kiểm tra mã hồ sơ trước, hợp lệ mới tải
        const v = await fetch('/tthc/tchs/validateIdTkhai?idTKhai=' + encodeURIComponent(m), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const vt = (await v.text()).trim();
        if (v.status === 429 || /too many requests/i.test(vt)) return { http: 429, url: v.url };
        if (v.status === 200 && new URL(v.url).pathname.endsWith('/login')) return { http: 200, url: v.url, text: '' };
        if (v.status === 200 && vt !== '200' && vt.length < 10) return { http: 200, url: v.url, notListed: vt };
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': tk }, body: JSON.stringify({ maHoSo: m }), credentials: 'same-origin' });
        const t = await res.text();
        if (res.status === 429 || /too many requests/i.test(t)) return { http: 429, url: res.url };
        try { return { http: res.status, url: res.url, json: JSON.parse(t) }; } catch { return { http: res.status, url: res.url, text: t.slice(0, 200) }; }
      }, { url, m: ma_ho_so });
      if (r.http !== 429 || i >= RATE_LIMIT_WAITS.length) break;
      await sleep(RATE_LIMIT_WAITS[i]);
    }
    if (r.json && r.json.content) return { fileName: r.json.fileName, fileType: r.json.fileType, content: r.json.content };
    if (/\/login(\?|$)/.test(new URL(r.url).pathname)) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn'), { code: 'SESSION_EXPIRED' });
    if (r.http === 429) throw new Error('Cổng báo gửi yêu cầu quá nhanh (HTTP 429)');
    if (r.notListed) throw Object.assign(new Error(`Hồ sơ không nằm trong kết quả tra cứu gần nhất (validateIdTkhai=${r.notListed})`), { code: 'NOT_LISTED' });
    const msg = (r.json && (r.json.error || r.json.message)) || r.text || `Không có nội dung file (HTTP ${r.http})`;
    throw Object.assign(new Error(msg), /không hợp lệ/i.test(msg) ? { code: 'NOT_LISTED' } : {});
  }

  async close() {
    try { if (this.browser) await this.browser.close(); } catch { /* bỏ qua */ }
    this.browser = this.context = this.page = null;
  }
}

module.exports = { PlaywrightPortal, DEFAULT_BASE };
