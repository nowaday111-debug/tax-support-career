'use strict';
// Lập bảng kê hóa đơn mua vào – bán ra (theo thuế suất) và bảng kê chi tiết hàng hóa, dịch vụ
// từ kết quả selectInvoices(). Xuất CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt).

const RATE_LABEL = { '0': '0%', '5': '5%', '8': '8%', '10': '10%', KCT: 'Không chịu thuế', KKKNT: 'Không kê khai, tính nộp thuế', NONE: 'Không có thuế GTGT' };

/** Mỗi dòng = một nhóm thuế suất của một hóa đơn. */
function buildSummaryLedger(selection) {
  const rows = [];
  for (const { inv, direction } of selection.included) {
    const partner = direction === 'OUT' ? inv.buyer : inv.seller;
    for (const g of inv.rateGroups) {
      rows.push({
        direction,
        issueDate: inv.issueDate,
        templateCode: inv.templateCode,
        series: inv.series,
        number: inv.number,
        partnerTaxCode: partner.taxCode,
        partnerName: partner.name,
        rate: g.rate,
        rateLabel: RATE_LABEL[g.rate] || g.rate,
        net: g.net,
        vat: g.vat,
        authorityCode: inv.authorityCode || '',
        key: inv.key,
      });
    }
  }
  rows.sort((a, b) => a.direction.localeCompare(b.direction) || a.issueDate.localeCompare(b.issueDate) || a.key.localeCompare(b.key));
  return rows;
}

/** Tổng theo chiều và thuế suất. */
function totalsByRate(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.direction}|${r.rate}`;
    const t = m.get(k) || { direction: r.direction, rate: r.rate, rateLabel: r.rateLabel, net: 0, vat: 0, count: 0 };
    t.net += r.net; t.vat += r.vat; t.count += 1;
    m.set(k, t);
  }
  return [...m.values()];
}

/** Bảng kê chi tiết từng dòng hàng hóa, dịch vụ. */
function buildItemLedger(selection) {
  const rows = [];
  for (const { inv, direction } of selection.included) {
    const partner = direction === 'OUT' ? inv.buyer : inv.seller;
    for (const it of inv.items) {
      rows.push({
        direction, issueDate: inv.issueDate, series: inv.series, number: inv.number,
        partnerTaxCode: partner.taxCode, partnerName: partner.name,
        lineNo: it.lineNo, nature: it.nature, code: it.code, name: it.name, unit: it.unit,
        quantity: it.quantity ?? '', unitPrice: it.unitPrice ?? '', amount: it.amount,
        rate: it.rate ?? '', vat: it.vat ?? '', key: inv.key,
      });
    }
  }
  return rows;
}

function toCsv(rows, columns) {
  const esc = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = columns.map(c => esc(c.title)).join(',');
  const body = rows.map(r => columns.map(c => esc(r[c.key])).join(',')).join('\r\n');
  return '﻿' + head + '\r\n' + body + (body ? '\r\n' : '');
}

const SUMMARY_COLUMNS = [
  { key: 'direction', title: 'Chiều (IN mua vào/OUT bán ra)' }, { key: 'issueDate', title: 'Ngày lập' },
  { key: 'templateCode', title: 'Mẫu số' }, { key: 'series', title: 'Ký hiệu' }, { key: 'number', title: 'Số hóa đơn' },
  { key: 'partnerTaxCode', title: 'MST đối tác' }, { key: 'partnerName', title: 'Tên đối tác' },
  { key: 'rateLabel', title: 'Thuế suất' }, { key: 'net', title: 'Tiền chưa thuế' }, { key: 'vat', title: 'Tiền thuế' },
  { key: 'authorityCode', title: 'Mã CQT' },
];
const ITEM_COLUMNS = [
  { key: 'direction', title: 'Chiều' }, { key: 'issueDate', title: 'Ngày lập' }, { key: 'series', title: 'Ký hiệu' },
  { key: 'number', title: 'Số hóa đơn' }, { key: 'partnerTaxCode', title: 'MST đối tác' }, { key: 'partnerName', title: 'Tên đối tác' },
  { key: 'lineNo', title: 'STT' }, { key: 'nature', title: 'Tính chất' }, { key: 'code', title: 'Mã hàng' },
  { key: 'name', title: 'Tên hàng hóa, dịch vụ' }, { key: 'unit', title: 'ĐVT' }, { key: 'quantity', title: 'Số lượng' },
  { key: 'unitPrice', title: 'Đơn giá' }, { key: 'amount', title: 'Thành tiền' }, { key: 'rate', title: 'Thuế suất' },
  { key: 'vat', title: 'Tiền thuế dòng' },
];

module.exports = { buildSummaryLedger, buildItemLedger, totalsByRate, toCsv, SUMMARY_COLUMNS, ITEM_COLUMNS };
