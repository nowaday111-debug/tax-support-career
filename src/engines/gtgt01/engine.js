'use strict';
// Engine lập tờ khai 01/GTGT mẫu TT80 (HTKK maTKhai 842, bản 2.8.3).
// Công thức theo nhãn chỉ tiêu trong XSD 01_GTGT_TT80_283.xsd và mẫu Excel HTKK:
//   [27] = [29] + [30] + [32] + [32a]     [28] = [31] + [33]
//   [34] = [26] + [27]                     [35] = [28]
//   [36] = [35] - [25]
//   X    = [36] - [22] + [37] - [38] - [39a]
//   [40a] = X nếu X >= 0, ngược lại 0      [40] = [40a] - [40b]
//   [41]  = |X| nếu X < 0, ngược lại 0     [43] = [41] - [42]
// Phân loại doanh thu bán ra theo thuế suất trên hóa đơn:
//   KCT -> [26]; 0% -> [29]; 5% -> [30]/[31]; 10% và 8% (giảm thuế) -> [32]/[33]; KKKNT -> [32a].
//   Hàng 8% ghi vào dòng 10% với số thuế thực tế trên hóa đơn; phần giảm kê trên PL 142
//   (quy tắc HTKK: "[33] = [32] x 10% - [08] trên PL NQ 142/2024/QH15").
// Mua vào: [23]/[24] cộng các nhóm có thuế GTGT (0/5/8/10%). Nhóm KCT, KKKNT và hóa đơn
//   không có thuế GTGT chỉ cộng vào [23] khi bật includeNoVatPurchasesIn23.
//   [25] = [24] trừ thuế của hóa đơn bị đánh dấu không được khấu trừ.

const { RATE, DIRECTION, emptyDeclarationCt } = require('../../domain/models');
const { selectInvoices } = require('./selection');
const { buildPl142 } = require('./pl142');
const { checkDeclaration } = require('./rules');
const { formFor01Gtgt } = require('../../config/htkkForms');

const VAT_RATES = new Set([RATE.R0, RATE.R5, RATE.R8, RATE.R10]);
const MANUAL_KEYS = ['22', '23a', '24a', '37', '38', '39a', '40b', '42'];

/**
 * @param {{
 *   company: {taxCode: string},
 *   period: Object,                       // domain/period.makePeriod()
 *   invoices: Object[],                   // kết quả parseInvoiceXml()
 *   previous?: {ct43?: number},           // tờ khai lần đầu kỳ trước liền kề
 *   manual?: Object<string, number>,      // các chỉ tiêu nhập tay: 22, 23a, 24a, 37, 38, 39a, 40b, 42
 *   nonDeductibleKeys?: string[],         // hóa đơn mua vào không được khấu trừ
 *   options?: {includeNoVatPurchasesIn23?: boolean, purchasesOutOfPeriod?: 'include'|'exclude', excludeKeys?: string[]}
 * }} input
 * @returns {import('../../domain/models').TaxDeclaration01GTGT & {selection: Object, notices: string[]}}
 */
function computeGtgt01(input) {
  const form = formFor01Gtgt(input.period);
  const options = Object.assign({ includeNoVatPurchasesIn23: false }, input.options || {});
  const manual = input.manual || {};
  for (const k of Object.keys(manual)) {
    if (!MANUAL_KEYS.includes(k)) throw new Error(`Chỉ tiêu [${k}] không nhập tay được (chỉ nhận ${MANUAL_KEYS.join(', ')})`);
    if (!Number.isSafeInteger(manual[k])) throw new Error(`Chỉ tiêu [${k}] nhập tay phải là số nguyên VND`);
  }
  const nonDeductible = new Set(input.nonDeductibleKeys || []);

  const selection = selectInvoices(input.invoices || [], {
    companyTaxCode: input.company.taxCode,
    period: input.period,
    options,
  });
  const notices = [...selection.notices];

  const ct = emptyDeclarationCt();
  const sources = {};
  const track = (k, inv, amount) => {
    if (!amount) return;
    (sources[k] = sources[k] || []).push({ key: inv.key, amount });
  };

  for (const { inv, direction } of selection.included) {
    for (const g of inv.rateGroups) {
      if (direction === DIRECTION.IN) {
        const hasVat = VAT_RATES.has(g.rate) && inv.templateCode === '1';
        if (hasVat) {
          ct['23'] += g.net; track('23', inv, g.net);
          ct['24'] += g.vat; track('24', inv, g.vat);
          if (!nonDeductible.has(inv.key)) { ct['25'] += g.vat; track('25', inv, g.vat); }
        } else if (options.includeNoVatPurchasesIn23) {
          ct['23'] += g.net; track('23', inv, g.net);
        }
      } else {
        switch (g.rate) {
          case RATE.KCT: ct['26'] += g.net; track('26', inv, g.net); break;
          case RATE.R0: ct['29'] += g.net; track('29', inv, g.net); break;
          case RATE.R5:
            ct['30'] += g.net; track('30', inv, g.net);
            ct['31'] += g.vat; track('31', inv, g.vat); break;
          case RATE.R10:
          case RATE.R8:
            ct['32'] += g.net; track('32', inv, g.net);
            ct['33'] += g.vat; track('33', inv, g.vat); break;
          case RATE.KKKNT: ct['32a'] += g.net; track('32a', inv, g.net); break;
          default: throw new Error(`Thuế suất ${g.rate} của HĐ ${inv.key} chưa được phân loại`);
        }
      }
    }
  }
  for (const k of nonDeductible) {
    if (!selection.included.some(x => x.inv.key === k && x.direction === DIRECTION.IN)) {
      notices.push(`Hóa đơn ${k} được đánh dấu không khấu trừ nhưng không có trong hóa đơn mua vào của kỳ`);
    }
  }

  // Chỉ tiêu nhập tay
  const prev43 = input.previous && Number.isSafeInteger(input.previous.ct43) ? input.previous.ct43 : null;
  ct['22'] = manual['22'] !== undefined ? manual['22'] : (prev43 !== null ? prev43 : 0);
  for (const k of ['23a', '24a', '37', '38', '39a', '40b', '42']) if (manual[k] !== undefined) ct[k] = manual[k];

  // Công thức
  ct['27'] = ct['29'] + ct['30'] + ct['32'] + ct['32a'];
  ct['28'] = ct['31'] + ct['33'];
  ct['34'] = ct['26'] + ct['27'];
  ct['35'] = ct['28'];
  ct['36'] = ct['35'] - ct['25'];
  const x = ct['36'] - ct['22'] + ct['37'] - ct['38'] - ct['39a'];
  ct['40a'] = x >= 0 ? x : 0;
  ct['40'] = ct['40a'] - ct['40b'];
  ct['41'] = x < 0 ? -x : 0;
  ct['43'] = ct['41'] - ct['42'];

  const hasActivity = selection.included.length > 0 ||
    ['23', '23a', '24', '24a', '25', '26', '27', '28', '37', '38', '39a'].some(k => ct[k] !== 0);
  ct['21'] = !hasActivity;

  const { pl: pl142, notices: plNotices } = buildPl142(selection.included);
  notices.push(...plNotices);

  const checks = checkDeclaration(ct, { pl142, previousCt43: prev43 });
  for (const { inv, notes } of selection.included) for (const n of notes) notices.push(`${inv.key}: ${n}`);
  for (const { inv } of selection.included) for (const w of inv.warnings) notices.push(`${inv.key}: ${w}`);

  return {
    form: form.id,
    period: input.period,
    company: input.company,
    ct,
    pl142,
    checks,
    blocking: checks.some(c => c.level === 'Y'),
    sources,
    selection: {
      included: selection.included.map(x => ({ key: x.inv.key, direction: x.direction, issueDate: x.inv.issueDate })),
      excluded: selection.excluded.map(x => ({ key: x.inv.key, reason: x.reason })),
    },
    notices,
  };
}

module.exports = { computeGtgt01, MANUAL_KEYS };
