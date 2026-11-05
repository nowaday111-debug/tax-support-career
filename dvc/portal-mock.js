// Bộ kết nối GIẢ LẬP chạy trong tiến trình (không cần trình duyệt, không chạm cổng thật).
// Bật bằng biến môi trường DVC_MODE=mock. Tài khoản thử: 0109999999 / matkhau-thu.
const { FakePortalBackend } = require('./fake-portal');
const { parseSearchResult } = require('./parse');

let sharedBackend = null; // dùng chung giữa các phiên để dữ liệu ổn định trong 1 lần chạy

class MockPortal {
  constructor(opts = {}) {
    this.backend = opts.backend || (sharedBackend ||= new FakePortalBackend());
    this.sid = null;
  }
  async open() { this.sid = this.backend.newSid(); }
  _img(c) { return { mime: c.mime, base64: c.body.toString('base64') }; }
  async getLoginCaptcha() { return this._img(this.backend.newCaptcha(this.sid)); }
  async login({ username, password, captcha, doiTuong = 'DN' }) {
    const r = this.backend.login(this.sid, { tenDN: username, matKhau: Buffer.from(password || '', 'utf8').toString('base64'), doiTuong, captcha });
    if (r.status !== '200') return { ok: false, message: r.desc };
    return { ok: true, mst: '0109999999', ten: 'CÔNG TY TNHH MẪU DÙNG THỬ' };
  }
  async getSearchCaptcha() {
    if (!this.backend.sess(this.sid)?.loggedIn) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn'), { code: 'SESSION_EXPIRED' });
    return this._img(this.backend.newCaptcha(this.sid));
  }
  _wrap(r) {
    if (r.http === 302) return { status: 'SESSION_EXPIRED', message: 'Phiên đăng nhập đã hết hạn' };
    if (r.http === 400) return /captcha/i.test(r.body) ? { status: 'CAPTCHA', message: r.body } : { status: 'ERROR', message: r.body };
    return { status: 'OK', html: r.body };
  }
  async searchDvc(q) { return this._wrap(this.backend.search(this.sid, q, 'DVC')); }
  async searchTdt(q) { return this._wrap(this.backend.search(this.sid, q, 'TDT')); }
  async download({ ma_ho_so }) {
    const r = this.backend.download(this.sid, ma_ho_so, this.backend.sess(this.sid).csrf);
    if (r.http === 302) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn'), { code: 'SESSION_EXPIRED' });
    if (r.json && r.json.error) throw new Error(r.json.error);
    if (!r.json || !r.json.content) throw new Error('Không có nội dung file');
    return r.json;
  }
  async close() { if (this.sid) this.backend.sessions.delete(this.sid); this.sid = null; }
}

module.exports = { MockPortal, parseSearchResult, _sharedBackend: () => sharedBackend };
