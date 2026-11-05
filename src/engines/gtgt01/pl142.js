'use strict';
// Phụ lục giảm thuế GTGT (NQ 142/2024, 174/2024, 204/2025) — thẻ PLuc/PL_NQ142_GTGT.
// Cấu trúc theo XSD 01_GTGT_TT80_283.xsd:
//   Mục I  HH_DV_MuaVaoTrongKy/BangKeTenHHDV: tenHHDVMuaVao, giaTriHHDVMuaVao (3), thueGTGTHHDV (4)
//   Mục II HH_DV_BanRaTrongKy/BangKeTenHHDV: tenHHDV, giaTriHHDV (3), thueSuatTheoQuyDinh (4),
//          thueSuatSauGiam (5)=(4)x80%, thueGTGTDuocGiam (6)=(3)x[(4)-(5)]
//   Mục III ChenhLech/ct9: [09] = [08] - [06]
//   [06] = tổng cột (4) mục I; [08] = tổng cột (6) mục II.
// Số tiền theo nhóm 8% của từng hóa đơn (THTTLTSuat) được phân bổ xuống các dòng hàng 8%
// theo thành tiền (dòng chiết khấu TChat=3 mang dấu âm), nên tổng phụ lục khớp đúng tờ khai.

const { allocate, percentOf } = require('../../domain/money');
const { ITEM_NATURE, DIRECTION } = require('../../domain/models');

const RATE_STD = 10;      // thuế suất theo quy định của hàng hóa được giảm
const RATE_REDUCED = 8;   // (5) = (4) x 80%
const NAME_MAX = 200;     // MaxLen của ô tên hàng trong layout HTKK (01_10_MGT_GTGT_TT80_283)

function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

/** Tách nhóm 8% của một hóa đơn thành các dòng {name, value, vat}. */
function linesOf8(inv) {
  const g = inv.rateGroups.find(x => x.rate === '8');
  if (!g) return [];
  const items = inv.items.filter(it => it.rate === '8' && it.nature !== ITEM_NATURE.NOTE);
  const weights = items.map(it => (it.nature === ITEM_NATURE.DISCOUNT ? -1 : 1) * it.amount);
  if (items.length === 0 || weights.every(w => w === 0)) {
    return [{ name: `Hàng hóa, dịch vụ theo HĐ ${inv.series}-${inv.number}`, value: g.net, vat: g.vat }];
  }
  const values = allocate(g.net, weights);
  const vats = allocate(g.vat, weights);
  return items.map((it, i) => ({
    name: it.nature === ITEM_NATURE.DISCOUNT ? `Chiết khấu: ${cleanName(it.name)}` : cleanName(it.name),
    value: values[i], vat: vats[i],
  })).filter(l => l.value !== 0 || l.vat !== 0);
}

function groupByName(lines) {
  const m = new Map();
  for (const l of lines) {
    const k = l.name.toLowerCase();
    const cur = m.get(k) || { name: l.name, value: 0, vat: 0 };
    cur.value += l.value;
    cur.vat += l.vat;
    m.set(k, cur);
  }
  return [...m.values()];
}

/**
 * @param {Array<{inv:Object, direction:string}>} included  kết quả selectInvoices().included
 * @returns {{pl: import('../../domain/models').PL142|null, notices: string[]}}
 */
function buildPl142(included) {
  const notices = [];
  const salesLines = [];
  const purchaseLines = [];
  for (const { inv, direction } of included) {
    const lines = linesOf8(inv);
    if (direction === DIRECTION.OUT) salesLines.push(...lines);
    else if (direction === DIRECTION.IN && inv.templateCode === '1') purchaseLines.push(...lines);
  }
  if (salesLines.length === 0) {
    if (purchaseLines.length) notices.push('Chỉ có mua vào thuế suất 8%, không có bán ra 8% nên không lập PL 142 (theo phương án dự án).');
    return { pl: null, notices };
  }
  const fixName = l => {
    if (l.name.length > NAME_MAX) { notices.push(`Tên hàng dài hơn ${NAME_MAX} ký tự đã được cắt: ${l.name.slice(0, 40)}…`); l.name = l.name.slice(0, NAME_MAX); }
    return l;
  };
  const purchases = groupByName(purchaseLines).map(fixName);
  const sales = groupByName(salesLines).map(fixName).map(l => ({
    name: l.name,
    value: l.value,
    rateStd: RATE_STD,
    rateReduced: RATE_REDUCED,
    reduced: percentOf(l.value, RATE_STD - RATE_REDUCED),
    vatOnInvoices: l.vat,
  }));
  const totalPurchaseValue = purchases.reduce((a, l) => a + l.value, 0);
  const totalPurchaseVat = purchases.reduce((a, l) => a + l.vat, 0);
  const totalSalesValue = sales.reduce((a, l) => a + l.value, 0);
  const totalReduced = sales.reduce((a, l) => a + l.reduced, 0);
  return {
    pl: {
      purchases, sales,
      totalPurchaseValue, totalPurchaseVat,
      totalSalesValue, totalReduced,
      ct9: totalReduced - totalPurchaseVat,
    },
    notices,
  };
}

module.exports = { buildPl142, linesOf8, RATE_STD, RATE_REDUCED };
