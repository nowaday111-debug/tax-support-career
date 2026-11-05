'use strict';
// Chọn hóa đơn đưa vào tờ khai 01/GTGT của một kỳ: xác định chiều mua/bán, chống trùng,
// loại hóa đơn gốc đã bị thay thế, lọc theo kỳ. Thuần tính toán, không đọc file.

const { DIRECTION, RATE } = require('../../domain/models');
const { inPeriod } = require('../../domain/period');

const normTax = s => String(s || '').replace(/\s+/g, '').toUpperCase();

/**
 * @param {import('../../domain/models').Invoice[]} invoices
 * @param {{companyTaxCode:string, period:Object, options?:{
 *   purchasesOutOfPeriod?: 'include'|'exclude',
 *   excludeKeys?: string[],
 * }}} ctx
 * @returns {{included: Array<{inv:Object, direction:string, notes:string[]}>, excluded: Array<{inv:Object, reason:string}>, notices: string[]}}
 */
function selectInvoices(invoices, ctx) {
  const opts = Object.assign({ purchasesOutOfPeriod: 'include', excludeKeys: [] }, ctx.options || {});
  const me = normTax(ctx.companyTaxCode);
  if (!me) throw new Error('Thiếu MST doanh nghiệp');
  const userExcluded = new Set(opts.excludeKeys || []);
  const included = [];
  const excluded = [];
  const notices = [];

  // 1. Chống trùng theo khóa MST bán|mẫu số|ký hiệu|số
  const seen = new Map();
  const unique = [];
  for (const inv of invoices) {
    if (seen.has(inv.key)) {
      excluded.push({ inv, reason: `Trùng hóa đơn ${inv.key} (đã có từ ${seen.get(inv.key).sourceFile || 'file khác'})` });
      continue;
    }
    seen.set(inv.key, inv);
    unique.push(inv);
  }

  // 2. Hóa đơn gốc bị thay thế bởi hóa đơn khác trong cùng bộ dữ liệu
  const replacedKeys = new Set();
  for (const inv of unique) {
    if (inv.related && inv.related.nature === '1') {
      const k = [inv.seller.taxCode, inv.related.templateCode, inv.related.series, inv.related.number].join('|');
      if (seen.has(k)) replacedKeys.add(k);
      else notices.push(`HĐ ${inv.key} thay thế cho ${k} nhưng không thấy hóa đơn gốc trong dữ liệu — kiểm tra kỳ kê khai của hóa đơn gốc`);
    }
    if (inv.related && inv.related.nature === '2') {
      notices.push(`HĐ ${inv.key} là hóa đơn điều chỉnh cho ${inv.related.series}-${inv.related.number} — số liệu được cộng theo dấu ghi trên hóa đơn, cần rà soát`);
    }
  }

  for (const inv of unique) {
    if (userExcluded.has(inv.key)) { excluded.push({ inv, reason: 'Người dùng loại khỏi tờ khai' }); continue; }
    if (replacedKeys.has(inv.key)) { excluded.push({ inv, reason: 'Hóa đơn gốc đã bị thay thế' }); continue; }
    let direction = DIRECTION.UNRELATED;
    if (normTax(inv.seller.taxCode) === me) direction = DIRECTION.OUT;
    else if (normTax(inv.buyer.taxCode) === me) direction = DIRECTION.IN;
    if (direction === DIRECTION.UNRELATED) {
      excluded.push({ inv, reason: `MST người bán (${inv.seller.taxCode}) và người mua (${inv.buyer.taxCode}) đều khác MST doanh nghiệp` });
      continue;
    }
    const notes = [];
    if (!inPeriod(inv.issueDate, ctx.period)) {
      if (direction === DIRECTION.OUT) {
        excluded.push({ inv, reason: `Hóa đơn bán ra ngày ${inv.issueDate} ngoài ${ctx.period.label}` });
        continue;
      }
      if (opts.purchasesOutOfPeriod === 'exclude') {
        excluded.push({ inv, reason: `Hóa đơn mua vào ngày ${inv.issueDate} ngoài ${ctx.period.label}` });
        continue;
      }
      notes.push(`Mua vào ngày ${inv.issueDate} ngoài kỳ, vẫn kê khai khấu trừ trong ${ctx.period.label}`);
    }
    if (direction === DIRECTION.OUT && inv.templateCode !== '1') {
      excluded.push({ inv, reason: `Hóa đơn bán ra mẫu số ${inv.templateCode} (không phải hóa đơn GTGT) không kê khai trên 01/GTGT` });
      continue;
    }
    if (inv.rateGroups.some(g => g.rate === RATE.KHAC || g.rate === null)) {
      excluded.push({ inv, reason: 'Có nhóm thuế suất KHAC hoặc không ghi thuế suất — cần xử lý thủ công' });
      continue;
    }
    included.push({ inv, direction, notes });
  }
  return { included, excluded, notices };
}

module.exports = { selectInvoices };
