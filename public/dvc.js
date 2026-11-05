// Giao diện đồng bộ tờ khai từ dichvucong.gdt.gov.vn
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const img = c => c ? `data:${c.mime};base64,${c.base64}` : '';
  let autoCaptcha = false;
  // Ô nhập captcha đăng nhập để trống = phần mềm tự đọc (thử lại vài lần nếu sai); gõ vào = dùng mã đã gõ
  function showLoginCaptcha(c) {
    $('#dvcLoginCaptcha').src = img(c);
    const inp = $('#dvcLoginCaptchaInput');
    inp.value = '';
    inp.placeholder = autoCaptcha ? (c && c.guess ? `tự đọc: ${c.guess}` : 'nhập tay') : '';
    $('#dvcLoginCaptchaHint').textContent = autoCaptcha
      ? (c && c.guess ? 'Để trống ô captcha để phần mềm tự đọc và tự thử lại nếu sai; hoặc gõ mã nếu muốn tự nhập.' : 'Phần mềm không đọc được ảnh này — hãy nhập tay.')
      : '';
  }
  const vn = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
  let session = null, jobId = null, pollTimer = null;

  async function api(path, method, body) {
    const r = await fetch(path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.json().catch(() => ({}));
    if (!r.ok && !(t && t.ok === false)) throw new Error(t.error || ('Lỗi ' + r.status));
    return t;
  }
  function msg(el, text, ok) { $(el).innerHTML = text ? `<span style="color:${ok ? '#166534' : '#b91c1c'}">${esc(text)}</span>` : ''; }

  async function init() {
    const info = await api('/api/dvc/info');
    autoCaptcha = !!(info.captcha && info.captcha.auto);
    $('#dvcMode').innerHTML = (info.mode === 'mock' ? '<b style="color:#b45309">CHẾ ĐỘ GIẢ LẬP</b> — ' : '<b>Cổng thật</b> — ') + esc(info.note);
    const companies = await api('/api/companies');
    $('#dvcCompany').innerHTML = '<option value="">(Tự tạo theo MST đăng nhập)</option>' + companies.map(c => `<option value="${esc(c.id)}">${esc(c.tax_code)} — ${esc(c.name)}</option>`).join('');
    $('#dvcTo').value = new Date().toISOString().slice(0, 10);
    loadFilings();
  }

  $('#dvcOpen').onclick = async () => {
    try {
      msg('#dvcLoginMsg', 'Đang mở cổng thuế...', true);
      if (session) await api('/api/dvc/sessions/' + session.id, 'DELETE').catch(() => {});
      const r = await api('/api/dvc/sessions', 'POST', { username: $('#dvcUser').value.trim(), company_id: $('#dvcCompany').value || undefined });
      session = r.session;
      showLoginCaptcha(r.captcha);
      $('#dvcLoginStep2').hidden = false; $('#dvcPass').focus();
      msg('#dvcLoginMsg', '');
    } catch (e) { msg('#dvcLoginMsg', e.message); }
  };
  $('#dvcLoginCaptchaRefresh').onclick = async () => {
    try { const r = await api(`/api/dvc/sessions/${session.id}/login-captcha`, 'POST', {}); showLoginCaptcha(r.captcha); } catch (e) { msg('#dvcLoginMsg', e.message); }
  };
  $('#dvcLoginBtn').onclick = async () => {
    try {
      msg('#dvcLoginMsg', $('#dvcLoginCaptchaInput').value.trim() || !autoCaptcha ? 'Đang đăng nhập...' : 'Đang tự đọc captcha và đăng nhập...', true);
      const r = await api(`/api/dvc/sessions/${session.id}/login`, 'POST', { password: $('#dvcPass').value, captcha: $('#dvcLoginCaptchaInput').value.trim() });
      $('#dvcPass').value = ''; $('#dvcLoginCaptchaInput').value = '';
      if (!r.ok) {
        msg('#dvcLoginMsg', r.message);
        if (r.captcha) showLoginCaptcha(r.captcha); else { $('#dvcLoginStep2').hidden = true; session = null; }
        return;
      }
      session = r.session;
      msg('#dvcLoginMsg', 'Đăng nhập thành công' + (r.captcha_source === 'auto' ? ` (captcha tự đọc${r.auto_attempts > 1 ? ', ' + r.auto_attempts + ' lần' : ''}).` : '.'), true);
      $('#dvcLoginStep2').hidden = true;
      $('#dvcSync').hidden = false;
      $('#dvcWho').innerHTML = `Đã đăng nhập: <b>${esc(session.mst)}</b> — ${esc(session.ten || '')}`;
      $('#dvcFrom').value = r.suggested_from;
      estimate();
      init();
    } catch (e) { msg('#dvcLoginMsg', e.message); }
  };
  function estimate() {
    const f = $('#dvcFrom').value, t = $('#dvcTo').value;
    if (!f || !t) return;
    const days = (Date.parse(t) - Date.parse(f)) / 86400000 + 1;
    const n = Math.max(1, Math.ceil(days / 31));
    $('#dvcEstimate').textContent = `Khoảng ${n} lượt tra cứu (cổng giới hạn 30 ngày/lượt). Mỗi lượt cần 1 captcha (phần mềm tự đọc, sai mới hỏi bạn); chuyển trang trong cùng lượt thì không cần.`;
  }
  $('#dvcFrom').onchange = estimate; $('#dvcTo').onchange = estimate;

  $('#dvcSyncBtn').onclick = async () => {
    try {
      const j = await api(`/api/dvc/sessions/${session.id}/sync`, 'POST', { from: $('#dvcFrom').value, to: $('#dvcTo').value, download: $('#dvcDownload').checked });
      jobId = j.id; $('#dvcJob').hidden = false; render(j); startPoll();
    } catch (e) { alert(e.message); }
  };
  $('#dvcLogout').onclick = async () => {
    if (session) await api('/api/dvc/sessions/' + session.id, 'DELETE').catch(() => {});
    session = null; $('#dvcSync').hidden = true; $('#dvcLoginStep2').hidden = true; msg('#dvcLoginMsg', 'Đã đóng phiên.', true);
  };

  function startPoll() { clearInterval(pollTimer); pollTimer = setInterval(poll, 1500); }
  async function poll() {
    try { const j = await api('/api/dvc/jobs/' + jobId); render(j); if (!['RUNNING', 'NEED_CAPTCHA'].includes(j.state)) { clearInterval(pollTimer); loadFilings(); } }
    catch (e) { clearInterval(pollTimer); $('#dvcJobStatus').textContent = e.message; }
  }
  let shownCaptcha = null;
  function render(j) {
    const c = j.counts;
    const label = { RUNNING: 'Đang chạy', NEED_CAPTCHA: 'Chờ nhập captcha', DONE: 'Hoàn tất', FAILED: 'Dừng vì lỗi', CANCELLED: 'Đã hủy' }[j.state] || j.state;
    $('#dvcJobStatus').innerHTML = `<b>${label}</b> — khoảng ${c.windows_done}/${c.windows_total}` +
      (j.current_window && j.state !== 'DONE' ? ` (đang: ${esc(j.current_window.from_vn)} – ${esc(j.current_window.to_vn)})` : '') +
      (c.captchas_auto ? ` · captcha tự đọc đúng ${c.captchas_auto_ok}/${c.captchas_auto}` : '') +
      ` · tìm thấy ${c.found} · mới ${c.new} · đổi trạng thái ${c.updated} · đã tải ${c.downloaded}${c.download_total ? '/' + c.download_total : ''} · lỗi tải ${c.download_failed}` +
      (j.error ? `<br><span style="color:#b91c1c">${esc(j.error)}</span>` : '');
    const need = j.state === 'NEED_CAPTCHA' && j.captcha;
    $('#dvcCaptchaBox').hidden = !need;
    if (need && shownCaptcha !== j.captcha.base64) {
      shownCaptcha = j.captcha.base64;
      $('#dvcJobCaptcha').src = img(j.captcha);
      $('#dvcCaptchaMsg').innerHTML = `<b>${esc(j.captcha_message || 'Nhập captcha')}</b>`;
      // điền sẵn mã phần mềm đoán (người dùng sửa nếu sai)
      $('#dvcJobCaptchaInput').value = j.captcha.guess || ''; $('#dvcJobCaptchaInput').focus(); $('#dvcJobCaptchaInput').select();
    }
    $('#dvcCancel').hidden = !['RUNNING', 'NEED_CAPTCHA'].includes(j.state);
    $('#dvcLog').textContent = j.log.map(l => `${l.at.slice(11, 19)}  ${l.msg}`).join('\n');
    $('#dvcLog').scrollTop = 1e9;
  }
  async function sendCaptcha() {
    const v = $('#dvcJobCaptchaInput').value.trim(); if (!v) return;
    try { $('#dvcCaptchaBox').hidden = true; render(await api(`/api/dvc/jobs/${jobId}/captcha`, 'POST', { captcha: v })); } catch (e) { alert(e.message); }
  }
  $('#dvcJobCaptchaSend').onclick = sendCaptcha;
  $('#dvcJobCaptchaInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendCaptcha(); });
  $('#dvcLoginCaptchaInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#dvcLoginBtn').click(); });
  $('#dvcJobCaptchaRefresh').onclick = async () => { try { render(await api(`/api/dvc/jobs/${jobId}/captcha/refresh`, 'POST', {})); } catch (e) { alert(e.message); } };
  $('#dvcCancel').onclick = async () => { try { render(await api(`/api/dvc/jobs/${jobId}/cancel`, 'POST', {})); } catch (e) { alert(e.message); } };

  async function loadFilings() {
    const cid = (session && session.company_id) || $('#dvcCompany').value;
    const list = await api('/api/filings' + (cid ? '?company_id=' + encodeURIComponent(cid) : ''));
    $('#dvcFilings').innerHTML = list.length ? `<p>${list.length} hồ sơ</p><table><tr><th>Mã hồ sơ</th><th>Nguồn</th><th>Tờ khai</th><th>Kỳ</th><th>Loại</th><th>Lần BS</th><th>Ngày nộp</th><th>Trạng thái</th><th>File</th><th>Thông tin trong XML</th></tr>${list.map(f => `<tr>
      <td>${esc(f.ma_ho_so)}</td><td>${f.source === 'DVC' ? 'DVC' : 'Thuế ĐT'}</td><td>${esc(f.to_khai)}</td><td>${esc(f.ky_tinh_thue)}</td><td>${esc(f.loai_to_khai)}</td><td>${esc(f.lan_bo_sung)}</td>
      <td>${esc(f.ngay_nop)}</td><td>${esc(f.trang_thai)}</td>
      <td>${f.file ? `<a href="/api/filings/${encodeURIComponent(f.id)}/file">Tải (${Math.ceil(f.file.size / 1024)} KB)</a>` : (f.download_error ? `<span style="color:#b91c1c" title="${esc(f.download_error)}">Lỗi tải</span>` : 'Chưa tải')}</td>
      <td>${f.xml_info ? `${esc(f.xml_info.ma_tkhai)} · kỳ ${esc(f.xml_info.ky_kkhai)} · ${f.xml_info.loai_tkhai === 'B' ? 'bổ sung lần ' + esc(f.xml_info.so_lan) : 'chính thức'}${f.xml_info.indicators && f.xml_info.indicators['40'] !== undefined ? ' · [40] = ' + Number(f.xml_info.indicators['40']).toLocaleString('vi-VN') : ''}` : ''}</td></tr>`).join('')}</table>`
      : '<p class="muted">Chưa có tờ khai nào được đồng bộ.</p>';
  }
  $('#dvcReloadFilings').onclick = loadFilings;
  $('#dvcCompany').onchange = loadFilings;
  init().catch(e => { $('#dvcMode').textContent = e.message; });
})();
