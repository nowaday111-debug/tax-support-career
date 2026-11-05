// Kiểm thử bộ tự đọc captcha (dvc/captcha) và luồng tự điền captcha trong DvcManager.
// Ảnh mẫu thật của dichvucong ở test/fixtures/captcha/<mã đúng>.png (lấy 11/2026).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CaptchaSolver, analyze, decodePng } = require('../dvc/captcha/solver');
const { DvcManager } = require('../dvc/sync');
const { FakePortalBackend } = require('../dvc/fake-portal');
const { MockPortal } = require('../dvc/portal-mock');

const FIX = path.join(__dirname, 'fixtures', 'captcha');
const fixtures = fs.readdirSync(FIX).filter(f => f.endsWith('.png')).map(f => ({ label: f.slice(0, -4), buf: fs.readFileSync(path.join(FIX, f)) }));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('PNG: giải mã ảnh captcha thật 150x38', () => {
  const img = decodePng(fixtures[0].buf);
  assert.strictEqual(img.width, 150); assert.strictEqual(img.height, 38);
  assert.strictEqual(img.data.length, 150 * 38);
  assert.ok(img.data[0] < 60, 'khung đen'); assert.ok(img.data[38 * 0 + 75 + 150 * 2] > 150, 'nền sáng');
  assert.throws(() => decodePng(Buffer.from('<svg/>')), /PNG/);
});

test('Tách đúng 5 ký tự trên mọi ảnh mẫu thật', () => {
  for (const f of fixtures) {
    const a = analyze(f.buf);
    assert.strictEqual(a.segs.length, 5, f.label);
    for (let i = 1; i < 5; i++) assert.ok(a.segs[i].x0 > a.segs[i - 1].x0, 'theo thứ tự trái -> phải');
  }
});

test('Mô hình khởi tạo (chỉ mẫu tổng hợp, không có ảnh thật) đọc đúng ≥ 85% ký tự trên ảnh thật', () => {
  // bỏ phần mẫu thật trong model.json để đo khách quan trên chính các ảnh thật đó
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dvc', 'captcha', 'model.json'), 'utf8'));
  delete m.samples;
  const p = path.join(tmp(), 'syn-only.json'); fs.writeFileSync(p, JSON.stringify(m));
  const s = new CaptchaSolver({ modelPath: p });
  let ok = 0, full = 0;
  for (const f of fixtures) {
    const r = s.solve(f.buf);
    assert.ok(r.ok); assert.strictEqual(r.text.length, 5);
    ok += [...f.label].filter((c, i) => r.text[i] === c).length;
    if (r.text === f.label) full++;
  }
  const rate = ok / (fixtures.length * 5);
  assert.ok(rate >= 0.85, `tỉ lệ ký tự đúng ${rate}`);
  assert.ok(full >= 5, `số captcha đúng cả 5 ký tự: ${full}`);
});

test('Học: captcha được cổng chấp nhận được lưu và lần sau đọc đúng; nhãn sai định dạng bị bỏ qua', () => {
  const dir = tmp(), learnPath = path.join(dir, 'captcha', 'learned.json');
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dvc', 'captcha', 'model.json'), 'utf8'));
  delete m.samples;
  const mp = path.join(dir, 'm.json'); fs.writeFileSync(mp, JSON.stringify(m));
  const s = new CaptchaSolver({ modelPath: mp, learnPath });
  const wrong = fixtures.filter(f => s.solve(f.buf).text !== f.label);
  assert.ok(wrong.length > 0, 'cần ít nhất 1 ảnh mô hình khởi tạo đọc sai');
  for (const f of wrong) assert.strictEqual(s.learn({ mime: 'image/png', base64: f.buf.toString('base64') }, f.label), 5);
  assert.strictEqual(s.learn(fixtures[0].buf, 'ab'), 0);
  assert.strictEqual(s.learn(fixtures[0].buf, 'AB#12'), 0);
  const s2 = new CaptchaSolver({ modelPath: mp, learnPath }); // nạp lại từ đĩa
  assert.strictEqual(s2.learnedCount, wrong.length);
  for (const f of wrong) assert.strictEqual(s2.solve(f.buf).text, f.label);
});

test('Ảnh không phải PNG / hỏng: không ném lỗi, trả ok=false', () => {
  const s = new CaptchaSolver();
  assert.strictEqual(s.canRead({ mime: 'image/svg+xml', base64: 'PHN2Zy8+' }), false);
  assert.strictEqual(s.solve(Buffer.from('xyz')).ok, false);
  assert.strictEqual(s.solve({ mime: 'image/png', base64: 'AAAA' }).ok, false);
});

// ---------- Luồng tự điền trong DvcManager (cổng giả lập; bộ đọc giả "nhìn" mã cổng đang giữ) ----------
function makeCtx(dir, portalFactory, extra = {}) {
  const db = { companies: [], audit: [] };
  let n = 0;
  return { db, ctx: { getDb: () => db, saveDb: () => {}, audit: (a, e, id, d) => db.audit.push({ a, d }), uid: () => 'id' + (++n), dataDir: dir, portalFactory, delayMs: 0, captchaTimeoutMs: 5000, ...extra } };
}
// wrongFirst: số lần đầu đọc sai (mô phỏng bộ đọc nhầm)
function fakeSolver(backend, { wrongFirst = 0 } = {}) {
  let calls = 0;
  const learned = [];
  return {
    learned, get calls() { return calls; },
    canRead: () => true,
    solve() {
      const cur = [...backend.sessions.values()].find(s => s.captcha)?.captcha;
      calls++;
      return { ok: true, text: calls <= wrongFirst ? 'zzzzz' : cur, confidence: 0.9 };
    },
    learn(img, text) { learned.push(text); return 5; },
    size: 1, learnedCount: 0,
  };
}

test('Đăng nhập: để trống captcha -> tự đọc, sai thì lấy mã mới thử lại, đúng thì học', async () => {
  const backend = new FakePortalBackend();
  const solver = fakeSolver(backend, { wrongFirst: 3 }); // withGuess khi mở phiên (1) + 2 lần gửi sai
  const { ctx } = makeCtx(tmp(), () => new MockPortal({ backend }), { captchaSolver: solver, autoCaptcha: true, autoCaptchaTries: 3 });
  const mgr = new DvcManager(ctx);
  const { session, captcha } = await mgr.createSession({ username: '0109999999' });
  assert.strictEqual(captcha.guess, 'zzzzz'); // mã đoán gửi kèm ảnh để giao diện gợi ý
  const r = await mgr.login(session.id, { password: 'matkhau-thu', captcha: '' });
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.captcha_source, 'auto');
  assert.strictEqual(r.auto_attempts, 3);
  assert.strictEqual(solver.learned.length, 1);
  assert.strictEqual(mgr.captchaStats.auto_fail, 2);
  await mgr.shutdown();
});

test('Đăng nhập: sai mật khẩu thì dừng ngay sau 1 lần, không tự thử lại (tránh khóa tài khoản)', async () => {
  const backend = new FakePortalBackend();
  const solver = fakeSolver(backend);
  const { ctx } = makeCtx(tmp(), () => new MockPortal({ backend }), { captchaSolver: solver, autoCaptchaTries: 5 });
  const mgr = new DvcManager(ctx);
  const { session } = await mgr.createSession({ username: '0109999999' });
  const r = await mgr.login(session.id, { password: 'sai-mat-khau', captcha: '' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.auto_attempts, 1);
  assert.match(r.message, /mật khẩu/);
  assert.ok(r.captcha && r.captcha.base64, 'trả ảnh captcha mới để đăng nhập lại');
  assert.strictEqual(solver.learned.length, 0);
  await mgr.shutdown();
});

test('Đăng nhập: tự đọc sai đủ số lần -> báo nhập tay; tắt tự đọc thì bắt buộc nhập', async () => {
  const backend = new FakePortalBackend();
  const solver = fakeSolver(backend, { wrongFirst: 99 });
  const { ctx } = makeCtx(tmp(), () => new MockPortal({ backend }), { captchaSolver: solver, autoCaptchaTries: 2 });
  const mgr = new DvcManager(ctx);
  const { session } = await mgr.createSession({ username: '0109999999' });
  const r = await mgr.login(session.id, { password: 'matkhau-thu' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.auto_attempts, 2); assert.match(r.message, /nhập tay/);
  // người dùng gõ tay đúng -> vẫn học
  const ok = await mgr.login(session.id, { password: 'matkhau-thu', captcha: backend.peekCaptcha([...backend.sessions.keys()][0]) });
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.captcha_source, 'manual'); assert.strictEqual(solver.learned.length, 1);
  await mgr.shutdown();

  const { ctx: ctx2 } = makeCtx(tmp(), () => new MockPortal({ backend }), { captchaSolver: solver, autoCaptcha: false });
  const mgr2 = new DvcManager(ctx2);
  const s2 = await mgr2.createSession({ username: '0109999999' });
  assert.strictEqual(s2.captcha.guess, undefined);
  await assert.rejects(mgr2.login(s2.session.id, { password: 'matkhau-thu' }), /captcha/);
  await mgr2.shutdown();
});

async function loggedIn(backend, solver, extra = {}) {
  const { ctx, db } = makeCtx(tmp(), () => new MockPortal({ backend }), { captchaSolver: solver, ...extra });
  const mgr = new DvcManager(ctx);
  const { session } = await mgr.createSession({ username: '0109999999' });
  const r = await mgr.login(session.id, { password: 'matkhau-thu' });
  assert.strictEqual(r.ok, true, r.message);
  return { mgr, session, db };
}
async function waitJob(mgr, id, onCaptcha) {
  for (let i = 0; i < 4000; i++) {
    const j = mgr.getJob(id);
    if (j.state === 'NEED_CAPTCHA' && onCaptcha) onCaptcha(j);
    if (!['RUNNING', 'NEED_CAPTCHA'].includes(j.state)) return j;
    await sleep(3);
  }
  throw new Error('job không kết thúc');
}

test('Đồng bộ: captcha tra cứu được tự đọc, không hỏi người dùng lần nào', async () => {
  const backend = new FakePortalBackend();
  const solver = fakeSolver(backend);
  const { mgr, session, db } = await loggedIn(backend, solver);
  const j0 = mgr.startSync(session.id, { from: '2025-08-01', to: '2025-10-31', download: false });
  let asked = 0;
  const j = await waitJob(mgr, j0.id, () => asked++);
  assert.strictEqual(j.state, 'DONE', j.error);
  assert.strictEqual(asked, 0);
  assert.strictEqual(j.counts.captchas_entered, 0);
  assert.ok(j.counts.captchas_auto >= j.counts.windows_total);
  assert.strictEqual(j.counts.captchas_auto_ok, j.counts.captchas_auto);
  assert.ok(db.filings.length > 0);
  await mgr.shutdown();
});

test('Đồng bộ: tự đọc sai hết số lần thì dừng chờ người dùng, ảnh có kèm mã gợi ý; nhập đúng thì chạy tiếp và học', async () => {
  const backend = new FakePortalBackend();
  const solver = fakeSolver(backend);
  const { mgr, session } = await loggedIn(backend, solver, { autoCaptchaTries: 2 });
  const learnedAtLogin = solver.learned.length;
  let mode = 'wrong';
  const origSolve = solver.solve.bind(solver);
  solver.solve = () => (mode === 'wrong' ? { ok: true, text: 'zzzzz', confidence: 0.5 } : origSolve());
  const j0 = mgr.startSync(session.id, { from: '2025-09-01', to: '2025-09-20', download: false });
  let prompts = 0;
  const j = await waitJob(mgr, j0.id, job => {
    prompts++;
    assert.strictEqual(job.captcha.guess, 'zzzzz');
    assert.match(job.captcha_message, /Tự đọc captcha 2 lần chưa đúng/);
    mode = 'right';
    mgr.submitCaptcha(job.id, [...backend.sessions.values()].find(s => s.captcha).captcha);
  });
  assert.strictEqual(j.state, 'DONE', j.error);
  assert.strictEqual(prompts, 1);
  assert.strictEqual(j.counts.captchas_auto, 2);
  assert.strictEqual(j.counts.captchas_entered, 1);
  assert.strictEqual(solver.learned.length, learnedAtLogin + 1);
  await mgr.shutdown();
});

test('Lấy captcha bị cổng chặn 429 thì chờ rồi thử lại', async () => {
  const { ctx } = makeCtx(tmp(), () => null, { rateLimitBackoffMs: 1 });
  const mgr = new DvcManager(ctx);
  let n = 0;
  const img = await mgr.fetchCaptcha(async () => { if (++n < 3) throw Object.assign(new Error('429'), { code: 'RATE_LIMITED' }); return { mime: 'image/png', base64: 'x' }; });
  assert.strictEqual(n, 3); assert.strictEqual(img.base64, 'x');
  await assert.rejects(mgr.fetchCaptcha(async () => { throw Object.assign(new Error('hết phiên'), { code: 'SESSION_EXPIRED' }); }), /hết phiên/);
  await mgr.shutdown();
});
