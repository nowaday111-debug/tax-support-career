#!/usr/bin/env node
'use strict';
// Lập tờ khai 01/GTGT (TT80, HTKK maTKhai 842) từ thư mục hóa đơn XML.
//
// Cách dùng:
//   node scripts/lap-01gtgt.js --hoa-don "C:\hoa don" --ky 2026-Q3 --cau-hinh config/doanh-nghiep.json [--ra output] [--xuat-ca-khi-loi]
//
// Kết quả trong thư mục --ra (mặc định output/<MST>_<kỳ>/):
//   01GTGT_<MST>_<kỳ>.xml       file nhập vào HTKK (chỉ tạo khi không còn lỗi chặn, trừ khi có --xuat-ca-khi-loi)
//   bang-ke-tong-hop.csv        bảng kê hóa đơn mua vào – bán ra theo thuế suất
//   bang-ke-chi-tiet.csv        bảng kê chi tiết hàng hóa, dịch vụ
//   bao-cao.json                chỉ tiêu, phụ lục, kiểm tra, hóa đơn bị loại và lý do

const fs = require('fs');
const path = require('path');
const { loadInvoicesFromDir, computeGtgt01, buildGtgt01Tt80Xml, ledger, parsePeriod } = require('../src');

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

function main() {
  const a = args(process.argv);
  if (!a['hoa-don'] || !a.ky || !a['cau-hinh']) {
    console.error('Thiếu tham số. Ví dụ: node scripts/lap-01gtgt.js --hoa-don "C:\\hoa don" --ky 2026-Q3 --cau-hinh config/doanh-nghiep.json');
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(a['cau-hinh'], 'utf8'));
  const period = parsePeriod(a.ky);
  const mst = cfg.taxpayer && cfg.taxpayer.taxCode;
  if (!mst) throw new Error('Cấu hình thiếu taxpayer.taxCode');

  const { invoices, errors } = loadInvoicesFromDir(a['hoa-don']);
  const decl = computeGtgt01({
    company: { taxCode: mst },
    period,
    invoices,
    previous: cfg.previous,
    manual: cfg.manual,
    nonDeductibleKeys: cfg.nonDeductibleKeys,
    options: cfg.options,
  });

  const kyTen = a.ky.replace(/[^\w-]/g, '_');
  const outDir = a.ra || path.join('output', `${mst}_${kyTen}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Bảng kê: dựng lại tập hóa đơn được chọn từ kết quả engine
  const byKey = new Map(invoices.map(i => [i.key, i]));
  const selection = { included: decl.selection.included.map(x => ({ inv: byKey.get(x.key), direction: x.direction })) };
  fs.writeFileSync(path.join(outDir, 'bang-ke-tong-hop.csv'), ledger.toCsv(ledger.buildSummaryLedger(selection), ledger.SUMMARY_COLUMNS));
  fs.writeFileSync(path.join(outDir, 'bang-ke-chi-tiet.csv'), ledger.toCsv(ledger.buildItemLedger(selection), ledger.ITEM_COLUMNS));
  fs.writeFileSync(path.join(outDir, 'bao-cao.json'), JSON.stringify({ ...decl, fileErrors: errors }, null, 2));

  let xmlFile = null;
  if (!decl.blocking || a['xuat-ca-khi-loi']) {
    const xml = buildGtgt01Tt80Xml(decl, { ...cfg, allowBlocking: !!a['xuat-ca-khi-loi'] });
    xmlFile = path.join(outDir, `01GTGT_${mst}_${kyTen}.xml`);
    fs.writeFileSync(xmlFile, xml);
  }

  const c = decl.ct;
  const line = (k, label) => console.log(`  [${k}]`.padEnd(8) + String(c[k].toLocaleString('vi-VN')).padStart(20) + '  ' + label);
  console.log(`Tờ khai 01/GTGT ${period.label} — MST ${mst}`);
  console.log(`Hóa đơn đọc được: ${invoices.length}, lỗi đọc: ${errors.length}, đưa vào tờ khai: ${decl.selection.included.length}, bị loại: ${decl.selection.excluded.length}`);
  console.log(`  [21]  Không phát sinh: ${c['21'] ? 'X' : ''}`);
  line('22', 'Thuế còn được khấu trừ kỳ trước chuyển sang');
  line('23', 'Giá trị HHDV mua vào'); line('24', 'Thuế GTGT HHDV mua vào'); line('25', 'Thuế GTGT mua vào được khấu trừ');
  line('26', 'Bán ra không chịu thuế'); line('29', 'Bán ra 0%'); line('30', 'Bán ra 5%'); line('31', 'Thuế bán ra 5%');
  line('32', 'Bán ra 10% (gồm 8%)'); line('33', 'Thuế bán ra 10% (gồm 8%)'); line('32a', 'Bán ra không kê khai tính nộp');
  line('34', 'Tổng doanh thu'); line('35', 'Tổng thuế bán ra'); line('36', 'Thuế phát sinh');
  line('40', 'Thuế còn phải nộp'); line('41', 'Thuế chưa khấu trừ hết'); line('43', 'Chuyển kỳ sau');
  if (decl.pl142) console.log(`PL 142: ${decl.pl142.sales.length} dòng bán ra, ${decl.pl142.purchases.length} dòng mua vào, [08]=${decl.pl142.totalReduced}, [06]=${decl.pl142.totalPurchaseVat}, [09]=${decl.pl142.ct9}`);
  for (const ch of decl.checks) console.log(`${ch.level === 'Y' ? 'LỖI CHẶN' : 'CẢNH BÁO'} ${ch.code}: ${ch.message}`);
  if (errors.length) console.log(`File không đọc được: ${errors.map(e => path.basename(e.file) + ' (' + e.code + ')').join(', ')}`);
  console.log(xmlFile ? `Đã tạo ${xmlFile}` : 'CHƯA tạo file XML vì còn lỗi chặn (xem bao-cao.json).');
  console.log(`Bảng kê và báo cáo trong ${outDir}`);
}

try { main(); } catch (e) { console.error('Lỗi:', e.message); process.exit(1); }
