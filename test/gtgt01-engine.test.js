'use strict';
// Kiểm thử Engine 01/GTGT TT80: phân loại chỉ tiêu, công thức, PL 142, quy tắc kiểm tra HTKK.
const test = require('node:test');
const assert = require('node:assert');
const { parseInvoiceXml } = require('../src/parsers/invoiceXmlParser');
const { computeGtgt01 } = require('../src/engines/gtgt01/engine');
const { checkDeclaration } = require('../src/engines/gtgt01/rules');
const { parsePeriod } = require('../src/domain/period');
const { invoiceXml } = require('./helpers/invoiceXml');

const ME = '0100000001';
const Q3 = parsePeriod('2026-Q3');
let seq = 0;
const nextNo = () => String(++seq).padStart(8, '0');

function buy(groups, extra = {}) {
  return parseInvoiceXml(invoiceXml(Object.assign({
    number: nextNo(),
    items: groups.map(g => ({ name: extra.itemName || `Vật tư ${g.tsuat}`, amount: g.net, tsuat: g.tsuat })),
    groups,
  }, extra)));
}
function sell(groups, extra = {}) {
  return parseInvoiceXml(invoiceXml(Object.assign({
    seller: { mst: ME, name: 'CÔNG TY MÌNH' }, buyer: { mst: '0400000004', name: 'KHÁCH HÀNG' },
    series: 'C26TMM', number: nextNo(),
    items: groups.map(g => ({ name: extra.itemName || `Hàng bán ${g.tsuat}`, amount: g.net, tsuat: g.tsuat })),
    groups,
  }, extra)));
}
const run = (invoices, more = {}) => computeGtgt01(Object.assign({ company: { taxCode: ME }, period: Q3, invoices }, more));

test('engine: phân loại bán ra theo thuế suất vào đúng chỉ tiêu HTKK', () => {
  const d = run([
    sell([{ tsuat: 'KCT', net: '1000000', vat: '0' }]),
    sell([{ tsuat: '0%', net: '2000000', vat: '0' }]),
    sell([{ tsuat: '5%', net: '3000000', vat: '150000' }]),
    sell([{ tsuat: '10%', net: '4000000', vat: '400000' }]),
    sell([{ tsuat: 'KKKNT', net: '500000', vat: '0' }]),
  ]);
  const c = d.ct;
  assert.strictEqual(c['26'], 1000000);
  assert.strictEqual(c['29'], 2000000);
  assert.deepStrictEqual([c['30'], c['31']], [3000000, 150000]);
  assert.deepStrictEqual([c['32'], c['33']], [4000000, 400000]);
  assert.strictEqual(c['32a'], 500000);
  assert.strictEqual(c['27'], 2000000 + 3000000 + 4000000 + 500000);  // [29]+[30]+[32]+[32a]
  assert.strictEqual(c['28'], 550000);                                 // [31]+[33]
  assert.strictEqual(c['34'], 1000000 + c['27']);                      // [26]+[27]
  assert.strictEqual(c['35'], c['28']);
  assert.strictEqual(c['21'], false);
  assert.strictEqual(d.pl142, null);
  assert.deepStrictEqual(d.checks, []);
});

test('engine: mua vào chỉ cộng nhóm có thuế GTGT vào [23]/[24]/[25]', () => {
  const kkknt = buy([{ tsuat: 'KKKNT', net: '700000', vat: '0' }]);
  const hdbh = parseInvoiceXml(invoiceXml({ khms: '2', series: 'C26MYY', number: nextNo(), items: [{ name: 'Ăn uống', amount: '525000' }], totals: { payable: '525000' } }));
  const d = run([
    buy([{ tsuat: '10%', net: '10000000', vat: '1000000' }]),
    buy([{ tsuat: '8%', net: '5000000', vat: '400000' }]),
    kkknt, hdbh,
  ]);
  assert.deepStrictEqual([d.ct['23'], d.ct['24'], d.ct['25']], [15000000, 1400000, 1400000]);
  const d2 = run([kkknt, hdbh], { options: { includeNoVatPurchasesIn23: true } });
  assert.deepStrictEqual([d2.ct['23'], d2.ct['24']], [1225000, 0]);
});

test('engine: [25] trừ hóa đơn không được khấu trừ', () => {
  const a = buy([{ tsuat: '10%', net: '10000000', vat: '1000000' }]);
  const b = buy([{ tsuat: '10%', net: '2000000', vat: '200000' }]);
  const d = run([a, b], { nonDeductibleKeys: [b.key] });
  assert.deepStrictEqual([d.ct['24'], d.ct['25']], [1200000, 1000000]);
});

test('engine: phải nộp — [40a] = [36]-[22]+[37]-[38]-[39a] và [40] = [40a]-[40b]', () => {
  const d = run([
    sell([{ tsuat: '10%', net: '100000000', vat: '10000000' }]),
    buy([{ tsuat: '10%', net: '30000000', vat: '3000000' }]),
  ], { previous: { ct43: 1000000 }, manual: { '37': 500000, '38': 200000, '40b': 300000 } });
  const c = d.ct;
  assert.strictEqual(c['36'], 7000000);
  assert.strictEqual(c['22'], 1000000);
  assert.strictEqual(c['40a'], 7000000 - 1000000 + 500000 - 200000);
  assert.strictEqual(c['40'], c['40a'] - 300000);
  assert.deepStrictEqual([c['41'], c['43']], [0, 0]);
});

test('engine: còn khấu trừ — [41] = |X|, [43] = [41]-[42]', () => {
  const d = run([
    sell([{ tsuat: '10%', net: '10000000', vat: '1000000' }]),
    buy([{ tsuat: '10%', net: '50000000', vat: '5000000' }]),
  ], { previous: { ct43: 2000000 }, manual: { '42': 1000000 } });
  const c = d.ct;
  assert.strictEqual(c['36'], -4000000);
  assert.deepStrictEqual([c['40a'], c['40'], c['41'], c['42'], c['43']], [0, 0, 6000000, 1000000, 5000000]);
});

test('engine: [22] nhập tay khác [43] kỳ trước -> cảnh báo N của HTKK', () => {
  const d = run([], { previous: { ct43: 5000 }, manual: { '22': 6000 } });
  assert.strictEqual(d.ct['22'], 6000);
  assert.ok(d.checks.some(x => x.code === 'HTKK_22_43' && x.level === 'N'));
});

test('engine: không phát sinh -> [21] = true, các chỉ tiêu bằng 0, [43] chuyển tiếp [22]', () => {
  const d = run([], { previous: { ct43: 3000000 } });
  assert.strictEqual(d.ct['21'], true);
  assert.strictEqual(d.ct['22'], 3000000);
  assert.strictEqual(d.ct['41'], 3000000);
  assert.strictEqual(d.ct['43'], 3000000);
  assert.deepStrictEqual(d.checks, []);
});

test('engine: hàng 8% vào [32]/[33] với thuế thực tế, lập PL 142 và [33] = [32]x10% - [08]', () => {
  const s1 = sell([{ tsuat: '8%', net: '924360500', vat: '73948840' }], { itemName: 'Sản phẩm A' });
  const s2 = sell([{ tsuat: '8%', net: '621420900', vat: '49713672' }], { itemName: 'Sản phẩm A' });
  const s3 = sell([{ tsuat: '10%', net: '1000000', vat: '100000' }]);
  const p1 = buy([{ tsuat: '8%', net: '4600200', vat: '368016' }], { itemName: 'Nguyên liệu' });
  const d = run([s1, s2, s3, p1]);
  assert.deepStrictEqual([d.ct['32'], d.ct['33']], [1546781400, 123762512]);
  const pl = d.pl142;
  assert.ok(pl);
  assert.deepStrictEqual(pl.sales, [{ name: 'Sản phẩm A', value: 1545781400, rateStd: 10, rateReduced: 8, reduced: 30915628, vatOnInvoices: 123662512 }]);
  assert.deepStrictEqual(pl.purchases, [{ name: 'Nguyên liệu', value: 4600200, vat: 368016 }]);
  assert.strictEqual(pl.totalReduced, 30915628);   // [08]
  assert.strictEqual(pl.totalPurchaseVat, 368016); // [06]
  assert.strictEqual(pl.ct9, 30915628 - 368016);   // [09] = [08] - [06]
  // [32] x 10% - [08] = 154678140 - 30915628 = 123762512 = [33]
  assert.ok(!d.checks.some(x => x.code === 'HTKK_33'));
});

test('engine: PL 142 phân bổ nhóm 8% xuống dòng hàng, dòng chiết khấu mang dấu âm, tổng khớp tờ khai', () => {
  const s = parseInvoiceXml(invoiceXml({
    seller: { mst: ME, name: 'MÌNH' }, buyer: { mst: '0400000004', name: 'KHÁCH' }, number: nextNo(),
    items: [
      { name: 'Áo', amount: '600000', tsuat: '8%' },
      { name: 'Quần', amount: '400000', tsuat: '8%' },
      { nature: 3, name: 'giảm giá', amount: '100000', tsuat: '8%' },
    ],
    groups: [{ tsuat: '8%', net: '900000', vat: '72000' }],
  }));
  const d = run([s]);
  const sum = d.pl142.sales.reduce((a, l) => a + l.value, 0);
  assert.strictEqual(sum, d.ct['32']);
  assert.deepStrictEqual(d.pl142.sales.map(l => [l.name, l.value]), [['Áo', 600000], ['Quần', 400000], ['Chiết khấu: giảm giá', -100000]]);
});

test('engine: chỉ có mua vào 8% thì không lập PL 142 và có ghi chú', () => {
  const d = run([buy([{ tsuat: '8%', net: '1000000', vat: '80000' }])]);
  assert.strictEqual(d.pl142, null);
  assert.ok(d.notices.some(n => /không lập PL 142/.test(n)));
});

test('engine: loại trùng, hóa đơn gốc bị thay thế, bán ra ngoài kỳ, hóa đơn không liên quan', () => {
  const orig = buy([{ tsuat: '10%', net: '1000000', vat: '100000' }], { number: '00009001' });
  const dup = buy([{ tsuat: '10%', net: '1000000', vat: '100000' }], { number: '00009001' });
  const repl = buy([{ tsuat: '10%', net: '1200000', vat: '120000' }], {
    number: '00009002', related: { nature: '1', khms: '1', series: 'C26TAA', number: '00009001', date: '2026-08-15' },
  });
  const outOld = sell([{ tsuat: '10%', net: '999', vat: '100' }], { date: '2026-06-30' });
  const other = parseInvoiceXml(invoiceXml({ number: nextNo(), buyer: { mst: '0999999999', name: 'NGƯỜI KHÁC' }, groups: [{ tsuat: '10%', net: '1', vat: '0' }] }));
  const d = run([orig, dup, repl, outOld, other]);
  assert.deepStrictEqual([d.ct['23'], d.ct['24']], [1200000, 120000]);
  const reasons = d.selection.excluded.map(x => x.reason).join(' | ');
  assert.match(reasons, /Trùng hóa đơn/);
  assert.match(reasons, /đã bị thay thế/);
  assert.match(reasons, /ngoài Quý 3\/2026/);
  assert.match(reasons, /đều khác MST/);
});

test('engine: mua vào ngoài kỳ mặc định vẫn khấu trừ (kèm ghi chú), có thể cấu hình loại', () => {
  const late = buy([{ tsuat: '10%', net: '1000000', vat: '100000' }], { date: '2026-05-20' });
  const d = run([late]);
  assert.strictEqual(d.ct['24'], 100000);
  assert.ok(d.notices.some(n => /ngoài kỳ/.test(n)));
  const d2 = run([late], { options: { purchasesOutOfPeriod: 'exclude' } });
  assert.strictEqual(d2.ct['24'], 0);
});

test('engine: thuế suất KHAC bị loại để xử lý thủ công; chỉ tiêu nhập tay không hợp lệ bị từ chối', () => {
  const k = buy([{ tsuat: 'KHAC:5.26%', net: '1000', vat: '53' }]);
  const d = run([k]);
  assert.strictEqual(d.ct['23'], 0);
  assert.match(d.selection.excluded[0].reason, /KHAC/);
  assert.throws(() => run([], { manual: { '33': 1 } }), /không nhập tay được/);
  assert.throws(() => run([], { manual: { '37': 1.5 } }), /số nguyên/);
});

test('rules: lỗi chặn Y theo HTKK', () => {
  const ct = { '21': false, '22': 0, '23': 100, '23a': 200, '24': 300, '24a': 250, '25': 400, '26': 0, '27': 0, '28': 0, '29': 0,
    '30': 10, '31': 20, '32': 0, '32a': 0, '33': 0, '34': 0, '35': 0, '36': 0, '37': 0, '38': 0, '39a': 0,
    '40a': 5, '40b': 6, '40': 0, '41': 0, '42': 1, '43': 0 };
  const codes = checkDeclaration(ct).filter(c => c.level === 'Y').map(c => c.code).sort();
  assert.deepStrictEqual(codes, ['HTKK_23A', 'HTKK_24A', 'HTKK_24_23', 'HTKK_25_24', 'HTKK_31_GT_30', 'HTKK_40B', 'HTKK_42'].sort());
});
