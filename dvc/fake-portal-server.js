// Máy chủ HTTP giả lập cổng dichvucong (chỉ để kiểm thử bộ kết nối Playwright thật mà không chạm cổng thật).
// Chạy: node dvc/fake-portal-server.js 4555  -> rồi đặt DVC_BASE_URL=http://localhost:4555
const http = require('http');
const { FakePortalBackend, FAKE_USER } = require('./fake-portal');

function parseCookies(h) { return Object.fromEntries((h || '').split(';').map(c => c.trim().split('=')).filter(p => p[0])); }
function readBody(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); }

function page(title, csrf, body, scripts = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="csrf-token" content="${csrf}"><meta name="csrf-header" content="X-XSRF-TOKEN"></head>
<body>${body}<script>var base_url='/tthc/';var token='${csrf}';${scripts}</script></body></html>`;
}

function createFakePortalServer(backend = new FakePortalBackend()) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let sid = parseCookies(req.headers.cookie).SESSION;
    if (!sid || !backend.sess(sid)) { sid = backend.newSid(); res.setHeader('Set-Cookie', `SESSION=${sid}; Path=/; HttpOnly`); }
    const s = backend.sess(sid);
    backend.requestLog.push(`${req.method} ${url.pathname}`);
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
    const redirectLogin = () => { res.writeHead(302, { Location: '/tthc/login' }); res.end(); };
    const p = url.pathname;
    if (p === '/tthc/login' && req.method === 'GET') {
      return send(200, 'text/html; charset=utf-8', page('Đăng nhập', s.csrf, `<form action="/tthc/login" method="post"><input type="hidden" name="ldap">
<input type="text" name="tenDN" placeholder="Nhập tên đăng nhập"><input type="password" name="matKhau"><img id="image-capt" src="">
<input type="text" name="captcha"><button id="btnDangNhapLdap" type="button">Đăng nhập</button></form>`));
    }
    if (p === '/tthc/login/getCaptcha' || p === '/tthc/getCaptcha') {
      if (p === '/tthc/getCaptcha' && !s.loggedIn) return redirectLogin();
      const c = backend.newCaptcha(sid); return send(200, c.mime, c.body);
    }
    if (p === '/tthc/loginLDAP' && req.method === 'POST') {
      const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
      return send(200, 'application/json', JSON.stringify(backend.login(sid, f)));
    }
    if (!s.loggedIn) return redirectLogin();
    if (p === '/tthc/home') {
      return send(200, 'text/html; charset=utf-8', page('Trang chủ', s.csrf, `<span class="ten_dn">${FAKE_USER.ten}</span>`, `var isLogon="Y";var mst="${FAKE_USER.mst}";`));
    }
    if (p === '/tthc/tchs') {
      return send(200, 'text/html; charset=utf-8', page('Tra cứu hồ sơ', s.csrf, `<form id="form-search-advanced" hx-get="/tthc/ho-so/search"></form>
<form id="form_search_tdt" action="/tthc/tchs/thuedientu" method="post"><input type="hidden" name="_csrf" value="${s.csrf}"></form><div id="table-container"></div>`, 'var RANGE_SEARCH_DAYS=30;'));
    }
    if (p === '/tthc/ho-so/search') {
      const r = backend.search(sid, Object.fromEntries(url.searchParams), 'DVC');
      return send(r.http, 'text/html; charset=utf-8', r.body);
    }
    if (p === '/tthc/tchs/thuedientu' && req.method === 'POST') {
      if (req.headers['x-xsrf-token'] !== s.csrf) return send(403, 'text/plain', 'CSRF');
      const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const r = backend.search(sid, { tuNgay: f.tuNgay_tdt, denNgay: f.denNgay_tdt, maHoSo: f.maGiaoDichTthc_tdt, captcha: f.captcha, page: f.page, size: f.size }, 'TDT');
      return send(r.http, 'text/html; charset=utf-8', r.body);
    }
    if (p === '/tthc/tchs/validateIdTkhai') {
      const r = backend.validateIdTkhai(sid, url.searchParams.get('idTKhai'));
      return send(r.http, 'text/plain; charset=utf-8', r.body);
    }
    if ((p === '/tthc/tchs/downloadhoso' || p === '/tthc/tchs/downloadhoso-tdt') && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const r = backend.download(sid, body.maHoSo, req.headers['x-xsrf-token']);
      return send(r.http, 'application/json', JSON.stringify(r.json));
    }
    send(404, 'text/plain', 'Not found');
  });
  return { server, backend };
}

module.exports = { createFakePortalServer };

if (require.main === module) {
  const port = Number(process.argv[2]) || 4555;
  createFakePortalServer().server.listen(port, () => console.log(`Cổng GIẢ LẬP chạy tại http://localhost:${port} (tài khoản ${FAKE_USER.tenDN} / ${FAKE_USER.matKhau})`));
}
