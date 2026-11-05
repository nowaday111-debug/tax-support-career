// BẢN DÙNG THỬ — Module A "Hóa đơn & Tờ khai" (01/GTGT + PL 142)
// KHÔNG nộp thuế thật, KHÔNG ký số, KHÔNG dùng dữ liệu thật, KHÔNG tích hợp nhà cung cấp.
// Stack: Node.js + Express, lưu JSON file (data/db.json). Tiền tính bằng số nguyên (đồng).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { computeGtgt01 } = require('./src/engines/gtgt01/engine');
const { buildGtgt01Tt80Xml } = require('./src/exporters/htkk/gtgt01Tt80Xml');
const { parsePeriod } = require('./src/domain/period');
const { parseInvoiceXml } = require('./src/parsers/invoiceXmlParser');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/csv', limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const db = { companies: [], periods: [], invoices: [], payments: [], supplements: [], audit: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
let db = loadDb();
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function audit(action, entity, entity_id, detail) {
  db.audit.push({ at: new Date().toISOString(), action, entity, entity_id, detail: detail || '' });
  saveDb();
}
function err(res, code, msg) { return res.status(code).json({ error: msg }); }

// ---------- Kỳ & mẫu biểu ----------
// Mẫu 01/GTGT theo HTKK 5.8.2: chỉ có mẫu TT80 (maTKhai 842, bản 2.8.3) trong menu HTKK.
// Mẫu 01/GTGT TT89 đã có XSD nhưng HTKK chưa phát hành, nên mọi kỳ đều dùng TT80
// (xem docs/buoc-1-mapping.md, mục 2.1). Tham số giữ lại để tương thích chữ ký hàm cũ.
function formVersion(/* periodType, key */) { return 'TT80/2021'; }
function periodRange(periodType, key) {
  if (periodType === 'MONTH') {
    const [y, m] = key.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(y, m, 0).getDate();
    return { start, end: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
  }
  const [y, q] = key.split('-Q').map(Number);
  const sm = (q - 1) * 3 + 1, em = q * 3;
  const last = new Date(y, em, 0).getDate();
  return { start: `${y}-${String(sm).padStart(2, '0')}-01`, end: `${y}-${String(em).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}
// Kỳ liền trước (cùng công ty, cùng loại kỳ)
function prevPeriodKey(periodType, key) {
  if (periodType === 'MONTH') {
    let [y, m] = key.split('-').map(Number); m -= 1; if (m === 0) { m = 12; y -= 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  let [y, q] = key.split('-Q').map(Number); q -= 1; if (q === 0) { q = 4; y -= 1; }
  return `${y}-Q${q}`;
}
function getPeriod(id) { return db.periods.find(p => p.id === id); }
function getCompany(id) { return db.companies.find(c => c.id === id); }

// ---------- Hóa đơn ----------
// Khóa chống trùng: MST người bán + ký hiệu mẫu + ký hiệu hóa đơn + số hóa đơn (theo công ty).
function dedupKey(inv) { return [inv.seller_tax_code, inv.template_symbol, inv.symbol, inv.invoice_number].join('|'); }
function validateInvoice(b) {
  const required = ['seller_tax_code', 'template_symbol', 'symbol', 'invoice_number', 'issue_date', 'direction', 'kind'];
  for (const f of required) if (b[f] === undefined || b[f] === '') return `Thiếu trường bắt buộc: ${f}`;
  if (!['IN', 'OUT'].includes(b.direction)) return 'direction phải là IN (mua vào) hoặc OUT (bán ra)';
  if (!['ORIGINAL', 'CANCELLED', 'REPLACEMENT', 'ADJUSTMENT'].includes(b.kind)) return 'kind không hợp lệ';
  const net = Math.round(Number(b.net_amount) || 0);
  const vat = Math.round(Number(b.vat_amount) || 0);
  const rate = b.vat_rate === 'exempt' ? 'exempt' : Math.round(Number(b.vat_rate) || 0);
  if (![0, 5, 8, 10, 'exempt'].includes(rate)) return 'vat_rate chỉ nhận 0, 5, 8, 10 hoặc exempt';
  if (net < 0 && b.kind !== 'ADJUSTMENT') return 'Chỉ hóa đơn điều chỉnh (ADJUSTMENT) mới có số tiền âm';
  if (rate !== 'exempt' && Math.abs(vat - Math.round(net * rate / 100)) > 1)
    return `Tiền thuế lệch quá 1 đồng so với ${net} x ${rate}% (kỳ vọng ${Math.round(net * rate / 100)}, nhận ${vat})`;
  return null;
}
// Kiểm tra trạng thái ban đầu sau khi validate: hủy -> BLOCKED; còn lại READY hoặc WARNING.
function initialStatus(period, b) {
  if (b.kind === 'CANCELLED') return { status: 'BLOCKED', reason: 'Hóa đơn đã hủy — đóng góp 0 vào tờ khai' };
  if (b.issue_date < period.start_date || b.issue_date > period.end_date)
    return { status: 'WARNING', reason: 'Ngày lập hóa đơn ngoài khoảng kỳ — cần xác nhận trước khi tính' };
  if (!/^\d{10}(\d{3})?$/.test(String(b.seller_tax_code)))
    return { status: 'WARNING', reason: 'MST người bán không đúng định dạng 10 hoặc 13 chữ số' };
  return { status: 'READY', reason: '' };
}
function replacedOriginalIds(periodId) {
  const ids = new Set();
  for (const inv of db.invoices.filter(i => i.period_id === periodId && i.kind === 'REPLACEMENT' && i.replaces_invoice_id))
    ids.add(inv.replaces_invoice_id);
  return ids;
}
// Hóa đơn được tính vào tờ khai: READY hoặc INCLUDED (sau khóa), không phải CANCELLED/BLOCKED/WARNING,
// không phải bản gốc đã bị thay thế, và không tính dòng giảm trừ 32b hai lần ở phần bán ra thông thường.
function includedInvoices(periodId, extraInvoices) {
  const replaced = replacedOriginalIds(periodId);
  const all = db.invoices.filter(i => i.period_id === periodId && ['READY', 'INCLUDED'].includes(i.status))
    .concat(extraInvoices || []);
  return all.filter(i => i.kind !== 'CANCELLED' && !replaced.has(i.id));
}

// ---------- Tax Engine ----------
// Dùng engine mới ở src/engines/gtgt01 (chỉ tiêu theo nhãn HTKK 01/GTGT TT80). Hàm này chỉ chuyển
// bản ghi hóa đơn của ứng dụng thành mô hình hóa đơn của domain rồi gọi engine.
//   vat_rate 10/8 -> [32]/[33]; 5 -> [30]/[31]; 0 -> [29]; exempt -> [26] (KCT).
//   is_deduction (hàng bán bị trả lại) -> ghi số âm ở nhóm thuế suất tương ứng (TT80 không có [32b]).
const RATE_OF = { 10: '10', 8: '8', 5: '5', 0: '0', exempt: 'KCT' };
function toDomainInvoice(row, companyTaxCode) {
  const sign = row.is_deduction ? -1 : 1;
  const rate = RATE_OF[row.vat_rate];
  const net = sign * (Number(row.net_amount) || 0);
  const vat = sign * (Number(row.vat_amount) || 0);
  const isOut = row.direction === 'OUT';
  return {
    key: row.dedup_key + (row.supplement_only ? '|SUPP' : ''), format: 'APP', templateCode: String(row.template_symbol || '1'),
    series: row.symbol, number: row.invoice_number, issueDate: row.issue_date, currency: 'VND', exchangeRate: null,
    authorityCode: null,
    seller: { taxCode: isOut ? companyTaxCode : row.seller_tax_code, name: row.seller_name || '', address: '' },
    buyer: { taxCode: isOut ? '' : companyTaxCode, name: '', address: '' },
    items: [{ lineNo: 1, nature: 1, code: '', name: row.item_name || 'Hàng hóa, dịch vụ', unit: '', quantity: null, unitPrice: null, amount: net, rate, ratePercent: null, vat }],
    rateGroups: [{ rate, ratePercent: null, net, vat }],
    totals: { net, vat, discount: null, payable: net + vat }, related: null, warnings: [], appId: row.id,
  };
}
function calculateDeclaration(period, extraInvoices, manual3738) {
  const invs = includedInvoices(period.id, extraInvoices);
  const company = getCompany(period.company_id);
  // Chỉ tiêu 22: [43] của tờ khai CHÍNH THỨC kỳ liền trước; kỳ đầu nhập tay (mặc định 0).
  const prev = db.periods.find(p => p.company_id === period.company_id && p.period_type === period.period_type && p.period_key === prevPeriodKey(period.period_type, period.period_key));
  let prev43 = Number(period.prev43_manual || 0);
  if (prev) {
    const prevDecl = db.declarations?.find(d => d.period_id === prev.id && d.kind === 'OFFICIAL');
    if (prevDecl) prev43 = Number(prevDecl.indicators['43'] || 0);
  }
  // 37/38: CHỈ từ tờ khai bổ sung (manual3738). Không bao giờ tự sinh từ hóa đơn kỳ hiện tại.
  const manual = {};
  if (manual3738) {
    manual['37'] = Math.round(Number(manual3738['37']) || 0);
    manual['38'] = Math.round(Number(manual3738['38']) || 0);
  }
  const domainInvs = invs.map(i => toDomainInvoice(i, company.tax_code));
  const decl = computeGtgt01({
    company: { taxCode: company.tax_code },
    period: parsePeriod(period.period_key),
    invoices: domainInvs,
    previous: { ct43: prev43 },
    manual,
    nonDeductibleKeys: domainInvs.filter((d, idx) => invs[idx].direction === 'IN' && invs[idx].deductible === false).map(d => d.key),
    // Ứng dụng đã tự kiểm tra kỳ của hóa đơn (trạng thái WARNING) trước khi đưa vào tính.
    options: { purchasesOutOfPeriod: 'include' },
  });
  const usedKeys = new Set(decl.selection.included.map(x => x.key));
  return {
    indicators: decl.ct,
    appendix142: decl.pl142,
    checks: decl.checks,
    notices: decl.notices,
    excluded: decl.selection.excluded,
    has_activity: !decl.ct['21'],
    appendix142_reason: decl.pl142 ? '' : 'Không có bán ra thuế suất 8% trong kỳ nên không lập PL 142.',
    invoice_ids: domainInvs.filter(d => usedKeys.has(d.key)).map(d => d.appId),
  };
}
// Lưu declarations vào db (khởi tạo nếu file cũ chưa có)
if (!db.declarations) db.declarations = [];
function saveDecl(period, kind, supplementNo, calc, basis) {
  const decl = {
    id: uid(), period_id: period.id, kind, supplement_no: supplementNo || 0,
    status: kind === 'OFFICIAL' ? 'DRAFT' : 'SUPPLEMENT',
    indicators: calc.indicators, appendix142: calc.appendix142,
    invoice_ids: calc.invoice_ids, basis: basis || '', created_at: new Date().toISOString(),
  };
  // Ghi đè bản nháp chính thức cũ của kỳ (chỉ giữ 1 bản chính thức đang hiệu lực + các bản bổ sung)
  if (kind === 'OFFICIAL') db.declarations = db.declarations.filter(d => !(d.period_id === period.id && d.kind === 'OFFICIAL'));
  db.declarations.push(decl); saveDb(); return decl;
}

// ---------- API: công ty & kỳ ----------
app.get('/api/health', (req, res) => res.json({ status: 'ok', trial: true, note: 'BẢN DÙNG THỬ — KHÔNG NỘP THUẾ THẬT, KHÔNG DÙNG DỮ LIỆU THẬT' }));
app.get('/api/companies', (req, res) => res.json(db.companies));
const COMPANY_PROFILE_KEYS = ['address', 'ward_name', 'district_code', 'district_name', 'province_code', 'province_name', 'phone', 'fax', 'email', 'tax_office_code', 'tax_office_name', 'signer', 'tieu_muc'];
function pickProfile(b) { const o = {}; for (const k of COMPANY_PROFILE_KEYS) if (b[k] !== undefined) o[k] = String(b[k]); return o; }
app.post('/api/companies', (req, res) => {
  const { tax_code, name } = req.body || {};
  if (!tax_code || !name) return err(res, 400, 'Cần tax_code và name');
  if (db.companies.some(c => c.tax_code === tax_code)) return err(res, 409, 'MST đã tồn tại');
  const c = { id: uid(), tax_code, name, ...pickProfile(req.body), is_sample: false, created_at: new Date().toISOString() };
  db.companies.push(c); saveDb(); audit('CREATE_COMPANY', 'company', c.id, tax_code); res.status(201).json(c);
});
app.patch('/api/companies/:id', (req, res) => {
  const c = getCompany(req.params.id); if (!c) return err(res, 404, 'Không tìm thấy công ty');
  Object.assign(c, pickProfile(req.body || {}));
  if (req.body && req.body.name) c.name = String(req.body.name);
  saveDb(); audit('UPDATE_COMPANY', 'company', c.id, Object.keys(req.body || {}).join(',')); res.json(c);
});
app.get('/api/periods', (req, res) => res.json(db.periods));
app.post('/api/periods', (req, res) => {
  const { company_id, period_type, period_key, prev43_manual } = req.body || {};
  if (!getCompany(company_id)) return err(res, 400, 'Không tìm thấy công ty');
  if (!['MONTH', 'QUARTER'].includes(period_type)) return err(res, 400, 'period_type phải là MONTH hoặc QUARTER');
  if (!period_key) return err(res, 400, 'Cần period_key (vd 2026-07 hoặc 2026-Q3)');
  if (db.periods.some(p => p.company_id === company_id && p.period_type === period_type && p.period_key === period_key))
    return err(res, 409, 'Kỳ này đã tồn tại cho công ty này');
  const range = periodRange(period_type, period_key);
  const p = {
    id: uid(), company_id, period_type, period_key,
    form_version: formVersion(period_type, period_key),
    start_date: range.start, end_date: range.end,
    prev43_manual: Math.round(Number(prev43_manual) || 0),
    status: 'DRAFT', created_at: new Date().toISOString(),
  };
  db.periods.push(p); saveDb(); audit('CREATE_PERIOD', 'period', p.id, `${period_key} ${p.form_version}`); res.status(201).json(p);
});
app.get('/api/periods/:id', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  res.json({ ...p, invoices: db.invoices.filter(i => i.period_id === p.id), payments: db.payments.filter(x => x.period_id === p.id), supplements: db.supplements.filter(s => s.period_id === p.id), declarations: db.declarations.filter(d => d.period_id === p.id) });
});

// ---------- API: hóa đơn ----------
function createInvoice(period, b) {
  const v = validateInvoice(b); if (v) return { error: v };
  const key = dedupKey(b);
  if (db.invoices.some(i => i.company_id === period.company_id && i.dedup_key === key))
    return { duplicate: true, key };
  const st = initialStatus(period, b);
  const inv = {
    id: uid(), company_id: period.company_id, period_id: period.id, dedup_key: key,
    seller_tax_code: b.seller_tax_code, seller_name: b.seller_name || '',
    template_symbol: b.template_symbol, symbol: b.symbol, invoice_number: b.invoice_number,
    issue_date: b.issue_date, direction: b.direction, kind: b.kind,
    item_name: b.item_name || '', net_amount: Math.round(Number(b.net_amount) || 0),
    vat_rate: b.vat_rate === 'exempt' ? 'exempt' : Math.round(Number(b.vat_rate) || 0),
    vat_amount: Math.round(Number(b.vat_amount) || 0),
    total_amount: Math.round(Number(b.total_amount ?? (Number(b.net_amount) || 0) + (Number(b.vat_amount) || 0))),
    deductible: b.deductible !== false, reduced: b.vat_rate === 8,
    is_deduction: b.is_deduction === true,
    replaces_invoice_id: b.replaces_invoice_id || null, adjusted_from_invoice_id: b.adjusted_from_invoice_id || null,
    source: b.source || 'MANUAL', status: st.status, reason: st.reason,
    warning_ack_at: null, created_at: new Date().toISOString(),
  };
  db.invoices.push(inv); saveDb(); audit('CREATE_INVOICE', 'invoice', inv.id, `${inv.dedup_key} -> ${inv.status}`); return { invoice: inv };
}
app.post('/api/periods/:id/invoices', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  if (p.status === 'LOCKED' || p.status === 'FILED') { audit('BLOCKED_EDIT_LOCKED', 'period', p.id, 'Thêm hóa đơn vào kỳ đã khóa'); return err(res, 403, 'Kỳ đã khóa — không sửa trực tiếp được, hãy lập tờ khai bổ sung'); }
  const r = createInvoice(p, req.body || {});
  if (r.error) return err(res, 400, r.error);
  if (r.duplicate) return err(res, 409, `Hóa đơn trùng khóa chống trùng: ${r.key} — đã bị từ chối, không tạo bản ghi mới`);
  res.status(201).json(r.invoice);
});
app.post('/api/periods/:id/invoices/:invId/ack-warning', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  if (p.status === 'LOCKED' || p.status === 'FILED') return err(res, 403, 'Kỳ đã khóa — không sửa trực tiếp được');
  const inv = db.invoices.find(i => i.id === req.params.invId && i.period_id === p.id); if (!inv) return err(res, 404, 'Không tìm thấy hóa đơn');
  if (inv.status !== 'WARNING') return err(res, 400, 'Hóa đơn này không ở trạng thái WARNING');
  inv.status = 'READY'; inv.warning_ack_at = new Date().toISOString(); saveDb(); audit('ACK_WARNING', 'invoice', inv.id, 'Xác nhận cảnh báo, chuyển sang READY'); res.json(inv);
});
// CSV import: nhận JSON {csv: "..."} hoặc text/csv thô. Cột bắt buộc theo header mẫu trong README.
app.post('/api/periods/:id/invoices/import', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  if (p.status === 'LOCKED' || p.status === 'FILED') return err(res, 403, 'Kỳ đã khóa — không import trực tiếp được, hãy lập tờ khai bổ sung');
  const raw = typeof req.body === 'string' ? req.body : (req.body.csv || '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return err(res, 400, 'CSV cần header + ít nhất 1 dòng dữ liệu');
  const header = lines[0].split(',').map(h => h.trim());
  let created = 0, duplicate = 0; const errors = [];
  for (let idx = 1; idx < lines.length; idx++) {
    const vals = lines[idx].split(',').map(v => v.trim());
    const row = {}; header.forEach((h, i) => row[h] = vals[i]);
    const b = {
      seller_tax_code: row.seller_tax_code, seller_name: row.seller_name, template_symbol: row.template_symbol,
      symbol: row.symbol, invoice_number: row.invoice_number, issue_date: row.issue_date,
      direction: row.direction, kind: row.kind || 'ORIGINAL', item_name: row.item_name,
      net_amount: Number(row.net_amount), vat_rate: row.vat_rate === 'exempt' ? 'exempt' : Number(row.vat_rate),
      vat_amount: Number(row.vat_amount), total_amount: Number(row.total_amount),
      deductible: row.deductible !== 'false', is_deduction: row.is_deduction === 'true',
      replaces_invoice_id: row.replaces_invoice_id || null, source: 'CSV',
    };
    const r = createInvoice(p, b);
    if (r.error) errors.push({ line: idx + 1, error: r.error });
    else if (r.duplicate) duplicate++;
    else created++;
  }
  audit('CSV_IMPORT', 'period', p.id, `created=${created} duplicate=${duplicate} errors=${errors.length}`);
  res.json({ created, duplicate, errors });
});

// Import hóa đơn XML TT78 (file gốc tải từ hoadondientu.gdt.gov.vn hoặc nhà cung cấp).
// Body JSON: { files: [{ name, content }] }, content là văn bản XML hoặc base64 (tiền tố "base64:").
// Mỗi nhóm thuế suất của hóa đơn thành một bản ghi; nhiều nhóm thì số hóa đơn thêm hậu tố "#<thuế suất>".
const APP_RATE = { '10': 10, '8': 8, '5': 5, '0': 0, KCT: 'exempt' };
app.post('/api/periods/:id/invoices/import-xml', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  if (p.status === 'LOCKED' || p.status === 'FILED') return err(res, 403, 'Kỳ đã khóa — không import trực tiếp được, hãy lập tờ khai bổ sung');
  const company = getCompany(p.company_id);
  const files = (req.body && req.body.files) || [];
  if (!Array.isArray(files) || !files.length) return err(res, 400, 'Cần files: [{name, content}]');
  let created = 0, duplicate = 0; const errors = [], skipped = [];
  for (const f of files) {
    let inv;
    try {
      const raw = String(f.content || '');
      inv = parseInvoiceXml(raw.startsWith('base64:') ? Buffer.from(raw.slice(7), 'base64') : raw, { sourceFile: f.name });
    } catch (e) { errors.push({ file: f.name, error: e.message }); continue; }
    const direction = inv.seller.taxCode === company.tax_code ? 'OUT' : (inv.buyer.taxCode === company.tax_code ? 'IN' : null);
    if (!direction) { skipped.push({ file: f.name, reason: 'MST người bán và người mua đều khác MST công ty' }); continue; }
    const kind = inv.related ? (inv.related.nature === '1' ? 'REPLACEMENT' : 'ADJUSTMENT') : 'ORIGINAL';
    const multi = inv.rateGroups.length > 1;
    for (const g of inv.rateGroups) {
      const rate = APP_RATE[g.rate];
      if (rate === undefined) { skipped.push({ file: f.name, reason: `Nhóm thuế suất ${g.rate} chưa hỗ trợ trong ứng dụng (dùng scripts/lap-01gtgt.js)` }); continue; }
      const items = inv.items.filter(it => it.rate === g.rate).map(it => it.name).filter(Boolean);
      const r = createInvoice(p, {
        seller_tax_code: inv.seller.taxCode, seller_name: inv.seller.name, template_symbol: inv.templateCode, symbol: inv.series,
        invoice_number: multi ? `${inv.number}#${g.rate}` : inv.number, issue_date: inv.issueDate, direction, kind,
        item_name: items.slice(0, 3).join('; ').slice(0, 200), net_amount: g.net, vat_rate: rate, vat_amount: g.vat,
        total_amount: g.net + g.vat, deductible: true, source: 'XML',
      });
      if (r.error) errors.push({ file: f.name, error: r.error });
      else if (r.duplicate) duplicate++;
      else created++;
    }
  }
  audit('XML_IMPORT', 'period', p.id, `created=${created} duplicate=${duplicate} errors=${errors.length} skipped=${skipped.length}`);
  res.json({ created, duplicate, errors, skipped });
});

// ---------- API: tờ khai, khóa kỳ, bổ sung ----------
app.post('/api/periods/:id/declaration/calculate', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  const calc = calculateDeclaration(p, null, null);
  const decl = saveDecl(p, 'OFFICIAL', 0, calc, 'Tính từ hóa đơn READY/INCLUDED của kỳ; 37/38 = 0 (chỉ bổ sung mới có)');
  res.json({ declaration: decl, calculation: calc });
});
app.post('/api/periods/:id/lock', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  if (p.status === 'LOCKED' || p.status === 'FILED') return err(res, 400, 'Kỳ đã khóa rồi');
  const calc = calculateDeclaration(p, null, null);
  const decl = saveDecl(p, 'OFFICIAL', 0, calc, 'Snapshot khi khóa kỳ');
  const snapshot = JSON.stringify({ period_id: p.id, indicators: decl.indicators, invoice_ids: decl.invoice_ids });
  p.status = 'LOCKED'; p.snapshot_hash = crypto.createHash('sha256').update(snapshot).digest('hex'); p.locked_at = new Date().toISOString(); saveDb();
  for (const inv of db.invoices.filter(i => i.period_id === p.id && i.status === 'READY')) inv.status = 'INCLUDED';
  saveDb(); audit('LOCK_PERIOD', 'period', p.id, `snapshot=${p.snapshot_hash}`); res.json({ period: p, declaration: decl });
});
app.post('/api/periods/:id/filed', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  if (p.status !== 'LOCKED') return err(res, 400, 'Chỉ kỳ đã khóa mới đánh dấu đã nộp (FILED) — việc nộp thật thực hiện ngoài hệ thống qua HTKK/eTax');
  p.status = 'FILED'; saveDb(); audit('MARK_FILED', 'period', p.id, 'Kế toán xác nhận đã nộp ngoài hệ thống'); res.json(p);
});
app.post('/api/periods/:id/supplements', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  if (p.status !== 'LOCKED' && p.status !== 'FILED') return err(res, 400, 'Chỉ kỳ đã khóa/nộp mới lập tờ khai bổ sung');
  const { reason, adj37, adj38, extra_invoices } = req.body || {};
  if (!reason) return err(res, 400, 'Bổ sung bắt buộc có lý do (reason)');
  // Hóa đơn bổ sung: lưu riêng, không sửa hóa đơn/invoice gốc của kỳ đã khóa.
  const extras = [];
  for (const b of (extra_invoices || [])) {
    const v = validateInvoice(b); if (v) return err(res, 400, `Hóa đơn bổ sung lỗi: ${v}`);
    const inv = { id: uid(), company_id: p.company_id, period_id: p.id, dedup_key: dedupKey(b) + '|SUPP',
      seller_tax_code: b.seller_tax_code, seller_name: b.seller_name || '', template_symbol: b.template_symbol,
      symbol: b.symbol, invoice_number: b.invoice_number, issue_date: b.issue_date, direction: b.direction, kind: b.kind,
      item_name: b.item_name || '', net_amount: Math.round(Number(b.net_amount) || 0),
      vat_rate: b.vat_rate === 'exempt' ? 'exempt' : Math.round(Number(b.vat_rate) || 0),
      vat_amount: Math.round(Number(b.vat_amount) || 0), total_amount: Math.round(Number(b.total_amount ?? 0)),
      deductible: b.deductible !== false, reduced: b.vat_rate === 8, is_deduction: b.is_deduction === true,
      source: 'SUPPLEMENT', status: 'READY', reason: 'Hóa đơn của tờ khai bổ sung', supplement_only: true, created_at: new Date().toISOString() };
    extras.push(inv);
  }
  const calc = calculateDeclaration(p, extras, { '37': adj37, '38': adj38 });
  for (const inv of extras) db.invoices.push(inv); // chỉ lưu sau khi tính, tránh tính trùng
  const no = (db.supplements.filter(s => s.period_id === p.id).length + 1);
  const decl = saveDecl(p, 'SUPPLEMENT', no, calc, reason);
  const supp = { id: uid(), period_id: p.id, supplement_no: no, reason, adj37: Math.round(Number(adj37) || 0), adj38: Math.round(Number(adj38) || 0), declaration_id: decl.id, extra_invoice_ids: extras.map(i => i.id), created_at: new Date().toISOString() };
  db.supplements.push(supp); saveDb(); audit('CREATE_SUPPLEMENT', 'period', p.id, `Bổ sung #${no}: ${reason}`);
  res.status(201).json({ supplement: supp, declaration: decl, calculation: calc });
});

// ---------- API: giấy nộp tiền & đối soát ----------
app.post('/api/periods/:id/payments', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  const { tax_type, amount_paid, amount_due, paid_date, receipt_no } = req.body || {};
  if (!['GTGT', 'TNCN'].includes(tax_type)) return err(res, 400, 'tax_type phải là GTGT hoặc TNCN');
  const pay = { id: uid(), period_id: p.id, tax_type, amount_paid: Math.round(Number(amount_paid) || 0), amount_due: amount_due !== undefined ? Math.round(Number(amount_due)) : null, paid_date: paid_date || '', receipt_no: receipt_no || '', created_at: new Date().toISOString() };
  db.payments.push(pay); saveDb(); audit('CREATE_PAYMENT', 'period', p.id, `${tax_type} ${pay.amount_paid}`); res.status(201).json(pay);
});
app.get('/api/periods/:id/reconciliation', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  const decl = db.declarations.find(d => d.period_id === p.id && d.kind === 'OFFICIAL');
  const byType = (type) => {
    const pays = db.payments.filter(x => x.period_id === p.id && x.tax_type === type);
    const paid = pays.reduce((a, x) => a + x.amount_paid, 0);
    let due = null;
    if (type === 'GTGT') due = decl ? Number(decl.indicators['40'] || 0) : null;
    else { const manual = pays.find(x => x.amount_due !== null); due = manual ? manual.amount_due : null; }
    if (due === null) return { tax_type: type, amount_due: null, amount_paid: paid, difference: null, status: 'NO_DECLARATION', note: 'Chưa có số phải nộp để đối soát (GTGT: chưa có tờ khai; TNCN: chưa nhập số phải nộp).' };
    const diff = paid - due;
    return { tax_type: type, amount_due: due, amount_paid: paid, difference: diff, status: diff === 0 ? 'MATCHED' : (diff < 0 ? 'UNDERPAID' : 'OVERPAID'), note: diff === 0 ? 'Khớp' : (diff < 0 ? `Nộp thiếu ${-diff} đồng` : `Nộp thừa ${diff} đồng`) };
  };
  res.json({ period_id: p.id, declaration_40: decl ? decl.indicators['40'] : null, results: [byType('GTGT'), byType('TNCN')] });
});

// ---------- API: xuất file ----------
function escXml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Hồ sơ người nộp thuế dùng cho file XML HTKK (lưu trong bản ghi công ty).
const PROFILE_FIELDS = ['address', 'province_code', 'province_name', 'tax_office_code', 'tax_office_name'];
function companyProfile(c) {
  const missing = PROFILE_FIELDS.filter(f => !c[f]);
  if (missing.length) return { error: `Công ty chưa đủ thông tin để xuất XML HTKK: ${missing.join(', ')} (cập nhật qua PATCH /api/companies/:id)` };
  return {
    profile: {
      taxpayer: { taxCode: c.tax_code, name: c.name, address: c.address, wardName: c.ward_name || '', districtCode: c.district_code || '', districtName: c.district_name || '',
        provinceCode: c.province_code, provinceName: c.province_name, phone: c.phone || '', fax: c.fax || '', email: c.email || '' },
      taxOffice: { code: c.tax_office_code, name: c.tax_office_name },
      signer: c.signer || '',
      tieuMuc: c.tieu_muc || undefined,
    },
  };
}
app.get('/api/periods/:id/exports/htkk.xml', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  const company = getCompany(p.company_id);
  const { profile, error } = companyProfile(company);
  if (error) return err(res, 400, error);
  // Luôn tính lại từ hóa đơn để lấy đủ phụ lục và kết quả kiểm tra; kỳ đã khóa dùng chỉ tiêu đã chốt.
  const calc = calculateDeclaration(p, null, null);
  const saved = db.declarations.find(d => d.period_id === p.id && d.kind === 'OFFICIAL');
  const locked = p.status === 'LOCKED' || p.status === 'FILED';
  if (locked && saved && JSON.stringify(saved.indicators) !== JSON.stringify(calc.indicators)) {
    return err(res, 409, 'Số liệu tính lại khác bản đã khóa — không xuất để tránh lệch hồ sơ đã nộp');
  }
  const decl = { form: '01_GTGT_TT80_283', period: parsePeriod(p.period_key), ct: calc.indicators, pl142: calc.appendix142, checks: calc.checks, blocking: calc.checks.some(c => c.level === 'Y') };
  let xml;
  try { xml = buildGtgt01Tt80Xml(decl, profile); } catch (e) { return err(res, 409, e.message); }
  const name = `${locked ? '' : 'NHAP-'}01GTGT-${p.period_key}.xml`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  audit('EXPORT_HTKK', 'period', p.id, name); res.send(xml);
});
function csvEscape(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
app.get('/api/periods/:id/exports/ledger.csv', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  const rows = db.invoices.filter(i => i.period_id === p.id && !i.supplement_only);
  const header = 'seller_tax_code,template_symbol,symbol,invoice_number,issue_date,direction,kind,item_name,net_amount,vat_rate,vat_amount,total_amount,status';
  const body = rows.map(i => [i.seller_tax_code, i.template_symbol, i.symbol, i.invoice_number, i.issue_date, i.direction, i.kind, i.item_name, i.net_amount, i.vat_rate, i.vat_amount, i.total_amount, i.status].map(csvEscape).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bang-ke-chung-${p.period_key}.csv"`);
  audit('EXPORT_LEDGER_CSV', 'period', p.id, `rows=${rows.length}`);
  res.send(`# BẢNG KÊ CHUNG — KHÔNG PHẢI MẪU MISA OFFLINE THEO PHIÊN BẢN CỤ THỂ\n${header}\n${body}\n`);
});
app.get('/api/periods/:id/exports/ledger.xls', (req, res) => {
  const p = getPeriod(req.params.id); if (!p) return err(res, 404, 'Không tìm thấy kỳ');
  const rows = db.invoices.filter(i => i.period_id === p.id && !i.supplement_only);
  const cols = ['seller_tax_code', 'template_symbol', 'symbol', 'invoice_number', 'issue_date', 'direction', 'kind', 'item_name', 'net_amount', 'vat_rate', 'vat_amount', 'total_amount', 'status'];
  const cell = (v, t) => `<Cell><Data ss:Type="${t}">${escXml(v)}</Data></Cell>`;
  const xmlRows = [cols, ...rows.map(i => cols.map(c => i[c]))].map((r, ri) => `<Row>${r.map((v, ci) => cell(v, ri === 0 || ci < 8 || ci === 12 ? 'String' : 'Number')).join('')}</Row>`).join('\n');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="bang-ke-chung-${p.period_key}.xls"`);
  audit('EXPORT_LEDGER_XLS', 'period', p.id, `rows=${rows.length}`);
  res.send(`<?xml version="1.0"?>\n<!-- BẢNG KÊ CHUNG (SpreadsheetML, mở được bằng Excel) — KHÔNG PHẢI MẪU MISA OFFLINE THEO PHIÊN BẢN CỤ THỂ -->\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="BangKe"><Table>${xmlRows}</Table></Worksheet></Workbook>`);
});

// ---------- Seed mẫu (chỉ dữ liệu mẫu, không phải dữ liệu thật) ----------
app.post('/api/seed', (req, res) => {
  if (db.companies.some(c => c.tax_code === '0100000001')) return res.json({ ok: true, note: 'Dữ liệu mẫu đã tồn tại, không tạo lại' });
  const company = { id: uid(), tax_code: '0100000001', name: 'Công ty TNHH Mẫu Dùng Thử', address: 'Số 1 đường Mẫu', province_code: '101', province_name: 'Thành phố Hà Nội', tax_office_code: '10109', tax_office_name: 'Thuế cơ sở 4 Thành phố Hà Nội', signer: 'NGƯỜI KÝ MẪU', is_sample: true, created_at: new Date().toISOString() };
  db.companies.push(company);
  const mkPeriod = (key) => { const r = periodRange('MONTH', key); const p = { id: uid(), company_id: company.id, period_type: 'MONTH', period_key: key, form_version: formVersion('MONTH', key), start_date: r.start, end_date: r.end, prev43_manual: 0, status: 'DRAFT', created_at: new Date().toISOString() }; db.periods.push(p); return p; };
  const pJun = mkPeriod('2026-06'); // TT80
  const pJul = mkPeriod('2026-07'); // TT80 (HTKK chưa có 01/GTGT TT89)
  const pAug = mkPeriod('2026-08'); // chỉ mua vào giảm thuế -> không có PL 142
  const inv = (period, o) => { const r = createInvoice(period, o); if (r.error) throw new Error(r.error); return r.invoice; };
  // Tháng 6/2026: [32] = 10.000.000 (10%) + 5.000.000 (8%) = 15.000.000
  inv(pJun, { seller_tax_code: '0100000001', template_symbol: '1', symbol: 'C26TAA', invoice_number: '0000001', issue_date: '2026-06-10', direction: 'OUT', kind: 'ORIGINAL', item_name: 'Dịch vụ mẫu A', net_amount: 10000000, vat_rate: 10, vat_amount: 1000000, source: 'SAMPLE' });
  inv(pJun, { seller_tax_code: '0100000001', template_symbol: '1', symbol: 'C26TAA', invoice_number: '0000002', issue_date: '2026-06-12', direction: 'OUT', kind: 'ORIGINAL', item_name: 'Hàng giảm thuế', net_amount: 5000000, vat_rate: 8, vat_amount: 400000, source: 'SAMPLE' });
  inv(pJun, { seller_tax_code: '0200000002', template_symbol: '1', symbol: 'C26TBB', invoice_number: '0000101', issue_date: '2026-06-05', direction: 'IN', kind: 'ORIGINAL', item_name: 'Mua vào mẫu', net_amount: 8000000, vat_rate: 10, vat_amount: 800000, source: 'SAMPLE' });
  inv(pJun, { seller_tax_code: '0200000003', template_symbol: '1', symbol: 'C26TBB', invoice_number: '0000102', issue_date: '2026-06-06', direction: 'IN', kind: 'ORIGINAL', item_name: 'Mua vào giảm thuế', net_amount: 2000000, vat_rate: 8, vat_amount: 160000, source: 'SAMPLE' });
  inv(pJun, { seller_tax_code: '0100000001', template_symbol: '1', symbol: 'C26TAA', invoice_number: '0000003', issue_date: '2026-06-15', direction: 'OUT', kind: 'CANCELLED', item_name: 'Đã hủy', net_amount: 3000000, vat_rate: 10, vat_amount: 300000, source: 'SAMPLE' });
  // Tháng 7/2026: [32] = 12.000.000 + 4.000.000 − 1.000.000 (hàng bán bị trả lại, ghi âm) = 15.000.000
  inv(pJul, { seller_tax_code: '0100000001', template_symbol: '1', symbol: 'C26TAA', invoice_number: '0000004', issue_date: '2026-07-10', direction: 'OUT', kind: 'ORIGINAL', item_name: 'Dịch vụ mẫu B', net_amount: 12000000, vat_rate: 10, vat_amount: 1200000, source: 'SAMPLE' });
  inv(pJul, { seller_tax_code: '0100000001', template_symbol: '1', symbol: 'C26TAA', invoice_number: '0000005', issue_date: '2026-07-12', direction: 'OUT', kind: 'ORIGINAL', item_name: 'Hàng giảm thuế', net_amount: 4000000, vat_rate: 8, vat_amount: 320000, source: 'SAMPLE' });
  inv(pJul, { seller_tax_code: '0100000001', template_symbol: '1', symbol: 'C26TAA', invoice_number: '0000006', issue_date: '2026-07-20', direction: 'OUT', kind: 'ADJUSTMENT', item_name: 'Hàng bán bị trả lại', net_amount: 1000000, vat_rate: 10, vat_amount: 100000, is_deduction: true, source: 'SAMPLE' });
  // Tháng 8/2026: chỉ mua vào giảm thuế, không có bán ra giảm thuế -> không sinh PL 142
  inv(pAug, { seller_tax_code: '0200000004', template_symbol: '1', symbol: 'C26TBB', invoice_number: '0000201', issue_date: '2026-08-05', direction: 'IN', kind: 'ORIGINAL', item_name: 'Mua vào giảm thuế', net_amount: 3000000, vat_rate: 8, vat_amount: 240000, source: 'SAMPLE' });
  saveDb(); audit('SEED_SAMPLE', 'company', company.id, 'Tạo dữ liệu mẫu');
  res.json({ ok: true, company, periods: [pJun, pJul, pAug] });
});

app.get('/api/audit', (req, res) => res.json(db.audit.slice(-200)));

// ---------- Đồng bộ tờ khai từ dichvucong.gdt.gov.vn ----------
const dvc = require('./dvc/routes')(app, { getDb: () => db, saveDb, audit, uid, dataDir: DATA_DIR });

const server = app.listen(PORT, () => console.log(`Hoa don & To khai TRIAL dang chay tai http://localhost:${PORT} (dichvucong: ${(process.env.DVC_MODE || 'real').toLowerCase()})`));
async function shutdown() { await dvc.shutdown(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
