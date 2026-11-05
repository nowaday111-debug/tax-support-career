'use strict';
// Data models của hệ thống (lớp domain, không phụ thuộc HTTP, file hay định dạng XML cụ thể).
// Tiền luôn là số nguyên VND. Ngày luôn là chuỗi yyyy-mm-dd.

/** Mã thuế suất chuẩn hóa từ thẻ <TSuat> của hóa đơn TT78. */
const RATE = Object.freeze({
  R0: '0', R5: '5', R8: '8', R10: '10',
  KCT: 'KCT',     // không chịu thuế GTGT
  KKKNT: 'KKKNT', // không kê khai, tính nộp thuế GTGT
  KHAC: 'KHAC',   // "KHAC:x%" — thuế suất khác, phải xử lý thủ công
  NONE: 'NONE',   // hóa đơn không có thuế GTGT (vd: hóa đơn bán hàng, KHMSHDon = 2)
});

/** Tính chất dòng hàng hóa <TChat> theo TT78. */
const ITEM_NATURE = Object.freeze({
  GOODS: 1,       // hàng hóa, dịch vụ
  PROMOTION: 2,   // khuyến mại
  DISCOUNT: 3,    // chiết khấu thương mại (giảm trừ)
  NOTE: 4,        // ghi chú, diễn giải
});

const DIRECTION = Object.freeze({ IN: 'IN', OUT: 'OUT', UNRELATED: 'UNRELATED' });

/**
 * @typedef {Object} Party
 * @property {string} name
 * @property {string} taxCode   MST (10 số, 10-3 số, hoặc 12 số CCCD với hộ kinh doanh)
 * @property {string} address
 */

/**
 * @typedef {Object} InvoiceItem
 * @property {number} lineNo
 * @property {number} nature        ITEM_NATURE
 * @property {string} code
 * @property {string} name
 * @property {string} unit
 * @property {string|null} quantity  giữ dạng chuỗi như trong XML
 * @property {string|null} unitPrice
 * @property {number} amount        thành tiền chưa thuế, VND (đã quy đổi nếu ngoại tệ)
 * @property {string|null} rate     RATE
 * @property {number|null} vat      tiền thuế của dòng nếu hóa đơn có ghi
 */

/**
 * @typedef {Object} RateGroup  Tổng hợp theo thuế suất (thẻ THTTLTSuat/LTSuat)
 * @property {string} rate   RATE
 * @property {number} net
 * @property {number} vat
 * @property {number|null} ratePercent  phần trăm khi rate = KHAC
 */

/**
 * @typedef {Object} Invoice
 * @property {string} key            MST bán|KHMSHDon|KHHDon|SHDon — khóa chống trùng
 * @property {string} format         'TT78'
 * @property {string} version        PBan
 * @property {string} title          THDon
 * @property {string} templateCode   KHMSHDon (1 = HĐ GTGT, 2 = HĐ bán hàng, ...)
 * @property {string} series         KHHDon
 * @property {string} number         SHDon
 * @property {string} issueDate      NLap
 * @property {string} currency
 * @property {string|null} exchangeRate
 * @property {string|null} authorityCode  MCCQT
 * @property {Party} seller
 * @property {Party} buyer
 * @property {InvoiceItem[]} items
 * @property {RateGroup[]} rateGroups
 * @property {{net:number|null, vat:number|null, discount:number|null, payable:number|null}} totals
 * @property {{nature:string, templateCode:string, series:string, number:string, issueDate:string}|null} related
 * @property {string} [direction]    DIRECTION, gán khi đối chiếu với MST doanh nghiệp
 * @property {string[]} warnings
 * @property {string} [sourceFile]
 */

/**
 * @typedef {Object} TaxDeclaration01GTGT
 * @property {string} form           mã mẫu nội bộ, vd '01_GTGT_TT80_283'
 * @property {Object} period         xem domain/period.js
 * @property {Object<string, number|boolean>} ct   chỉ tiêu: ct['21'] boolean, còn lại số nguyên
 * @property {PL142|null} pl142
 * @property {{level:'Y'|'N'|'INFO', code:string, message:string}[]} checks
 * @property {Object} sources       giải trình nguồn số liệu
 */

/**
 * @typedef {Object} PL142
 * @property {{name:string, value:number, vat:number}[]} purchases   Mục I
 * @property {{name:string, value:number, rateStd:number, rateReduced:number, reduced:number}[]} sales  Mục II
 * @property {number} totalPurchaseValue
 * @property {number} totalPurchaseVat     [06]
 * @property {number} totalSalesValue
 * @property {number} totalReduced         [08]
 * @property {number} ct9                  [09] = [08] - [06]
 */

/**
 * @typedef {Object} PaymentSlip  Giấy nộp tiền
 * @property {string} number
 * @property {string} date
 * @property {string} taxCode
 * @property {string} chapter        mã chương
 * @property {string} subItem        mã tiểu mục (vd 1701)
 * @property {string} periodLabel
 * @property {number} amount
 */

/**
 * @typedef {Object} FinancialStatement
 * @property {'TT99'|'TT200'|'TT133'} regime
 * @property {string} form           vd '99_BCTC'
 * @property {number} year
 * @property {Object<string, {current:number, previous:number, note:string}>} lines  theo mã số chỉ tiêu
 */

/**
 * @typedef {Object} SupplierRiskStatus
 * @property {string} taxCode
 * @property {string} status         trạng thái MST trên cổng thuế
 * @property {boolean} risky
 * @property {string} checkedAt
 * @property {string} note
 */

function invoiceKey(inv) {
  return [inv.seller.taxCode, inv.templateCode, inv.series, inv.number].map(x => String(x || '').trim()).join('|');
}

function emptyDeclarationCt() {
  const ct = { '21': false };
  for (const k of ['22', '23', '23a', '24', '24a', '25', '26', '27', '28', '29', '30', '31', '32', '32a', '33',
    '34', '35', '36', '37', '38', '39a', '40a', '40b', '40', '41', '42', '43']) ct[k] = 0;
  return ct;
}

module.exports = { RATE, ITEM_NATURE, DIRECTION, invoiceKey, emptyDeclarationCt };
