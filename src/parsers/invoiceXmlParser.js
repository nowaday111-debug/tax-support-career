'use strict';
// Bóc tách hóa đơn điện tử XML theo cấu trúc TT78/2021 (gốc <HDon>).
// Đường dẫn thẻ được đối chiếu với 69 hóa đơn thật (36 nhà cung cấp, tháng 4–9/2026):
//   HDon/DLHDon/TTChung: PBan, THDon, KHMSHDon, KHHDon, SHDon, NLap, DVTTe, TGia, TTHDLQuan
//   HDon/DLHDon/NDHDon/NBan|NMua: Ten, MST, DChi
//   HDon/DLHDon/NDHDon/DSHHDVu/HHDVu: TChat, STT, MHHDVu, THHDVu, DVTinh, SLuong, DGia, ThTien, TSuat, TThue
//   HDon/DLHDon/NDHDon/TToan: THTTLTSuat/LTSuat(TSuat, ThTien, TThue), TgTCThue, TgTThue, TTCKTMai, TgTTTBSo
//   HDon/MCCQT: mã của cơ quan thuế
// Tổng theo thuế suất lấy từ THTTLTSuat (số liệu người bán đã chốt), không cộng lại từ dòng hàng.

const xml = require('../infrastructure/xml/miniXml');
const { toVnd, mulToVnd, percentOf } = require('../domain/money');
const { RATE, ITEM_NATURE, invoiceKey } = require('../domain/models');

class InvoiceParseError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** '8%' -> {rate:'8'}, 'KCT' -> {rate:'KCT'}, 'KHAC:5.26%' -> {rate:'KHAC', ratePercent:'5.26'} */
function normalizeRate(raw) {
  if (raw === null || raw === undefined) return { rate: null, ratePercent: null };
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  if (s === '') return { rate: null, ratePercent: null };
  if (s === 'KCT') return { rate: RATE.KCT, ratePercent: null };
  if (s === 'KKKNT') return { rate: RATE.KKKNT, ratePercent: null };
  let m = /^KHAC:?(\d+(?:[.,]\d+)?)%?$/.exec(s);
  if (m) return { rate: RATE.KHAC, ratePercent: m[1].replace(',', '.') };
  m = /^(\d+(?:[.,]\d+)?)%?$/.exec(s);
  if (m) {
    const v = m[1].replace(',', '.');
    const n = Number(v);
    if ([0, 5, 8, 10].includes(n)) return { rate: String(n), ratePercent: null };
    return { rate: RATE.KHAC, ratePercent: v };
  }
  return { rate: RATE.KHAC, ratePercent: null, raw: s };
}

function party(el) {
  return {
    name: xml.text(el, 'Ten') || '',
    taxCode: (xml.text(el, 'MST') || '').replace(/\s+/g, ''),
    address: xml.text(el, 'DChi') || '',
  };
}

/**
 * @param {Buffer|string} input  nội dung file XML
 * @param {{sourceFile?: string}} [opts]
 * @returns {import('../domain/models').Invoice}
 */
function parseInvoiceXml(input, opts = {}) {
  let root;
  try { root = xml.parse(input); } catch (e) { throw new InvoiceParseError('BAD_XML', `XML không hợp lệ: ${e.message}`); }
  if (root.name !== 'HDon') {
    throw new InvoiceParseError('NOT_TT78',
      `Gốc XML là <${root.name}>, không phải <HDon> theo TT78/2021. Không bóc tách để tránh đọc sai.`);
  }
  const dl = xml.child(root, 'DLHDon');
  const tt = xml.at(root, 'DLHDon/TTChung');
  const nd = xml.at(root, 'DLHDon/NDHDon');
  if (!dl || !tt || !nd) throw new InvoiceParseError('MISSING_BLOCK', 'Thiếu DLHDon/TTChung hoặc DLHDon/NDHDon');

  const warnings = [];
  const currency = (xml.text(tt, 'DVTTe') || 'VND').toUpperCase();
  const exchangeRate = xml.text(tt, 'TGia') || null;
  const foreign = currency !== 'VND';
  if (foreign && !exchangeRate) throw new InvoiceParseError('NO_RATE', `Hóa đơn ngoại tệ ${currency} thiếu tỷ giá TGia`);
  const money = v => {
    if (v === null || v === '') return null;
    const r = foreign ? mulToVnd(v, exchangeRate) : toVnd(v);
    if (r === null) warnings.push(`Không đọc được số tiền "${v}"`);
    return r;
  };

  const inv = {
    key: '',
    format: 'TT78',
    version: xml.text(tt, 'PBan') || '',
    title: xml.text(tt, 'THDon') || '',
    templateCode: xml.text(tt, 'KHMSHDon') || '',
    series: xml.text(tt, 'KHHDon') || '',
    number: xml.text(tt, 'SHDon') || '',
    issueDate: (xml.text(tt, 'NLap') || '').slice(0, 10),
    currency,
    exchangeRate: foreign ? exchangeRate : null,
    authorityCode: xml.text(root, 'MCCQT') || null,
    seller: party(xml.child(nd, 'NBan')),
    buyer: party(xml.child(nd, 'NMua')),
    items: [],
    rateGroups: [],
    totals: { net: null, vat: null, discount: null, payable: null },
    related: null,
    warnings,
    sourceFile: opts.sourceFile,
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.issueDate)) warnings.push(`Ngày lập không đúng định dạng: "${xml.text(tt, 'NLap')}"`);
  if (!inv.series || !inv.number || !inv.seller.taxCode) warnings.push('Thiếu ký hiệu, số hóa đơn hoặc MST người bán');

  // Hóa đơn liên quan (thay thế/điều chỉnh). Thẻ rỗng <TTHDLQuan/> nghĩa là hóa đơn gốc.
  const lq = xml.child(tt, 'TTHDLQuan');
  if (lq && lq.children.length) {
    inv.related = {
      nature: xml.text(lq, 'TCHDon') || '',          // 1 = thay thế, 2 = điều chỉnh
      type: xml.text(lq, 'LHDCLQuan') || '',
      templateCode: xml.text(lq, 'KHMSHDCLQuan') || '',
      series: xml.text(lq, 'KHHDCLQuan') || '',
      number: xml.text(lq, 'SHDCLQuan') || '',
      issueDate: (xml.text(lq, 'NLHDCLQuan') || '').slice(0, 10),
      note: xml.text(lq, 'GChu') || '',
    };
    if (!inv.related.nature) warnings.push('Có thông tin hóa đơn liên quan nhưng thiếu TCHDon (tính chất thay thế/điều chỉnh)');
  }

  for (const h of xml.children(xml.child(nd, 'DSHHDVu'), 'HHDVu')) {
    const r = normalizeRate(xml.text(h, 'TSuat'));
    const nature = Number(xml.text(h, 'TChat') || ITEM_NATURE.GOODS);
    inv.items.push({
      lineNo: Number(xml.text(h, 'STT') || 0),
      nature,
      code: xml.text(h, 'MHHDVu') || '',
      name: xml.text(h, 'THHDVu') || '',
      unit: xml.text(h, 'DVTinh') || '',
      quantity: xml.text(h, 'SLuong'),
      unitPrice: xml.text(h, 'DGia'),
      amount: money(xml.text(h, 'ThTien')) || 0,
      rate: r.rate,
      ratePercent: r.ratePercent,
      vat: money(xml.text(h, 'TThue')),
    });
  }

  const tto = xml.child(nd, 'TToan');
  inv.totals = {
    net: money(xml.text(tto, 'TgTCThue')),
    vat: money(xml.text(tto, 'TgTThue')),
    discount: money(xml.text(tto, 'TTCKTMai')),
    payable: money(xml.text(tto, 'TgTTTBSo')),
  };

  for (const l of xml.children(xml.child(tto, 'THTTLTSuat'), 'LTSuat')) {
    const r = normalizeRate(xml.text(l, 'TSuat'));
    inv.rateGroups.push({ rate: r.rate, ratePercent: r.ratePercent, net: money(xml.text(l, 'ThTien')) || 0, vat: money(xml.text(l, 'TThue')) || 0 });
  }

  if (inv.rateGroups.length === 0) {
    if (inv.templateCode === '1') {
      deriveGroupsFromItems(inv);
    } else {
      // Hóa đơn không phải HĐ GTGT (vd KHMSHDon=2 hóa đơn bán hàng): không có thuế GTGT.
      const base = inv.totals.net !== null ? inv.totals.net : (inv.totals.payable || 0);
      inv.rateGroups.push({ rate: RATE.NONE, ratePercent: null, net: base, vat: 0 });
    }
  }

  checkTotals(inv);
  if (/^C/i.test(inv.series) && !inv.authorityCode) warnings.push('Hóa đơn có mã (ký hiệu bắt đầu bằng C) nhưng không có MCCQT');
  for (const g of inv.rateGroups) {
    if (g.rate === RATE.KHAC) warnings.push(`Thuế suất khác (KHAC${g.ratePercent ? ':' + g.ratePercent + '%' : ''}) — cần xử lý thủ công`);
    if (g.rate === null) warnings.push('Nhóm thuế suất không ghi TSuat');
  }

  inv.key = invoiceKey(inv);
  return inv;
}

function deriveGroupsFromItems(inv) {
  const groups = new Map();
  for (const it of inv.items) {
    if (it.nature === ITEM_NATURE.NOTE) continue;
    const sign = it.nature === ITEM_NATURE.DISCOUNT ? -1 : 1;
    const k = it.rate === RATE.KHAC ? `KHAC:${it.ratePercent}` : String(it.rate);
    const g = groups.get(k) || { rate: it.rate, ratePercent: it.ratePercent, net: 0, vat: 0 };
    g.net += sign * it.amount;
    if (it.vat !== null) g.vat += sign * it.vat;
    else if (['0', '5', '8', '10'].includes(it.rate)) g.vat += sign * percentOf(it.amount, it.rate);
    groups.set(k, g);
  }
  inv.rateGroups = [...groups.values()];
  inv.warnings.push('Không có bảng tổng hợp theo thuế suất (THTTLTSuat) — đã cộng lại từ dòng hàng hóa');
}

function checkTotals(inv) {
  const sumNet = inv.rateGroups.reduce((a, g) => a + g.net, 0);
  const sumVat = inv.rateGroups.reduce((a, g) => a + g.vat, 0);
  const tol = Math.max(1, inv.rateGroups.length);
  if (inv.totals.net !== null && Math.abs(sumNet - inv.totals.net) > tol) {
    inv.warnings.push(`Tổng tiền chưa thuế theo thuế suất (${sumNet}) lệch TgTCThue (${inv.totals.net})`);
  }
  if (inv.totals.vat !== null && Math.abs(sumVat - inv.totals.vat) > tol) {
    inv.warnings.push(`Tổng tiền thuế theo thuế suất (${sumVat}) lệch TgTThue (${inv.totals.vat})`);
  }
  for (const g of inv.rateGroups) {
    if (['5', '8', '10'].includes(g.rate)) {
      const expect = percentOf(g.net, g.rate);
      // Người bán có thể tính thuế theo từng dòng rồi cộng; cho phép lệch nhỏ.
      if (Math.abs(expect - g.vat) > Math.max(2, inv.items.length)) {
        inv.warnings.push(`Thuế nhóm ${g.rate}% = ${g.vat} khác ${g.net} x ${g.rate}% = ${expect}`);
      }
    }
  }
}

module.exports = { parseInvoiceXml, normalizeRate, InvoiceParseError };
