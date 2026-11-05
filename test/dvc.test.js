// Kiểm thử module đồng bộ dichvucong: chạy bằng `node --test test/`
// Không chạm cổng thật. Bài kiểm thử Playwright chạy với cổng giả lập HTTP trên localhost
// (bỏ qua nếu máy chưa cài Playwright/Chromium).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { zip, unzip } = require('../dvc/zip');
const { parseSearchResult } = require('../dvc/parse');
const { parseDeclarationXml } = require('../dvc/xmlinfo');
const { DvcManager, buildWindows, tdtPages } = require('../dvc/sync');
const { FakePortalBackend } = require('../dvc/fake-portal');
const { MockPortal } = require('../dvc/portal-mock');

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('zip: nén rồi giải nén giữ nguyên nội dung UTF-8', () => {
  const z = zip([{ name: 'a.xml', data: '<x>Tờ khai</x>' }, { name: 'b.txt', data: Buffer.alloc(5000, 65) }]);
  const out = unzip(z);
  assert.deepStrictEqual(out.map(f => f.name), ['a.xml', 'b.txt']);
  assert.strictEqual(out[0].data.toString(), '<x>Tờ khai</x>');
  assert.strictEqual(out[1].data.length, 5000);
});

test('parse: đọc đúng bảng kết quả theo cấu trúc cổng thật (kể cả cột bị comment)', () => {
  // Cấu trúc sao theo dòng quan sát trên cổng thật, dữ liệu đã thay bằng giá trị giả
  const html = `<div id="table-container"><div>Trang /7 - Tổng số bản ghi: 66</div><table>
  <thead><tr><th>STT</th><th>Thao tác</th><th>Mã hồ sơ</th><th>Tên TTHC</th><th>Tờ khai</th><th>Kỳ tính thuế</th><th>Loại tờ khai</th><th>Lần nộp bổ sung</th><th>Lần nộp (Tờ khai)/File số (DLVC)</th><th>Cơ quan thuế tiếp nhận</th><th>Ngày nộp</th><th>Trạng thái</th><th>Hồ sơ đính kèm</th></tr></thead>
  <tbody><tr>
    <td class="align-middle text-center labelTableBody">1</td>
    <td><i class="bi bi-eye" onclick="viewDetail(this)" data-ma-ho-so="G00.00-260101-00000001"></i></td>
    <td class="align-middle labelTableBody">G00.00-260101-00000001</td>
    <td><a href="javascript:void(0);" data-ma-ho-so="G00.00-260101-00000001"><span>9.999999 - Thủ tục khác</span></a></td>
    <!--doi voi to khai 02 GTGT thi hien thi them ma hso du an cho nguoi dung de chon-->
    <td class="text-start labelTableBody">BC26/AC - Báo cáo tình hình sử dụng hóa đơn</td>
    <td>Q2/2026</td><td>Chính thức</td><td>0</td><td>1</td><td>00000 - Thuế cơ sở mẫu</td><td>23/09/2026 16:41</td>
    <td><span class="badge bg-success">Đã chấp nhận</span><br></td>
<!--                            <td class="align-middle labelTableBody"><a>Xem tài liệu</a></td>-->
  </tr></tbody></table></div>`;
  const r = parseSearchResult(html);
  assert.strictEqual(r.total, 66);
  assert.strictEqual(r.rows.length, 1);
  const x = r.rows[0];
  assert.strictEqual(x.ma_ho_so, 'G00.00-260101-00000001');
  assert.strictEqual(x.to_khai, 'BC26/AC - Báo cáo tình hình sử dụng hóa đơn');
  assert.strictEqual(x.ky_tinh_thue, 'Q2/2026');
  assert.strictEqual(x.loai_to_khai, 'Chính thức');
  assert.strictEqual(x.lan_bo_sung, '0');
  assert.strictEqual(x.lan_nop, '1');
  assert.strictEqual(x.trang_thai, 'Đã chấp nhận');
  assert.strictEqual(x.ngay_nop_iso, '2026-09-23T16:41:00');
  assert.strictEqual(parseSearchResult('<div>Không có dữ liệu</div>').rows.length, 0);
});

test('buildWindows: mỗi khoảng ≤ 30 ngày, phủ kín, tách tại 01/07/2025', () => {
  const w = buildWindows('2025-05-15', '2025-08-20');
  for (const x of w) assert.ok((Date.parse(x.to) - Date.parse(x.from)) / 86400000 <= 30, JSON.stringify(x));
  const days = new Set();
  for (const x of w) for (let d = new Date(x.from); d <= new Date(x.to); d.setUTCDate(d.getUTCDate() + 1)) days.add(d.toISOString().slice(0, 10));
  assert.strictEqual(days.size, (Date.parse('2025-08-20') - Date.parse('2025-05-15')) / 86400000 + 1);
  assert.ok(w.every(x => (x.source === 'DVC') === (x.from >= '2025-07-01')));
  assert.ok(w.every(x => !(x.from < '2025-07-01' && x.to >= '2025-07-01')), 'không có khoảng vắt qua mốc');
  assert.deepStrictEqual(buildWindows('2026-10-01', '2026-10-01'), [{ source: 'DVC', from: '2026-10-01', to: '2026-10-01' }]);
});

test('xmlinfo: đọc mẫu, kỳ, loại, chỉ tiêu từ XML tờ khai', () => {
  const b = new FakePortalBackend();
  const sid = b.newSid(); b.sess(sid).loggedIn = true;
  const f = b.filings.find(x => x.tk.ma === '842');
  b.sess(sid).listed = new Set([f.ma_ho_so]); // như vừa tra cứu thấy hồ sơ này
  const r = b.download(sid, f.ma_ho_so, b.sess(sid).csrf);
  const files = unzip(Buffer.from(r.json.content, 'base64'));
  const info = parseDeclarationXml(files[0].data);
  assert.strictEqual(info.ma_tkhai, '842');
  assert.strictEqual(info.ky_kkhai, f.ky);
  assert.strictEqual(info.kieu_ky, 'M');
  assert.strictEqual(info.loai_tkhai, 'C');
  assert.strictEqual(info.mst, '0109999999');
  assert.strictEqual(info.indicators['40'], 600000);
  assert.strictEqual(info.indicators['40a'], 600000);
});

function makeCtx(dir, portalFactory) {
  const db = { companies: [], periods: [], invoices: [], payments: [], supplements: [], audit: [], declarations: [] };
  let n = 0;
  return {
    db,
    ctx: { getDb: () => db, saveDb: () => {}, audit: (a, e, id, d) => db.audit.push({ a, d }), uid: () => 'id' + (++n), dataDir: dir, portalFactory, delayMs: 0, captchaTimeoutMs: 5000 },
  };
}

// Chạy job tới khi xong; tự trả lời captcha bằng giá trị cổng giả lập đang giữ (mô phỏng người dùng gõ đúng)
async function drive(mgr, jobId, peek, { wrongFirst = false } = {}) {
  let wrongSent = !wrongFirst, prompts = 0;
  for (let i = 0; i < 4000; i++) {
    const j = mgr.getJob(jobId);
    if (j.state === 'NEED_CAPTCHA') {
      prompts++;
      if (!wrongSent) { wrongSent = true; mgr.submitCaptcha(jobId, 'sai00'); }
      else mgr.submitCaptcha(jobId, peek());
    }
    if (!['RUNNING', 'NEED_CAPTCHA'].includes(j.state)) return { job: j, prompts };
    await sleep(j.state === 'NEED_CAPTCHA' ? 5 : 2);
  }
  throw new Error('job không kết thúc');
}

test('Đồng bộ đầu-cuối với cổng giả lập: đăng nhập, tra cứu từng khoảng, captcha, phân trang, tải & giải nén', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-'));
  const backend = new FakePortalBackend();
  let portal;
  const { ctx, db } = makeCtx(dir, () => (portal = new MockPortal({ backend })));
  ctx.pageSize = 5; // ép phân trang
  const mgr = new DvcManager(ctx);
  try {
    const { session } = await mgr.createSession({ username: '0109999999' });
    const bad = await mgr.login(session.id, { password: 'sai', captcha: backend.peekCaptcha(portal.sid) });
    assert.strictEqual(bad.ok, false);
    const ok = await mgr.login(session.id, { password: 'matkhau-thu', captcha: backend.peekCaptcha(portal.sid) });
    assert.strictEqual(ok.ok, true, ok.message);
    assert.strictEqual(db.companies[0].tax_code, '0109999999');

    const from = '2025-05-01', to = '2026-10-31';
    const job = mgr.startSync(session.id, { from, to });
    const { job: done, prompts } = await drive(mgr, job.id, () => backend.peekCaptcha(portal.sid), { wrongFirst: true });
    assert.strictEqual(done.state, 'DONE', done.error);
    const expected = backend.filings.filter(f => f.date >= from && f.date <= to);
    assert.strictEqual(db.filings.length, expected.length);
    assert.deepStrictEqual(new Set(db.filings.map(f => f.ma_ho_so)), new Set(expected.map(f => f.ma_ho_so)));
    assert.ok(db.filings.some(f => f.source === 'TDT') && db.filings.some(f => f.source === 'DVC'));
    assert.strictEqual(done.counts.downloaded, expected.length);
    assert.strictEqual(done.counts.download_failed, 0);
    // mỗi khoảng cần đúng 1 captcha (+1 lần nhập sai cố ý); phân trang trong khoảng không hỏi lại
    assert.strictEqual(prompts, done.counts.windows_total + 1);
    for (const f of db.filings) {
      assert.ok(fs.existsSync(path.join(dir, f.file.path)), f.file.path);
      assert.ok(f.file.xml_files.every(x => fs.existsSync(path.join(dir, x))));
      assert.ok(f.xml_info && f.xml_info.ma_tkhai, 'có thông tin XML');
    }
    const sept = db.filings.filter(f => (f.ngay_nop_iso || '').startsWith('2026-09'));
    assert.ok(sept.length > 10, 'kỳ tháng 9 có >10 hồ sơ để kiểm thử phân trang');

    // Lần 2: tăng dần — không có hồ sơ mới, phát hiện đổi trạng thái
    const changed = backend.filings.find(f => f.trang_thai === 'Đã tiếp nhận');
    changed.trang_thai = 'Đã chấp nhận';
    const job2 = mgr.startSync(session.id, { from: '2026-09-01', to: '2026-10-31' });
    const { job: done2 } = await drive(mgr, job2.id, () => backend.peekCaptcha(portal.sid));
    assert.strictEqual(done2.state, 'DONE', done2.error);
    assert.strictEqual(done2.counts.new, 0);
    assert.strictEqual(done2.counts.updated, 1);
    assert.strictEqual(done2.counts.downloaded, 0);
    const f = db.filings.find(x => x.ma_ho_so === changed.ma_ho_so);
    assert.strictEqual(f.status_history.length, 1);
    assert.strictEqual(mgr.suggestFrom(f.company_id), '2026-10-24');

    // Hủy khi đang chờ captcha
    const job3 = mgr.startSync(session.id, { from: '2026-01-01', to: '2026-03-31' });
    for (let i = 0; i < 200 && mgr.getJob(job3.id).state !== 'NEED_CAPTCHA'; i++) await sleep(5);
    mgr.cancel(job3.id);
    await sleep(20);
    assert.strictEqual(mgr.getJob(job3.id).state, 'CANCELLED');

    // Phiên hết hạn giữa chừng -> FAILED với thông báo rõ
    backend.sess(portal.sid).loggedIn = false;
    const job4 = mgr.startSync(session.id, { from: '2026-10-01', to: '2026-10-31' });
    for (let i = 0; i < 200 && ['RUNNING', 'NEED_CAPTCHA'].includes(mgr.getJob(job4.id).state); i++) await sleep(5);
    assert.strictEqual(mgr.getJob(job4.id).state, 'FAILED');
    assert.match(mgr.getJob(job4.id).error, /hết hạn/);
  } finally { await mgr.shutdown(); }
});

test('Cổng chỉ cho tải hồ sơ của lần tra cứu gần nhất: tải ngay sau mỗi trang + tải bù hồ sơ cũ', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-left-'));
  const backend = new FakePortalBackend();
  let portal;
  const { ctx, db } = makeCtx(dir, () => (portal = new MockPortal({ backend })));
  ctx.pageSize = 5;
  const mgr = new DvcManager(ctx);
  try {
    const { session } = await mgr.createSession({ username: '0109999999' });
    assert.ok((await mgr.login(session.id, { password: 'matkhau-thu', captcha: backend.peekCaptcha(portal.sid) })).ok);
    // Lần 1: chỉ tra cứu, không tải (giống tình trạng 66 hồ sơ tải lỗi)
    const j1 = mgr.startSync(session.id, { from: '2025-05-01', to: '2026-10-31', download: false });
    const { job: d1 } = await drive(mgr, j1.id, () => backend.peekCaptcha(portal.sid));
    assert.strictEqual(d1.state, 'DONE', d1.error);
    assert.ok(db.filings.length > 20 && db.filings.every(f => !f.file));
    // Sau khi tra cứu khoảng khác, tải trực tiếp hồ sơ cũ bị cổng từ chối đúng như cổng thật
    const old = db.filings.find(f => !backend.sess(portal.sid).listed.has(f.ma_ho_so));
    await assert.rejects(portal.download(old), /không hợp lệ/);
    // Lần 2: chỉ tra cứu 1 tuần gần nhất -> vẫn tải bù đủ toàn bộ nhờ tra cứu lại theo ngày nộp
    const j2 = mgr.startSync(session.id, { from: '2026-10-25', to: '2026-10-31' });
    const { job: d2 } = await drive(mgr, j2.id, () => backend.peekCaptcha(portal.sid));
    assert.strictEqual(d2.state, 'DONE', d2.error);
    assert.strictEqual(d2.counts.download_failed, 0);
    assert.strictEqual(d2.counts.downloaded, db.filings.length);
    assert.ok(db.filings.every(f => f.file && fs.existsSync(path.join(dir, f.file.path)) && !f.download_error));
  } finally { await mgr.shutdown(); }
});

test('Chọn công ty khác MST đăng nhập thì từ chối và đóng phiên', async () => {
  const backend = new FakePortalBackend();
  let portal;
  const { ctx, db } = makeCtx(fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-')), () => (portal = new MockPortal({ backend })));
  db.companies.push({ id: 'c1', tax_code: '0200000002', name: 'Khác' });
  const mgr = new DvcManager(ctx);
  const { session } = await mgr.createSession({ username: '0109999999', company_id: 'c1' });
  const r = await mgr.login(session.id, { password: 'matkhau-thu', captcha: backend.peekCaptcha(portal.sid) });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /khác MST/);
  assert.throws(() => mgr.getSession(session.id));
  await mgr.shutdown();
});

test('tdtPages đọc danh sách trang của tab thuế điện tử', () => {
  const html = '<a class="page-link" onclick="changePage_tdt(this)" data-page="0" data-size="10">1</a><a onclick="changePage_tdt(this)" data-page="1" data-size="10">2</a>';
  assert.deepStrictEqual(tdtPages(html), [{ page: '0', size: 10 }, { page: '1', size: 10 }]);
});

// ---- Bộ kết nối Playwright thật, chạy với cổng giả lập HTTP ----
let playwrightOk = false;
try { require.resolve('playwright'); playwrightOk = true; } catch { /* chưa cài */ }

test('PlaywrightPortal: đăng nhập + đồng bộ qua trình duyệt thật với cổng giả lập HTTP', { skip: !playwrightOk && 'chưa cài playwright' }, async () => {
  const { createFakePortalServer } = require('../dvc/fake-portal-server');
  const { PlaywrightPortal } = require('../dvc/portal-playwright');
  const { server, backend } = createFakePortalServer();
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-pw-'));
  const { ctx, db } = makeCtx(dir, () => new PlaywrightPortal({ baseUrl: base, headless: true }));
  ctx.delayMs = 0;
  const mgr = new DvcManager(ctx);
  // Lấy captcha mà cổng giả lập đang giữ cho phiên trình duyệt (chỉ có 1 phiên có captcha tại 1 thời điểm)
  const peek = () => { for (const s of backend.sessions.values()) if (s.captcha) return s.captcha; return 'x'; };
  try {
    const { session, captcha } = await mgr.createSession({ username: '0109999999' });
    assert.match(captcha.mime, /svg/);
    const ok = await mgr.login(session.id, { password: 'matkhau-thu', captcha: peek() });
    assert.strictEqual(ok.ok, true, ok.message);
    assert.strictEqual(ok.session.mst, '0109999999');
    const job = mgr.startSync(session.id, { from: '2025-06-01', to: '2025-07-31' });
    const { job: done } = await drive(mgr, job.id, peek);
    assert.strictEqual(done.state, 'DONE', done.error);
    const expected = backend.filings.filter(f => f.date >= '2025-06-01' && f.date <= '2025-07-31');
    assert.strictEqual(db.filings.length, expected.length);
    assert.strictEqual(done.counts.downloaded, expected.length);
    assert.ok(db.filings.every(f => f.xml_info && f.file));
    assert.ok(backend.requestLog.includes('POST /tthc/tchs/thuedientu'), 'đã gọi tab thuế điện tử');
    assert.ok(backend.requestLog.includes('POST /tthc/tchs/downloadhoso'), 'đã tải file');
  } finally { await mgr.shutdown(); server.close(); }
});
