'use strict';
// Kiểm thử lớp Parser: tiền tệ, bộ đọc XML, bóc tách hóa đơn TT78, bảng kê.
const test = require('node:test');
const assert = require('node:assert');
const { toVnd, mulToVnd, percentOf, allocate } = require('../src/domain/money');
const xml = require('../src/infrastructure/xml/miniXml');
const { parseInvoiceXml, normalizeRate } = require('../src/parsers/invoiceXmlParser');
const { selectInvoices } = require('../src/engines/gtgt01/selection');
const { buildSummaryLedger, totalsByRate, buildItemLedger, toCsv, SUMMARY_COLUMNS } = require('../src/parsers/ledgerBuilder');
const { parsePeriod } = require('../src/domain/period');
const { invoiceXml } = require('./helpers/invoiceXml');

test('money: làm tròn nửa xa số 0, không sai số dấu phẩy động', () => {
  assert.strictEqual(toVnd('898148.15'), 898148);
  assert.strictEqual(toVnd('71851.85'), 71852);
  assert.strictEqual(toVnd('5424200.000000000'), 5424200);
  assert.strictEqual(toVnd('-0.5'), -1);
  assert.strictEqual(toVnd('0.5'), 1);
  assert.strictEqual(toVnd(''), null);
  assert.strictEqual(toVnd('abc'), null);
  assert.strictEqual(mulToVnd('1234.56', '25450'), 31419552);
  assert.strictEqual(percentOf(1545781400, 2), 30915628);
  assert.strictEqual(percentOf(105, 5), 5); // 5,25 -> 5
  assert.strictEqual(percentOf(110, 5), 6); // 5,5 -> 6
});

test('money: phân bổ theo phần dư lớn nhất giữ đúng tổng, kể cả trọng số âm', () => {
  const parts = allocate(368016, [316000, 455000, -81180]);
  assert.strictEqual(parts.reduce((a, b) => a + b, 0), 368016);
  const p2 = allocate(10, [1, 1, 1]);
  assert.deepStrictEqual(p2.sort(), [3, 3, 4]);
  assert.deepStrictEqual(allocate(7, [0, 0]), [7, 0]);
});

test('miniXml: thẻ có tiền tố, thực thể, CDATA, UTF-16 có BOM', () => {
  const r = xml.parse('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><ds:b>T&#7901; &lt;khai&gt;</ds:b><c><![CDATA[<x>]]></c><d/></a>');
  assert.strictEqual(r.attrs.x, '1 & 2');
  assert.strictEqual(xml.text(r, 'b'), 'Tờ <khai>');
  assert.strictEqual(xml.text(r, 'c'), '<x>');
  assert.strictEqual(xml.text(r, 'd'), '');
  assert.strictEqual(xml.text(r, 'zz'), null);
  const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('<a><b>Thuế</b></a>', 'utf16le')]);
  assert.strictEqual(xml.text(xml.parse(u16), 'b'), 'Thuế');
  assert.throws(() => xml.parse('<a><b></a>'), /không khớp/);
});

test('normalizeRate: các giá trị TSuat gặp trên hóa đơn thật', () => {
  assert.deepStrictEqual(normalizeRate('8%'), { rate: '8', ratePercent: null });
  assert.strictEqual(normalizeRate('10%').rate, '10');
  assert.strictEqual(normalizeRate('KCT').rate, 'KCT');
  assert.strictEqual(normalizeRate('KKKNT').rate, 'KKKNT');
  assert.deepStrictEqual(normalizeRate('KHAC:5.26%'), { rate: 'KHAC', ratePercent: '5.26' });
  assert.strictEqual(normalizeRate('').rate, null);
});

test('parser: hóa đơn 8% có dòng chiết khấu thương mại, lấy tổng từ THTTLTSuat', () => {
  const inv = parseInvoiceXml(invoiceXml({
    items: [
      { name: 'Salad', amount: '316000', tsuat: '8%' },
      { name: 'Combo', amount: '455000', tsuat: '8%' },
      { nature: 3, name: 'Chiết khấu', amount: '81180', tsuat: '8%' },
    ],
    groups: [{ tsuat: '8%', net: '689820', vat: '55186' }],
    totals: { net: '689820', vat: '55186', discount: '81180', payable: '745006' },
  }), { sourceFile: 'a.xml' });
  assert.strictEqual(inv.key, '0300000003|1|C26TAA|00000001');
  assert.strictEqual(inv.issueDate, '2026-08-15');
  assert.deepStrictEqual(inv.rateGroups, [{ rate: '8', ratePercent: null, net: 689820, vat: 55186 }]);
  assert.strictEqual(inv.items.length, 3);
  assert.strictEqual(inv.items[2].nature, 3);
  assert.deepStrictEqual(inv.warnings, []);
});

test('parser: số lẻ thập phân và nhiều nhóm thuế suất (KCT + 8%)', () => {
  const inv = parseInvoiceXml(invoiceXml({
    items: [{ name: 'A', amount: '898148.15', tsuat: '8%' }, { nature: 4, name: 'Ghi chú', amount: '0', tsuat: '' }],
    groups: [{ tsuat: 'KCT', net: '0', vat: '0' }, { tsuat: '8%', net: '898148.15', vat: '71851.85' }],
    totals: { net: '898148.15', vat: '71851.85', payable: '970000' },
  }));
  assert.deepStrictEqual(inv.rateGroups.map(g => [g.rate, g.net, g.vat]), [['KCT', 0, 0], ['8', 898148, 71852]]);
  assert.deepStrictEqual(inv.warnings, []);
});

test('parser: hóa đơn bán hàng (KHMSHDon=2) không có thuế GTGT', () => {
  const inv = parseInvoiceXml(invoiceXml({
    khms: '2', series: 'C26MYY',
    items: [{ name: 'Dịch vụ ăn uống', amount: '525000' }],
    totals: { payable: '525000' },
  }));
  assert.deepStrictEqual(inv.rateGroups, [{ rate: 'NONE', ratePercent: null, net: 525000, vat: 0 }]);
});

test('parser: hóa đơn ngoại tệ được quy đổi theo tỷ giá TGia', () => {
  const inv = parseInvoiceXml(invoiceXml({
    currency: 'USD', rate: '25450',
    items: [{ name: 'Phần mềm', amount: '1000.50', tsuat: '10%' }],
    groups: [{ tsuat: '10%', net: '1000.50', vat: '100.05' }],
    totals: { net: '1000.50', vat: '100.05', payable: '1100.55' },
  }));
  assert.strictEqual(inv.rateGroups[0].net, 25462725);
  assert.strictEqual(inv.rateGroups[0].vat, 2546273);
  assert.strictEqual(inv.exchangeRate, '25450');
});

test('parser: thiếu THTTLTSuat thì cộng từ dòng hàng và cảnh báo', () => {
  const inv = parseInvoiceXml(invoiceXml({
    items: [{ name: 'A', amount: '1000000', tsuat: '10%' }, { nature: 3, name: 'CK', amount: '100000', tsuat: '10%' }],
    totals: { net: '900000', vat: '90000' },
  }));
  assert.deepStrictEqual(inv.rateGroups.map(g => [g.rate, g.net, g.vat]), [['10', 900000, 90000]]);
  assert.ok(inv.warnings.some(w => /THTTLTSuat/.test(w)));
});

test('parser: cảnh báo lệch tổng, thiếu MCCQT, thuế suất KHAC', () => {
  const inv = parseInvoiceXml(invoiceXml({
    mccqt: null,
    items: [{ name: 'A', amount: '1000', tsuat: 'KHAC:5.26%' }],
    groups: [{ tsuat: 'KHAC:5.26%', net: '1000', vat: '53' }],
    totals: { net: '2000', vat: '53' },
  }));
  assert.ok(inv.warnings.some(w => /lệch TgTCThue/.test(w)));
  assert.ok(inv.warnings.some(w => /MCCQT/.test(w)));
  assert.ok(inv.warnings.some(w => /KHAC/.test(w)));
});

test('parser: hóa đơn thay thế đọc được thông tin hóa đơn liên quan', () => {
  const inv = parseInvoiceXml(invoiceXml({
    number: '00000002',
    related: { nature: '1', khms: '1', series: 'C26TAA', number: '00000001', date: '2026-08-10' },
    items: [{ name: 'A', amount: '1000', tsuat: '10%' }],
    groups: [{ tsuat: '10%', net: '1000', vat: '100' }],
  }));
  assert.deepStrictEqual(
    { n: inv.related.nature, s: inv.related.series, no: inv.related.number },
    { n: '1', s: 'C26TAA', no: '00000001' });
});

test('parser: từ chối XML không theo cấu trúc TT78 thay vì đoán', () => {
  assert.throws(() => parseInvoiceXml(invoiceXml({ root: 'HoaDonDienTu' })), e => e.code === 'NOT_TT78');
  assert.throws(() => parseInvoiceXml('<HDon><x></HDon>'), e => e.code === 'BAD_XML');
});

test('bảng kê: tổng theo thuế suất và CSV có BOM', () => {
  const company = '0100000001';
  const buy = parseInvoiceXml(invoiceXml({
    items: [{ name: 'Vật tư', amount: '1000000', tsuat: '10%' }],
    groups: [{ tsuat: '10%', net: '1000000', vat: '100000' }],
  }));
  const sell = parseInvoiceXml(invoiceXml({
    seller: { mst: company, name: 'MÌNH' }, buyer: { mst: '0400000004', name: 'KHÁCH' },
    items: [{ name: 'Hàng, "đặc biệt"', amount: '2000000', tsuat: '8%' }],
    groups: [{ tsuat: '8%', net: '2000000', vat: '160000' }],
  }));
  const sel = selectInvoices([buy, sell], { companyTaxCode: company, period: parsePeriod('2026-Q3') });
  const rows = buildSummaryLedger(sel);
  assert.strictEqual(rows.length, 2);
  const tot = totalsByRate(rows);
  assert.deepStrictEqual(tot.find(t => t.direction === 'OUT'), { direction: 'OUT', rate: '8', rateLabel: '8%', net: 2000000, vat: 160000, count: 1 });
  const csv = toCsv(rows, SUMMARY_COLUMNS);
  assert.ok(csv.startsWith('﻿'));
  assert.strictEqual(buildItemLedger(sel).length, 2);
  assert.ok(toCsv(buildItemLedger(sel), [{ key: 'name', title: 'Tên' }]).includes('"Hàng, ""đặc biệt"""'));
});
