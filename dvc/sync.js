// Quản lý phiên đăng nhập dichvucong và tác vụ đồng bộ tờ khai về máy.
// - Mỗi phiên = 1 trình duyệt (hoặc bộ giả lập) đăng nhập bằng tài khoản của chính doanh nghiệp.
// - Captcha LUÔN do người dùng nhập: khi cổng đòi captcha, tác vụ dừng ở trạng thái NEED_CAPTCHA,
//   giao diện hiện ảnh captcha, người dùng gõ, tác vụ chạy tiếp.
// - Mật khẩu chỉ đi qua bộ nhớ để gửi lên cổng 1 lần, không lưu, không ghi log.
const fs = require('fs');
const path = require('path');
const { parseSearchResult } = require('./parse');
const { parseDeclarationXml } = require('./xmlinfo');
const { unzip } = require('./zip');

const DVC_START = '2025-07-01'; // trước ngày này: tra cứu ở tab "thuế điện tử"
const MAX_DAYS = 30;            // cổng chặn khoảng tìm kiếm > 30 ngày

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function vn(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chia [from, to] thành các cửa sổ ≤ 30 ngày (to - from ≤ 30), tách tại mốc 01/07/2025; mới nhất trước.
function buildWindows(from, to, { maxDays = MAX_DAYS, boundary = DVC_START, sources = ['DVC', 'TDT'] } = {}) {
  const out = [];
  let end = to;
  while (end >= from) {
    const src = end >= boundary ? 'DVC' : 'TDT';
    let start = addDays(end, -maxDays);
    if (start < from) start = from;
    if (src === 'DVC' && start < boundary) start = boundary;
    if (sources.includes(src)) out.push({ source: src, from: start, to: end });
    end = addDays(start, -1);
  }
  return out;
}

function tdtPages(html) {
  const pages = new Map();
  for (const m of String(html).matchAll(/changePage_tdt\(this\)[^>]*?data-page="(\d+)"[^>]*?data-size="(\d+)"/g)) pages.set(m[1], Number(m[2]));
  for (const m of String(html).matchAll(/data-page="(\d+)"[^>]*?data-size="(\d+)"[^>]*?changePage_tdt/g)) pages.set(m[1], Number(m[2]));
  return [...pages.entries()].map(([page, size]) => ({ page, size }));
}

function safeName(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120); }

class DvcManager {
  constructor(ctx) {
    this.ctx = ctx; // {getDb, saveDb, audit, uid, dataDir, portalFactory, delayMs, captchaTimeoutMs, idleMs}
    this.sessions = new Map();
    this.jobs = new Map();
    this.delayMs = ctx.delayMs ?? Number(process.env.DVC_DELAY_MS || 1200);
    this.captchaTimeoutMs = ctx.captchaTimeoutMs ?? 10 * 60 * 1000;
    this.idleMs = ctx.idleMs ?? 30 * 60 * 1000;
    this.pageSize = ctx.pageSize ?? 100; // cổng thật chấp nhận size=100 (đã thử 11/2026)
    const db = ctx.getDb();
    db.filings ||= []; db.dvc_sync_runs ||= [];
    this.timer = setInterval(() => this.cleanupIdle().catch(() => {}), 60 * 1000);
    this.timer.unref?.();
  }

  // ---------- Phiên đăng nhập ----------
  async createSession({ company_id, username, doiTuong = 'DN' }) {
    if (!username || !String(username).trim()) throw httpErr(400, 'Cần tên đăng nhập (thường là MST)');
    if (company_id && !this.ctx.getDb().companies.find(c => c.id === company_id)) throw httpErr(400, 'Không tìm thấy công ty');
    const portal = this.ctx.portalFactory();
    await portal.open();
    const s = { id: this.ctx.uid(), company_id: company_id || null, username: String(username).trim(), doiTuong, portal, state: 'AWAITING_LOGIN', mst: null, ten: null, created_at: new Date().toISOString(), last_used: Date.now(), job_id: null };
    this.sessions.set(s.id, s);
    const captcha = await portal.getLoginCaptcha();
    return { session: this.publicSession(s), captcha };
  }
  getSession(id) { const s = this.sessions.get(id); if (!s) throw httpErr(404, 'Không tìm thấy phiên (có thể đã đóng do không dùng quá lâu)'); s.last_used = Date.now(); return s; }
  async refreshLoginCaptcha(id) { const s = this.getSession(id); if (s.state !== 'AWAITING_LOGIN') throw httpErr(400, 'Phiên không ở bước đăng nhập'); return s.portal.getLoginCaptcha(); }

  async login(id, { password, captcha }) {
    const s = this.getSession(id);
    if (s.state !== 'AWAITING_LOGIN') throw httpErr(400, 'Phiên đã đăng nhập hoặc đã đóng');
    if (!password || !captcha) throw httpErr(400, 'Cần mật khẩu và mã captcha');
    const r = await s.portal.login({ username: s.username, password, captcha: String(captcha).trim(), doiTuong: s.doiTuong });
    if (!r.ok) {
      this.ctx.audit('DVC_LOGIN_FAILED', 'dvc_session', s.id, `${s.username}: ${r.message}`);
      return { ok: false, message: r.message, captcha: await s.portal.getLoginCaptcha().catch(() => null) };
    }
    const db = this.ctx.getDb();
    const mst = r.mst || s.username;
    let company = s.company_id ? db.companies.find(c => c.id === s.company_id) : db.companies.find(c => c.tax_code === mst);
    if (company && company.tax_code !== mst) {
      await this.closeSession(s.id);
      return { ok: false, message: `Tài khoản đăng nhập thuộc MST ${mst}, khác MST ${company.tax_code} của công ty đã chọn. Đã đóng phiên để tránh lẫn dữ liệu.` };
    }
    if (!company) {
      company = { id: this.ctx.uid(), tax_code: mst, name: r.ten || `Doanh nghiệp ${mst}`, is_sample: !!this.ctx.isMock, created_at: new Date().toISOString() };
      db.companies.push(company); this.ctx.saveDb();
      this.ctx.audit('CREATE_COMPANY', 'company', company.id, `${mst} (từ đăng nhập dichvucong)`);
    }
    Object.assign(s, { state: 'LOGGED_IN', mst, ten: r.ten || company.name, company_id: company.id });
    this.ctx.audit('DVC_LOGIN', 'dvc_session', s.id, `${s.username} -> MST ${mst}`);
    return { ok: true, session: this.publicSession(s), suggested_from: this.suggestFrom(company.id) };
  }

  async closeSession(id) {
    const s = this.sessions.get(id); if (!s) return;
    const job = s.job_id && this.jobs.get(s.job_id);
    if (job && ['RUNNING', 'NEED_CAPTCHA'].includes(job.state)) this.cancel(job.id);
    s.state = 'CLOSED';
    await s.portal.close();
    this.sessions.delete(id);
  }
  async cleanupIdle() {
    for (const s of this.sessions.values()) {
      const job = s.job_id && this.jobs.get(s.job_id);
      const busy = job && ['RUNNING', 'NEED_CAPTCHA'].includes(job.state);
      if (!busy && Date.now() - s.last_used > this.idleMs) await this.closeSession(s.id);
    }
  }
  publicSession(s) { return { id: s.id, state: s.state, username: s.username, mst: s.mst, ten: s.ten, company_id: s.company_id, job_id: s.job_id, created_at: s.created_at }; }

  // Đồng bộ lần sau: từ ngày "đến" của lần chạy thành công gần nhất lùi 7 ngày (để cập nhật trạng thái hồ sơ
  // vừa nộp, ví dụ "Đã tiếp nhận" -> "Đã chấp nhận"); lần đầu: từ 01/01 năm trước.
  suggestFrom(companyId) {
    const runs = this.ctx.getDb().dvc_sync_runs.filter(r => r.company_id === companyId && r.state === 'DONE').sort((a, b) => b.to.localeCompare(a.to));
    if (runs.length) return addDays(runs[0].to, -7);
    return `${new Date().getFullYear() - 1}-01-01`;
  }

  // ---------- Tác vụ đồng bộ ----------
  startSync(sessionId, { from, to, download = true, sources = ['DVC', 'TDT'] } = {}) {
    const s = this.getSession(sessionId);
    if (s.state !== 'LOGGED_IN') throw httpErr(400, 'Phiên chưa đăng nhập hoặc đã hết hạn — hãy đăng nhập lại');
    const cur = s.job_id && this.jobs.get(s.job_id);
    if (cur && ['RUNNING', 'NEED_CAPTCHA'].includes(cur.state)) throw httpErr(409, 'Phiên này đang có tác vụ đồng bộ chạy');
    const today = new Date().toISOString().slice(0, 10);
    to = to || today; from = from || this.suggestFrom(s.company_id);
    if (!isIsoDate(from) || !isIsoDate(to)) throw httpErr(400, 'Ngày phải theo định dạng YYYY-MM-DD');
    if (from > to) throw httpErr(400, 'Từ ngày phải nhỏ hơn hoặc bằng đến ngày');
    if (to > today) to = today;
    const windows = buildWindows(from, to, { sources });
    const job = {
      id: this.ctx.uid(), session_id: s.id, company_id: s.company_id, mst: s.mst, from, to, download, state: 'RUNNING',
      windows, window_index: 0, captcha: null, captcha_message: null, waiter: null, cancelled: false,
      counts: { windows_total: windows.length, windows_done: 0, found: 0, new: 0, updated: 0, downloaded: 0, download_failed: 0, captchas_entered: 0 },
      log: [], error: null, started_at: new Date().toISOString(), finished_at: null,
    };
    this.jobs.set(job.id, job); s.job_id = job.id;
    this.log(job, `Bắt đầu đồng bộ ${vn(from)} – ${vn(to)}: ${windows.length} khoảng tra cứu (mỗi khoảng ≤ 30 ngày).`);
    this.ctx.audit('DVC_SYNC_START', 'company', s.company_id, `${from}..${to}`);
    this.run(job, s).catch(e => this.fail(job, e));
    return this.publicJob(job);
  }

  // Cổng chỉ cho tải hồ sơ thuộc KẾT QUẢ TRA CỨU GẦN NHẤT của phiên, nên file được tải ngay sau mỗi trang
  // kết quả (không dồn tới cuối như trước — khi đó chỉ còn trang cuối hợp lệ, mọi hồ sơ khác báo
  // "Hồ sơ truyền lên không hợp lệ").
  async run(job, s) {
    job.attempted = new Set();
    for (; job.window_index < job.windows.length; job.window_index++) {
      this.checkCancel(job);
      const w = job.windows[job.window_index];
      let created = 0, updated = 0;
      const rows = await this.searchWindow(job, s, w, async pageRows => {
        const st = this.upsertFilings(job, w.source, pageRows);
        created += st.created; updated += st.updated;
        if (job.download) await this.downloadRows(job, s, pageRows);
      });
      job.counts.found += rows.length; job.counts.new += created; job.counts.updated += updated;
      this.log(job, `[${w.source === 'DVC' ? 'DVC' : 'Thuế ĐT'}] ${vn(w.from)} – ${vn(w.to)}: ${rows.length} hồ sơ (${created} mới, ${updated} đổi trạng thái).`);
      job.counts.windows_done++;
    }
    if (job.download) await this.downloadLeftovers(job, s);
    job.state = 'DONE'; job.finished_at = new Date().toISOString();
    this.log(job, `Hoàn tất: ${job.counts.found} hồ sơ, ${job.counts.new} mới, đã tải ${job.counts.downloaded} file, lỗi tải ${job.counts.download_failed}.`);
    this.saveRun(job);
  }

  // Gọi tìm kiếm có xử lý captcha: thử gửi; nếu cổng đòi captcha thì hỏi người dùng rồi gửi lại.
  async callWithCaptcha(job, s, fn) {
    let captcha = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      this.checkCancel(job);
      const r = await fn(captcha);
      await sleep(this.delayMs);
      if (r.status === 'OK') return r;
      if (r.status === 'SESSION_EXPIRED') { s.state = 'EXPIRED'; throw new Error('Phiên đăng nhập dichvucong đã hết hạn — hãy đăng nhập lại rồi bấm Đồng bộ (dữ liệu đã lấy được vẫn giữ nguyên).'); }
      if (r.status === 'CAPTCHA') {
        captcha = await this.askCaptcha(job, s, captcha ? `Mã captcha chưa đúng (${r.message}). Nhập lại:` : 'Cổng yêu cầu nhập captcha để tra cứu:');
        continue;
      }
      throw new Error(`Cổng báo lỗi: ${r.message}`);
    }
    throw new Error('Nhập sai captcha quá nhiều lần');
  }

  // onPage(rows): gọi ngay sau MỖI lần tra cứu (mỗi trang) — lúc phiên còn cho tải đúng các hồ sơ đó
  async searchWindow(job, s, w, onPage = async () => {}) {
    const byId = new Map();
    const q = { tuNgay: vn(w.from), denNgay: vn(w.to), ...(w.maHoSo ? { maHoSo: w.maHoSo } : {}) };
    if (w.source === 'DVC') {
      const size = this.pageSize;
      let page = 1, total = 0;
      do {
        const r = await this.callWithCaptcha(job, s, captcha => s.portal.searchDvc({ ...q, page, size, captcha }));
        const parsed = parseSearchResult(r.html);
        total = parsed.total || parsed.rows.length;
        parsed.rows.forEach(x => byId.set(x.ma_ho_so, x));
        if (parsed.rows.length) await onPage(parsed.rows);
        if (!parsed.rows.length) break;
        page++;
      } while ((page - 1) * size < total);
    } else {
      const first = await this.callWithCaptcha(job, s, captcha => s.portal.searchTdt({ ...q, page: null, size: null, captcha }));
      const firstRows = parseSearchResult(first.html).rows;
      firstRows.forEach(x => byId.set(x.ma_ho_so, x));
      if (firstRows.length) await onPage(firstRows);
      for (const p of tdtPages(first.html)) {
        const r = await this.callWithCaptcha(job, s, captcha => s.portal.searchTdt({ ...q, page: p.page, size: p.size, captcha }));
        const rows = parseSearchResult(r.html).rows;
        rows.forEach(x => byId.set(x.ma_ho_so, x));
        if (rows.length) await onPage(rows);
      }
    }
    return [...byId.values()];
  }

  upsertFilings(job, source, rows) {
    const db = this.ctx.getDb();
    let created = 0, updated = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
      const fields = {
        source, ten_tthc: r.ten_tthc || null, to_khai: r.to_khai || null, ky_tinh_thue: r.ky_tinh_thue || null,
        loai_to_khai: r.loai_to_khai || null, lan_bo_sung: r.lan_bo_sung ?? null, lan_nop: r.lan_nop ?? null,
        co_quan_thue: r.co_quan_thue || null, ngay_nop: r.ngay_nop || null, ngay_nop_iso: r.ngay_nop_iso || null,
        trang_thai: r.trang_thai || null, loai_tra_cuu: r.loai_tra_cuu || null, is_thue_dien_tu: !!r.is_thue_dien_tu || source === 'TDT', raw: r.raw,
      };
      const ex = db.filings.find(f => f.company_id === job.company_id && f.ma_ho_so === r.ma_ho_so);
      if (!ex) {
        db.filings.push({ id: this.ctx.uid(), company_id: job.company_id, mst: job.mst, ma_ho_so: r.ma_ho_so, ...fields, file: null, xml_info: null, download_error: null, first_seen_at: now, updated_at: now });
        created++;
      } else {
        if (ex.trang_thai !== fields.trang_thai) { ex.status_history ||= []; ex.status_history.push({ at: now, from: ex.trang_thai, to: fields.trang_thai }); updated++; }
        Object.assign(ex, fields, { updated_at: now });
      }
    }
    this.ctx.saveDb();
    return { created, updated };
  }

  // Tải các hồ sơ (trong kết quả tra cứu vừa nhận) chưa có file. Mỗi hồ sơ thử tối đa 1 lần/tác vụ.
  async downloadRows(job, s, rows) {
    const db = this.ctx.getDb();
    for (const r of rows) {
      const f = db.filings.find(x => x.company_id === job.company_id && x.ma_ho_so === r.ma_ho_so);
      if (!f || f.file || job.attempted.has(f.ma_ho_so)) continue;
      this.checkCancel(job);
      job.attempted.add(f.ma_ho_so);
      job.counts.download_total = (job.counts.download_total || 0) + 1;
      try {
        const res = await s.portal.download(f);
        this.saveFile(f, res);
        f.download_error = null; job.counts.downloaded++;
      } catch (e) {
        if (e.code === 'SESSION_EXPIRED') { s.state = 'EXPIRED'; this.ctx.saveDb(); throw new Error('Phiên đăng nhập hết hạn trong lúc tải file — đăng nhập lại và đồng bộ tiếp (file đã tải vẫn giữ).'); }
        f.download_error = e.message; job.counts.download_failed++;
        this.log(job, `Lỗi tải ${f.ma_ho_so}: ${e.message}`);
      }
      this.ctx.saveDb();
      await sleep(this.delayMs);
    }
  }

  // Tải bù hồ sơ chưa có file nằm NGOÀI khoảng vừa tra cứu (ví dụ lần đồng bộ trước tải lỗi): phải tra cứu
  // lại đúng ngày nộp của chúng (gom thành khoảng ≤ 30 ngày) rồi mới tải được.
  async downloadLeftovers(job, s) {
    const db = this.ctx.getDb();
    const left = db.filings.filter(f => f.company_id === job.company_id && !f.file && !job.attempted.has(f.ma_ho_so));
    if (!left.length) return;
    const windows = [];
    for (const source of ['DVC', 'TDT']) {
      const days = [...new Set(left.filter(f => (f.source || 'DVC') === source && f.ngay_nop_iso).map(f => f.ngay_nop_iso.slice(0, 10)))].sort();
      let cur = null;
      for (const d of days) {
        if (cur && d <= addDays(cur.from, MAX_DAYS)) cur.to = d;
        else { cur = { source, from: d, to: d }; windows.push(cur); }
      }
    }
    this.log(job, `Tải bù ${left.length} hồ sơ chưa có file từ lần trước: tra cứu lại ${windows.length} khoảng ngày nộp.`);
    for (const w of windows) {
      this.checkCancel(job);
      await this.searchWindow(job, s, w, rows => this.downloadRows(job, s, rows));
    }
    for (const f of left) if (!f.file && !job.attempted.has(f.ma_ho_so)) {
      f.download_error = 'Không thấy hồ sơ khi tra cứu lại theo ngày nộp'; job.counts.download_failed++;
    }
    this.ctx.saveDb();
  }

  saveFile(f, r) {
    const year = (f.ngay_nop_iso || '').slice(0, 4) || 'khac';
    const relDir = path.join('tokhai', safeName(f.mst || 'khong-ro-mst'), year);
    const absDir = path.join(this.ctx.dataDir, relDir);
    fs.mkdirSync(absDir, { recursive: true });
    const buf = Buffer.from(r.content, 'base64');
    const base = safeName(f.ma_ho_so);
    const isZip = /zip/i.test(r.fileType || '') || /\.zip$/i.test(r.fileName || '') || buf.slice(0, 2).toString() === 'PK';
    const mainName = base + (isZip ? '.zip' : path.extname(r.fileName || '.xml') || '.xml');
    fs.writeFileSync(path.join(absDir, mainName), buf);
    const xmlFiles = [];
    let info = null;
    const inner = isZip ? unzip(buf) : [{ name: r.fileName || mainName, data: buf }];
    for (const e of inner) {
      const n = `${base}__${safeName(path.basename(e.name))}`;
      if (isZip) fs.writeFileSync(path.join(absDir, n), e.data);
      xmlFiles.push(path.join(relDir, isZip ? n : mainName));
      if (!info && /\.xml$/i.test(e.name)) { try { info = parseDeclarationXml(e.data); } catch { /* bỏ qua */ } }
    }
    f.file = { path: path.join(relDir, mainName), file_name: r.fileName || mainName, size: buf.length, xml_files: xmlFiles, downloaded_at: new Date().toISOString() };
    f.xml_info = info;
  }

  askCaptcha(job, s, message) {
    return (async () => {
      job.captcha = await s.portal.getSearchCaptcha();
      job.captcha_message = message; job.state = 'NEED_CAPTCHA';
      const value = await new Promise((resolve, reject) => {
        const t = setTimeout(() => { job.waiter = null; reject(new Error('Quá 10 phút chưa nhập captcha — tác vụ dừng. Bấm Đồng bộ để chạy tiếp.')); }, this.captchaTimeoutMs);
        job.waiter = { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } };
      });
      job.waiter = null; job.captcha = null; job.captcha_message = null; job.state = 'RUNNING'; job.counts.captchas_entered++;
      return value;
    })();
  }
  submitCaptcha(jobId, value) {
    const job = this.jobs.get(jobId); if (!job) throw httpErr(404, 'Không tìm thấy tác vụ');
    if (job.state !== 'NEED_CAPTCHA' || !job.waiter) throw httpErr(400, 'Tác vụ không chờ captcha');
    if (!value || !String(value).trim()) throw httpErr(400, 'Cần nhập mã captcha');
    this.getSession(job.session_id); // cập nhật last_used
    job.waiter.resolve(String(value).trim());
    return this.publicJob(job);
  }
  async refreshJobCaptcha(jobId) {
    const job = this.jobs.get(jobId); if (!job) throw httpErr(404, 'Không tìm thấy tác vụ');
    if (job.state !== 'NEED_CAPTCHA') throw httpErr(400, 'Tác vụ không chờ captcha');
    const s = this.getSession(job.session_id);
    job.captcha = await s.portal.getSearchCaptcha();
    return this.publicJob(job);
  }
  cancel(jobId) {
    const job = this.jobs.get(jobId); if (!job) throw httpErr(404, 'Không tìm thấy tác vụ');
    if (!['RUNNING', 'NEED_CAPTCHA'].includes(job.state)) return this.publicJob(job);
    job.cancelled = true;
    if (job.waiter) job.waiter.reject(new Error('Người dùng đã hủy'));
    return this.publicJob(job);
  }
  checkCancel(job) { if (job.cancelled) throw new Error('Người dùng đã hủy'); }
  fail(job, e) {
    job.state = job.cancelled ? 'CANCELLED' : 'FAILED';
    job.error = e.message; job.finished_at = new Date().toISOString(); job.captcha = null; job.waiter = null;
    this.log(job, (job.cancelled ? 'Đã hủy: ' : 'Dừng vì lỗi: ') + e.message);
    this.ctx.saveDb();
    this.saveRun(job);
  }
  saveRun(job) {
    const db = this.ctx.getDb();
    // Lần chạy dở dang chỉ được tính "đã đồng bộ" tới hết các khoảng đã xong (để lần sau gợi ý đúng)
    const doneWindows = job.windows.slice(0, job.counts.windows_done);
    db.dvc_sync_runs.push({
      id: job.id, company_id: job.company_id, from: job.from, to: job.to, state: job.state, counts: job.counts, error: job.error,
      covered: doneWindows.map(w => [w.from, w.to]), started_at: job.started_at, finished_at: job.finished_at,
    });
    this.ctx.saveDb();
    this.ctx.audit('DVC_SYNC_' + job.state, 'company', job.company_id, `${job.from}..${job.to} found=${job.counts.found} new=${job.counts.new} dl=${job.counts.downloaded}`);
  }
  log(job, msg) { job.log.push({ at: new Date().toISOString(), msg }); if (job.log.length > 300) job.log.shift(); }
  publicJob(job) {
    const { waiter, windows, cancelled, attempted, ...rest } = job;
    const w = windows[job.window_index];
    return { ...rest, current_window: w ? { ...w, from_vn: vn(w.from), to_vn: vn(w.to) } : null };
  }
  getJob(id) { const j = this.jobs.get(id); if (!j) throw httpErr(404, 'Không tìm thấy tác vụ'); return this.publicJob(j); }
  async shutdown() { clearInterval(this.timer); for (const id of [...this.sessions.keys()]) await this.closeSession(id); }
}

function httpErr(status, message) { return Object.assign(new Error(message), { status }); }

module.exports = { DvcManager, buildWindows, tdtPages, httpErr, DVC_START };
