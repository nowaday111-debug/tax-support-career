const $ = s => document.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString('vi-VN');
let selected = null;
async function api(path, method, body) {
  const r = await fetch(path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(t.error || ('Lỗi ' + r.status));
  return t;
}
async function loadPeriods() {
  const periods = await api('/api/periods');
  const companies = await api('/api/companies');
  const cmap = Object.fromEntries(companies.map(c => [c.id, c]));
  $('#periods').innerHTML = periods.length ? `<table><tr><th>Kỳ</th><th>Loại</th><th>Mẫu</th><th>Công ty</th><th>Trạng thái</th><th></th></tr>${periods.map(p => `<tr><td>${p.period_key}</td><td>${p.period_type}</td><td>${p.form_version}</td><td>${(cmap[p.company_id] || {}).name || ''} (${(cmap[p.company_id] || {}).tax_code || ''})</td><td>${p.status}</td><td><button onclick="selectPeriod('${p.id}')">Chọn</button></td></tr>`).join('')}</table>` : '<p class="muted">Chưa có kỳ nào. Bấm “Nạp dữ liệu mẫu” để thử ngay.</p>';
}
window.selectPeriod = async (id) => { selected = id; await loadDetail(); };
async function loadDetail() {
  const d = await api('/api/periods/' + selected);
  const invRows = d.invoices.map(i => `<tr><td>${i.seller_tax_code}</td><td>${i.template_symbol}/${i.symbol}/${i.invoice_number}</td><td>${i.issue_date}</td><td>${i.direction}</td><td>${i.kind}</td><td>${i.item_name}</td><td>${fmt(i.net_amount)}</td><td>${i.vat_rate}</td><td>${fmt(i.vat_amount)}</td><td>${i.status}${i.reason ? ' — ' + i.reason : ''}</td><td>${i.status === 'WARNING' ? `<button onclick="ack('${i.id}')">Xác nhận cảnh báo</button>` : ''}</td></tr>`).join('');
  $('#detail').innerHTML = `
  <p><b>Kỳ ${d.period_key}</b> — ${d.form_version} — ${d.start_date} đến ${d.end_date} — Trạng thái: <b>${d.status}</b> ${d.snapshot_hash ? '— snapshot: ' + d.snapshot_hash.slice(0, 16) + '…' : ''}</p>
  <h3>Thêm hóa đơn (nhập tay)</h3>
  <form id="invForm">
    <input name="seller_tax_code" placeholder="MST người bán" required>
    <input name="seller_name" placeholder="Tên người bán">
    <input name="template_symbol" placeholder="Ký hiệu mẫu" required>
    <input name="symbol" placeholder="Ký hiệu HĐ" required>
    <input name="invoice_number" placeholder="Số HĐ" required>
    <input name="issue_date" type="date" required>
    <select name="direction"><option value="OUT">Bán ra</option><option value="IN">Mua vào</option></select>
    <select name="kind"><option value="ORIGINAL">Gốc</option><option value="CANCELLED">Đã hủy</option><option value="REPLACEMENT">Thay thế</option><option value="ADJUSTMENT">Điều chỉnh</option></select>
    <input name="item_name" placeholder="Tên hàng/dịch vụ">
    <input name="net_amount" type="number" placeholder="Tiền chưa VAT" required>
    <select name="vat_rate"><option value="10">10%</option><option value="8">8%</option><option value="5">5%</option><option value="0">0%</option><option value="exempt">Không chịu thuế</option></select>
    <input name="vat_amount" type="number" placeholder="Tiền VAT" required>
    <label><input type="checkbox" name="deductible" checked> Được khấu trừ</label>
    <label><input type="checkbox" name="is_deduction"> Hàng bán bị trả lại (ghi âm)</label>
    <button>Thêm hóa đơn</button>
  </form>
  <h3>Import CSV</h3>
  <textarea id="csvBox" rows="4" cols="100" placeholder="seller_tax_code,seller_name,template_symbol,symbol,invoice_number,issue_date,direction,kind,item_name,net_amount,vat_rate,vat_amount,total_amount,deductible,is_deduction"></textarea><br>
  <button id="csvBtn">Import CSV</button> <span id="csvMsg" class="muted"></span>
  <h3>Bảng kê hóa đơn</h3>
  <table><tr><th>MST bán</th><th>Hóa đơn</th><th>Ngày</th><th>Chiều</th><th>Loại</th><th>Hàng hóa</th><th>Chưa VAT</th><th>Thuế suất</th><th>VAT</th><th>Trạng thái</th><th></th></tr>${invRows || '<tr><td colspan="11">Chưa có hóa đơn</td></tr>'}</table>
  <h3>Tờ khai 01/GTGT</h3>
  <button id="calcBtn">Tính tờ khai</button> <button id="lockBtn">Khóa kỳ</button> <button id="filedBtn">Đánh dấu đã nộp ngoài hệ thống</button>
  <div id="decl"></div>
  <h3>Tờ khai bổ sung (chỉ khi kỳ đã khóa/nộp — 37/38 chỉ từ đây, không tự sinh từ hóa đơn kỳ hiện tại)</h3>
  <input id="suppReason" placeholder="Lý do bổ sung" size="50">
  <input id="adj37" type="number" placeholder="Điều chỉnh giảm 37" value="0">
  <input id="adj38" type="number" placeholder="Điều chỉnh tăng 38" value="0">
  <button id="suppBtn">Lập tờ khai bổ sung</button>
  <h3>Giấy nộp tiền &amp; đối soát</h3>
  <select id="payType"><option value="GTGT">GTGT</option><option value="TNCN">TNCN</option></select>
  <input id="payAmount" type="number" placeholder="Số tiền đã nộp">
  <input id="payDue" type="number" placeholder="Số phải nộp (chỉ TNCN, GTGT lấy từ chỉ tiêu 40)">
  <input id="payDate" type="date">
  <input id="payReceipt" placeholder="Số chứng từ/biên lai">
  <button id="payBtn">Ghi giấy nộp tiền</button> <button id="reconBtn">Xem đối soát</button>
  <div id="recon"></div>
  <h3>Xuất file</h3>
  <p><a href="/api/periods/${d.id}/exports/htkk.xml" target="_blank">Tải XML HTKK (để import, không nộp trực tiếp)</a> |
  <a href="/api/periods/${d.id}/exports/ledger.csv">Tải bảng kê CSV (chung)</a> |
  <a href="/api/periods/${d.id}/exports/ledger.xls">Tải bảng kê Excel .xls (chung, không phải mẫu MISA)</a></p>
  <p class="muted">Chưa khóa kỳ thì file XML có dấu NHÁP trong tên file. Sau khóa, file xuất từ snapshot đã khóa.</p>`;
  $('#invForm').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); const b = Object.fromEntries(f.entries()); b.deductible = f.get('deductible') === 'on'; b.is_deduction = f.get('is_deduction') === 'on'; b.net_amount = Number(b.net_amount); b.vat_amount = Number(b.vat_amount); b.vat_rate = b.vat_rate === 'exempt' ? 'exempt' : Number(b.vat_rate); try { await api('/api/periods/' + selected + '/invoices', 'POST', b); await loadDetail(); } catch (err) { alert(err.message); } };
  $('#csvBtn').onclick = async () => { try { const r = await api('/api/periods/' + selected + '/invoices/import', 'POST', { csv: $('#csvBox').value }); $('#csvMsg').textContent = `Đã tạo ${r.created}, trùng ${r.duplicate}, lỗi ${r.errors.length}`; if (r.errors.length) alert(JSON.stringify(r.errors, null, 2)); await loadDetail(); } catch (err) { alert(err.message); } };
  $('#calcBtn').onclick = async () => { try { const r = await api('/api/periods/' + selected + '/declaration/calculate', 'POST', {}); showDecl(r.declaration, r.calculation); } catch (err) { alert(err.message); } };
  $('#lockBtn').onclick = async () => { if (!confirm('Khóa kỳ? Sau khóa không sửa trực tiếp được, mọi sửa phải qua tờ khai bổ sung.')) return; try { const r = await api('/api/periods/' + selected + '/lock', 'POST', {}); showDecl(r.declaration, null); await loadPeriods(); await loadDetail(); } catch (err) { alert(err.message); } };
  $('#filedBtn').onclick = async () => { try { await api('/api/periods/' + selected + '/filed', 'POST', {}); await loadPeriods(); await loadDetail(); } catch (err) { alert(err.message); } };
  $('#suppBtn').onclick = async () => { try { const r = await api('/api/periods/' + selected + '/supplements', 'POST', { reason: $('#suppReason').value, adj37: Number($('#adj37').value), adj38: Number($('#adj38').value), extra_invoices: [] }); showDecl(r.declaration, r.calculation); await loadDetail(); } catch (err) { alert(err.message); } };
  $('#payBtn').onclick = async () => { try { await api('/api/periods/' + selected + '/payments', 'POST', { tax_type: $('#payType').value, amount_paid: Number($('#payAmount').value), amount_due: $('#payDue').value ? Number($('#payDue').value) : undefined, paid_date: $('#payDate').value, receipt_no: $('#payReceipt').value }); alert('Đã ghi giấy nộp tiền'); } catch (err) { alert(err.message); } };
  $('#reconBtn').onclick = async () => { const r = await api('/api/periods/' + selected + '/reconciliation'); $('#recon').innerHTML = '<pre>' + JSON.stringify(r, null, 2) + '</pre>'; };
}
window.ack = async (id) => { try { await api('/api/periods/' + selected + '/invoices/' + id + '/ack-warning', 'POST', {}); await loadDetail(); } catch (err) { alert(err.message); } };
function showDecl(decl, calc) {
  const rows = Object.entries(decl.indicators).map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`).join('');
  $('#decl').innerHTML = `<table><tr><th>Chỉ tiêu</th><th>Giá trị (VNĐ)</th></tr>${rows}</table>
  <p class="muted">Mẫu 01/GTGT TT80 (HTKK maTKhai 842, bản 2.8.3). Bán ra: 0% -> [29]; 5% -> [30]/[31]; 10% và 8% -> [32]/[33]; không chịu thuế -> [26]. [27] = [29]+[30]+[32]+[32a]. [22] = [43] kỳ trước. [37]/[38] chỉ từ tờ khai bổ sung.</p>
  ${calc && calc.checks && calc.checks.length ? `<p><b>Kiểm tra theo HTKK:</b><br>${calc.checks.map(c => (c.level === 'Y' ? 'LỖI: ' : 'Cảnh báo: ') + c.message).join('<br>')}</p>` : ''}
  ${calc ? `<p>${calc.appendix142 ? '<b>Có PL 142:</b> [08] thuế được giảm ' + fmt(calc.appendix142.totalReduced) + ', [06] thuế mua vào 8% ' + fmt(calc.appendix142.totalPurchaseVat) + ', [09] chênh lệch ' + fmt(calc.appendix142.ct9) : '<b>Không có PL 142:</b> ' + calc.appendix142_reason}</p>` : ''}
  ${decl.appendix142 && decl.appendix142.totalReduced !== undefined ? `<p><b>PL 142 của bản đã lưu:</b> [08] ${fmt(decl.appendix142.totalReduced)}, [06] ${fmt(decl.appendix142.totalPurchaseVat)}, [09] ${fmt(decl.appendix142.ct9)}</p>` : ''}`;
}
$('#seedBtn').onclick = async () => { try { const r = await api('/api/seed', 'POST', {}); $('#seedMsg').textContent = r.note || 'Đã nạp dữ liệu mẫu'; await loadPeriods(); } catch (err) { alert(err.message); } };
$('#createPeriod').onclick = async () => {
  try {
    const companies = await api('/api/companies');
    const cid = $('#companyId').value.trim() || (companies[0] && companies[0].id);
    if (!cid) return alert('Chưa có công ty — bấm Nạp dữ liệu mẫu trước');
    await api('/api/periods', 'POST', { company_id: cid, period_type: $('#periodType').value, period_key: $('#periodKey').value.trim(), prev43_manual: Number($('#prev43').value) });
    await loadPeriods();
  } catch (err) { alert(err.message); }
};
$('#reload').onclick = loadPeriods;
loadPeriods();
