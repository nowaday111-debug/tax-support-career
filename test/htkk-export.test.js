'use strict';
// Kiểm thử Exporter XML 01/GTGT TT80:
//  1. Giá trị khung hồ sơ đúng cấu hình lấy từ HTKK (namespace, maTKhai 842, bản 2.8.3).
//  2. Thứ tự thẻ khớp XSD đã trải phẳng (docs/mapping/xsd/XSD_01_GTGT_TT80_283.csv).
//  3. Kiểm tra bằng XSD chính thức của HTKK qua xmllint (bỏ qua nếu máy không có xmllint).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const xml = require('../src/infrastructure/xml/miniXml');
const { parseInvoiceXml } = require('../src/parsers/invoiceXmlParser');
const { computeGtgt01 } = require('../src/engines/gtgt01/engine');
const { buildGtgt01Tt80Xml } = require('../src/exporters/htkk/gtgt01Tt80Xml');
const { parsePeriod } = require('../src/domain/period');
const { invoiceXml } = require('./helpers/invoiceXml');

const ROOT = path.join(__dirname, '..');
const ME = '0100000001';
const PROFILE = {
  taxpayer: { taxCode: ME, name: 'CÔNG TY TNHH MẪU', address: 'Số 1 đường Mẫu', provinceCode: '101', provinceName: 'Thành phố Hà Nội' },
  taxOffice: { code: '10109', name: 'Thuế cơ sở 4 Thành phố Hà Nội' },
  signer: 'NGUYỄN VĂN A',
  signDate: '2026-10-20',
};

function sampleDecl(withPl) {
  const invs = [
    parseInvoiceXml(invoiceXml({ number: '1', items: [{ name: 'Vật tư & phụ kiện <A>', amount: '10000000', tsuat: '10%' }], groups: [{ tsuat: '10%', net: '10000000', vat: '1000000' }] })),
    parseInvoiceXml(invoiceXml({ number: '2', items: [{ name: 'Nguyên liệu', amount: '2000000', tsuat: '8%' }], groups: [{ tsuat: '8%', net: '2000000', vat: '160000' }] })),
  ];
  if (withPl) {
    invs.push(parseInvoiceXml(invoiceXml({
      seller: { mst: ME, name: 'MÌNH' }, buyer: { mst: '0400000004', name: 'KHÁCH' }, number: '3',
      items: [{ name: 'Thành phẩm X', amount: '50000000', tsuat: '8%' }, { name: 'Thành phẩm Y', amount: '30000000', tsuat: '8%' }],
      groups: [{ tsuat: '8%', net: '80000000', vat: '6400000' }],
    })));
  }
  return computeGtgt01({ company: { taxCode: ME }, period: parsePeriod('2026-Q3'), invoices: invs, previous: { ct43: 0 } });
}

function leafPaths(el, prefix = '') {
  const p = `${prefix}/${el.name}`;
  if (!el.children.length) return [p];
  return el.children.flatMap(c => leafPaths(c, p));
}

function xsdOrder() {
  const csv = fs.readFileSync(path.join(ROOT, 'docs/mapping/xsd/XSD_01_GTGT_TT80_283.csv'), 'utf8').replace(/^﻿/, '');
  return csv.split(/\r?\n/).slice(1).map(l => l.split(',')[0]).filter(Boolean);
}

function hasXmllint() {
  try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('export: khung hồ sơ theo cấu hình HTKK 01/GTGT TT80', () => {
  const out = buildGtgt01Tt80Xml(sampleDecl(false), PROFILE);
  const r = xml.parse(out);
  assert.strictEqual(r.name, 'HSoThueDTu');
  assert.strictEqual(r.attrs.xmlns, 'http://kekhaithue.gdt.gov.vn/TKhaiThue');
  assert.strictEqual(xml.at(r, 'HSoKhaiThue').attrs.id, 'ID_1');
  const tk = xml.at(r, 'HSoKhaiThue/TTinChung/TTinTKhaiThue/TKhaiThue');
  assert.strictEqual(xml.text(tk, 'maTKhai'), '842');
  assert.strictEqual(xml.text(tk, 'pbanTKhaiXML'), '2.8.3');
  assert.strictEqual(xml.text(tk, 'loaiTKhai'), 'C');
  assert.strictEqual(xml.text(tk, 'soLan'), '0');
  assert.strictEqual(xml.text(tk, 'KyKKhaiThue/kieuKy'), 'Q');
  assert.strictEqual(xml.text(tk, 'KyKKhaiThue/kyKKhai'), '3/2026');
  assert.strictEqual(xml.text(tk, 'KyKKhaiThue/kyKKhaiTuNgay'), '01/07/2026');
  assert.strictEqual(xml.text(tk, 'KyKKhaiThue/kyKKhaiDenNgay'), '30/09/2026');
  assert.strictEqual(xml.at(r, 'HSoKhaiThue/TTinChung/TTinTKhaiThue/DLyThue'), null);
  assert.strictEqual(xml.at(r, 'HSoKhaiThue/PLuc'), null);
  const c = xml.at(r, 'HSoKhaiThue/CTieuTKhaiChinh');
  assert.strictEqual(xml.text(c, 'ct21'), '0');
  assert.strictEqual(xml.text(c, 'GiaTriVaThueGTGTHHDVMuaVao/ct23'), '12000000');
  assert.strictEqual(xml.text(c, 'GiaTriVaThueGTGTHHDVMuaVao/ct24'), '1160000');
  assert.strictEqual(xml.text(c, 'ct41'), '1160000');
  assert.strictEqual(xml.text(c, 'ct43'), '1160000');
});

test('export: PL 142 đúng thẻ XSD, thứ tự Mục I, II, III', () => {
  const d = sampleDecl(true);
  const r = xml.parse(buildGtgt01Tt80Xml(d, PROFILE));
  const pl = xml.at(r, 'HSoKhaiThue/PLuc/PL_NQ142_GTGT');
  assert.ok(pl);
  assert.deepStrictEqual(pl.children.map(x => x.name), ['HH_DV_MuaVaoTrongKy', 'HH_DV_BanRaTrongKy', 'ChenhLech']);
  const sales = xml.children(xml.child(pl, 'HH_DV_BanRaTrongKy'), 'BangKeTenHHDV');
  assert.deepStrictEqual(sales.map(s => [s.attrs.ID, xml.text(s, 'tenHHDV'), xml.text(s, 'giaTriHHDV'), xml.text(s, 'thueSuatTheoQuyDinh'), xml.text(s, 'thueSuatSauGiam'), xml.text(s, 'thueGTGTDuocGiam')]),
    [['1', 'Thành phẩm X', '50000000', '10', '8', '1000000'], ['2', 'Thành phẩm Y', '30000000', '10', '8', '600000']]);
  assert.strictEqual(xml.text(pl, 'HH_DV_BanRaTrongKy/tongCongThueGTGTDuocGiam'), '1600000');
  assert.strictEqual(xml.text(pl, 'HH_DV_MuaVaoTrongKy/tongCongThueGTGTHHDV'), '160000');
  assert.strictEqual(xml.text(pl, 'ChenhLech/ct9'), String(1600000 - 160000));
  // [33] = [32] x 10% - [08]
  assert.strictEqual(d.ct['33'], d.ct['32'] / 10 - 1600000);
});

test('export: ký tự đặc biệt được thoát, đọc lại đúng nguyên văn', () => {
  const d = sampleDecl(true);
  d.pl142.sales[0].name = 'Hàng "A" & <B>';
  const r = xml.parse(buildGtgt01Tt80Xml(d, PROFILE));
  assert.strictEqual(xml.text(r, 'HSoKhaiThue/PLuc/PL_NQ142_GTGT/HH_DV_BanRaTrongKy/BangKeTenHHDV/tenHHDV'), 'Hàng "A" & <B>');
});

test('export: thứ tự thẻ khớp XSD 01_GTGT_TT80_283 đã trải phẳng', () => {
  const order = xsdOrder();
  const idx = new Map(order.map((p, i) => [p, i]));
  const out = leafPaths(xml.parse(buildGtgt01Tt80Xml(sampleDecl(true), PROFILE)));
  const seen = [];
  for (const p of out) {
    assert.ok(idx.has(p), `Thẻ ${p} không có trong XSD`);
    seen.push(idx.get(p));
  }
  // Thẻ lặp (BangKeTenHHDV) có cùng chỉ số; thứ tự không được giảm.
  for (let i = 1; i < seen.length; i++) {
    if (seen[i] < seen[i - 1]) {
      // Cho phép quay lại đầu khối khi lặp dòng phụ lục
      assert.match(out[i], /BangKeTenHHDV/, `Sai thứ tự tại ${out[i]}`);
    }
  }
});

test('export: từ chối xuất khi còn lỗi chặn hoặc thiếu thông tin bắt buộc', () => {
  const d = sampleDecl(false);
  d.checks = [{ level: 'Y', code: 'X', message: 'lỗi thử' }];
  d.blocking = true;
  assert.throws(() => buildGtgt01Tt80Xml(d, PROFILE), /lỗi chặn/);
  const ok = sampleDecl(false);
  assert.throws(() => buildGtgt01Tt80Xml(ok, { ...PROFILE, taxpayer: { ...PROFILE.taxpayer, taxCode: '123' } }), /TINType/);
  assert.throws(() => buildGtgt01Tt80Xml(ok, { ...PROFILE, taxOffice: null }), /cơ quan thuế/);
  assert.throws(() => buildGtgt01Tt80Xml(ok, { ...PROFILE, tieuMuc: '9999' }), /Tiểu mục/);
});

test('export: hợp lệ theo XSD chính thức của HTKK (xmllint)', { skip: !hasXmllint() && 'máy chưa có xmllint' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htkk-'));
  const xsd = path.join(ROOT, 'schemas/htkk/Validate/01_GTGT_TT80_283.xsd');
  for (const [name, d] of [['khong-pl.xml', sampleDecl(false)], ['co-pl142.xml', sampleDecl(true)]]) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, buildGtgt01Tt80Xml(d, PROFILE));
    const res = execFileSync('xmllint', ['--noout', '--schema', xsd, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.strictEqual(res, '');
  }
  const none = computeGtgt01({ company: { taxCode: ME }, period: parsePeriod('2026-07'), invoices: [] });
  const f = path.join(dir, 'thang.xml');
  fs.writeFileSync(f, buildGtgt01Tt80Xml(none, PROFILE));
  execFileSync('xmllint', ['--noout', '--schema', xsd, f], { stdio: ['ignore', 'pipe', 'pipe'] });
});
