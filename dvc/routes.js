// API đồng bộ tờ khai từ dichvucong.gdt.gov.vn
const fs = require('fs');
const path = require('path');
const { DvcManager } = require('./sync');

module.exports = function registerDvcRoutes(app, ctx) {
  const mode = (process.env.DVC_MODE || 'real').toLowerCase();
  const isMock = mode === 'mock';
  const portalFactory = ctx.portalFactory || (isMock
    ? () => new (require('./portal-mock').MockPortal)()
    : () => new (require('./portal-playwright').PlaywrightPortal)());
  const mgr = new DvcManager({ ...ctx, portalFactory, isMock });

  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[dvc]', e.message);
      res.status(status).json({ error: e.message || 'Lỗi không xác định' });
    }
  };

  app.get('/api/dvc/info', (req, res) => res.json({
    mode: isMock ? 'mock' : 'real',
    base_url: isMock ? '(giả lập trong máy)' : (process.env.DVC_BASE_URL || 'https://dichvucong.gdt.gov.vn'),
    note: isMock ? 'Dữ liệu bịa, không chạm cổng thật. Tài khoản thử: 0109999999 / matkhau-thu' : 'Kết nối cổng thật bằng tài khoản của doanh nghiệp.' + (mgr.autoCaptcha ? ' Captcha được phần mềm tự đọc (sai thì hỏi nhập tay).' : ' Captcha do người dùng nhập.'),
    captcha: mgr.captchaInfo(),
  }));

  app.get('/api/dvc/captcha', (req, res) => res.json(mgr.captchaInfo()));
  // Thử bộ đọc captcha với 1 ảnh PNG (base64) — để kiểm tra/gỡ lỗi, không gọi cổng thuế
  app.post('/api/dvc/captcha/solve', wrap(async (req, res) => {
    const b64 = String((req.body || {}).base64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (!b64) throw Object.assign(new Error('Cần base64 của ảnh PNG'), { status: 400 });
    const r = mgr.solver.solve(b64);
    res.json({ ok: r.ok, text: r.text, confidence: r.confidence, reason: r.reason || null });
  }));

  // Bước 1: mở phiên, nhận ảnh captcha đăng nhập
  app.post('/api/dvc/sessions', wrap(async (req, res) => {
    const { company_id, username, doi_tuong } = req.body || {};
    const r = await mgr.createSession({ company_id, username, doiTuong: doi_tuong === 'CN' ? 'CN' : 'DN' });
    res.status(201).json(r);
  }));
  app.post('/api/dvc/sessions/:id/login-captcha', wrap(async (req, res) => res.json({ captcha: await mgr.refreshLoginCaptcha(req.params.id) })));
  // Bước 2: đăng nhập (mật khẩu chỉ dùng 1 lần, không lưu)
  app.post('/api/dvc/sessions/:id/login', wrap(async (req, res) => {
    const { password, captcha } = req.body || {};
    const r = await mgr.login(req.params.id, { password, captcha });
    res.status(r.ok ? 200 : 401).json(r);
  }));
  app.get('/api/dvc/sessions/:id', wrap(async (req, res) => res.json(mgr.publicSession(mgr.getSession(req.params.id)))));
  app.delete('/api/dvc/sessions/:id', wrap(async (req, res) => { await mgr.closeSession(req.params.id); res.json({ ok: true }); }));

  // Bước 3: đồng bộ
  app.post('/api/dvc/sessions/:id/sync', wrap(async (req, res) => {
    const { from, to, download, sources } = req.body || {};
    res.status(202).json(mgr.startSync(req.params.id, { from, to, download: download !== false, sources: Array.isArray(sources) && sources.length ? sources : undefined }));
  }));
  app.get('/api/dvc/jobs/:id', wrap(async (req, res) => res.json(mgr.getJob(req.params.id))));
  app.post('/api/dvc/jobs/:id/captcha', wrap(async (req, res) => res.json(mgr.submitCaptcha(req.params.id, (req.body || {}).captcha))));
  app.post('/api/dvc/jobs/:id/captcha/refresh', wrap(async (req, res) => res.json(await mgr.refreshJobCaptcha(req.params.id))));
  app.post('/api/dvc/jobs/:id/cancel', wrap(async (req, res) => res.json(mgr.cancel(req.params.id))));

  // Tờ khai đã đồng bộ
  app.get('/api/filings', wrap(async (req, res) => {
    const db = ctx.getDb();
    let list = db.filings || [];
    if (req.query.company_id) list = list.filter(f => f.company_id === req.query.company_id);
    list = [...list].sort((a, b) => String(b.ngay_nop_iso || '').localeCompare(String(a.ngay_nop_iso || '')));
    res.json(list.map(({ raw, ...f }) => f));
  }));
  app.get('/api/filings/:id/file', wrap(async (req, res) => {
    const f = (ctx.getDb().filings || []).find(x => x.id === req.params.id);
    if (!f || !f.file) return res.status(404).json({ error: 'Chưa có file cho hồ sơ này' });
    const abs = path.resolve(ctx.dataDir, f.file.path);
    if (!abs.startsWith(path.resolve(ctx.dataDir) + path.sep) || !fs.existsSync(abs)) return res.status(404).json({ error: 'Không thấy file trên máy' });
    res.setHeader('Content-Type', /\.zip$/i.test(abs) ? 'application/zip' : 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
    res.send(fs.readFileSync(abs));
  }));
  app.get('/api/dvc/runs', wrap(async (req, res) => {
    const runs = (ctx.getDb().dvc_sync_runs || []).filter(r => !req.query.company_id || r.company_id === req.query.company_id);
    res.json(runs.slice(-50).reverse());
  }));

  return mgr;
};
