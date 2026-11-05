'use strict';
// Kỳ tính thuế. Định dạng chuỗi kỳ theo mô tả trong XSD của HTKK (TKhaiThue.xsd, thẻ kyKKhai):
//   "Quý: Q/YYYY, ngày: DD/MM/YYYY, tháng: MM/YYYY, năm: YYYY".
// File 01/GTGT thật do HTKK kết xuất (kỳ quý) ghi: kieuKy=Q, kyKKhai=4/2025,
// kyKKhaiTuNgay=01/10/2025, kyKKhaiDenNgay=31/12/2025, kyKKhaiTuThang/DenThang để trống.

const pad2 = n => String(n).padStart(2, '0');

/**
 * Tạo kỳ tính thuế.
 * @param {{type:'Q'|'M', year:number, quarter?:number, month?:number}} p
 */
function makePeriod(p) {
  const year = Number(p.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`Năm không hợp lệ: ${p.year}`);
  if (p.type === 'Q') {
    const q = Number(p.quarter);
    if (![1, 2, 3, 4].includes(q)) throw new Error(`Quý không hợp lệ: ${p.quarter}`);
    const sm = (q - 1) * 3 + 1;
    const em = q * 3;
    return {
      type: 'Q', year, quarter: q,
      startDate: `${year}-${pad2(sm)}-01`,
      endDate: `${year}-${pad2(em)}-${pad2(lastDay(year, em))}`,
      kieuKy: 'Q',
      kyKKhai: `${q}/${year}`,
      label: `Quý ${q}/${year}`,
    };
  }
  if (p.type === 'M') {
    const m = Number(p.month);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error(`Tháng không hợp lệ: ${p.month}`);
    return {
      type: 'M', year, month: m,
      startDate: `${year}-${pad2(m)}-01`,
      endDate: `${year}-${pad2(m)}-${pad2(lastDay(year, m))}`,
      kieuKy: 'M',
      kyKKhai: `${pad2(m)}/${year}`,
      label: `Tháng ${pad2(m)}/${year}`,
    };
  }
  throw new Error(`Loại kỳ không hợp lệ: ${p.type} (chỉ nhận Q hoặc M)`);
}

/** Đọc chuỗi kỳ dạng "2026-Q3", "Q3/2026", "3/2026" (quý) hoặc "2026-07", "07/2026" (tháng). */
function parsePeriod(s) {
  const t = String(s).trim().toUpperCase();
  let m;
  if ((m = /^(\d{4})-Q([1-4])$/.exec(t))) return makePeriod({ type: 'Q', year: +m[1], quarter: +m[2] });
  if ((m = /^Q([1-4])\/(\d{4})$/.exec(t))) return makePeriod({ type: 'Q', year: +m[2], quarter: +m[1] });
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(t))) return makePeriod({ type: 'M', year: +m[1], month: +m[2] });
  if ((m = /^(\d{1,2})\/(\d{4})$/.exec(t))) return makePeriod({ type: 'M', year: +m[2], month: +m[1] });
  throw new Error(`Không đọc được kỳ: ${s} (dùng 2026-Q3 hoặc 2026-07)`);
}

function previousPeriod(period) {
  if (period.type === 'Q') {
    return period.quarter === 1
      ? makePeriod({ type: 'Q', year: period.year - 1, quarter: 4 })
      : makePeriod({ type: 'Q', year: period.year, quarter: period.quarter - 1 });
  }
  return period.month === 1
    ? makePeriod({ type: 'M', year: period.year - 1, month: 12 })
    : makePeriod({ type: 'M', year: period.year, month: period.month - 1 });
}

function lastDay(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

/** yyyy-mm-dd -> dd/mm/yyyy */
function toVnDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Ngày không đúng định dạng yyyy-mm-dd: ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function inPeriod(isoDate, period) {
  return typeof isoDate === 'string' && isoDate >= period.startDate && isoDate <= period.endDate;
}

module.exports = { makePeriod, parsePeriod, previousPeriod, toVnDate, inPeriod };
