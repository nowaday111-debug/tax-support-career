'use strict';
// Quy tắc kiểm tra tờ khai 01/GTGT. Nội dung lấy từ sheet "Header" của mẫu HTKK
// (01_GTGT_TT80_283.xls / 01_GTGT_TT89_309.xls): cột "Warning" Y = lỗi chặn, N = cảnh báo.
// Các quy tắc có mã bắt đầu bằng SYS_ là kiểm tra bổ sung của hệ thống, không phải của HTKK.

const { percentOf } = require('../../domain/money');

/**
 * @param {Object<string, number|boolean>} ct
 * @param {{pl142?: Object|null, previousCt43?: number|null, ct22Manual?: boolean}} ctx
 * @returns {{level:'Y'|'N'|'INFO', code:string, message:string}[]}
 */
function checkDeclaration(ct, ctx = {}) {
  const out = [];
  const add = (level, code, message) => out.push({ level, code, message });
  const abs = Math.abs;

  if (ctx.previousCt43 !== null && ctx.previousCt43 !== undefined && ct['22'] !== ctx.previousCt43) {
    add('N', 'HTKK_22_43', `Chỉ tiêu [22] = ${ct['22']} khác [43] của tờ khai lần đầu kỳ trước liền kề (${ctx.previousCt43})`);
  }
  if (ct['23a'] > ct['23']) add('Y', 'HTKK_23A', `Chỉ tiêu [23a] (${ct['23a']}) phải <= [23] (${ct['23']})`);
  // HTKK ghi nguyên văn "Chỉ tiêu [24a] <= chỉ tiêu [23a]"
  if (ct['24a'] > ct['23a']) add('Y', 'HTKK_24A', `Chỉ tiêu [24a] (${ct['24a']}) phải <= [23a] (${ct['23a']})`);
  if (ct['24a'] > ct['24']) add('N', 'SYS_24A_24', `Chỉ tiêu [24a] (${ct['24a']}) lớn hơn [24] (${ct['24']})`);
  if (abs(ct['25']) > abs(ct['24'])) add('Y', 'HTKK_25_24', `|[25]| (${ct['25']}) phải <= |[24]| (${ct['24']})`);
  if (abs(ct['24']) > abs(ct['23'])) add('Y', 'HTKK_24_23', `|[24]| (${ct['24']}) phải <= |[23]| (${ct['23']})`);
  if (ct['40b'] > ct['40a']) add('Y', 'HTKK_40B', `Chỉ tiêu [40b] (${ct['40b']}) phải <= [40a] (${ct['40a']})`);
  if (ct['42'] > ct['41']) add('Y', 'HTKK_42', `Chỉ tiêu [42] (${ct['42']}) phải <= [41] (${ct['41']})`);
  if (ct['31'] > ct['30']) add('Y', 'HTKK_31_GT_30', `Chỉ tiêu [31] (${ct['31']}) đang lớn hơn [30] (${ct['30']})`);
  if (ct['33'] > ct['32']) add('Y', 'HTKK_33_GT_32', `Chỉ tiêu [33] (${ct['33']}) đang lớn hơn [32] (${ct['32']})`);

  const e31 = percentOf(ct['30'], 5);
  if (ct['31'] !== e31) add('N', 'HTKK_31', `Chỉ tiêu [31] (${ct['31']}) khác [30] x 5% (${e31})`);
  const ct08 = ctx.pl142 ? ctx.pl142.totalReduced : 0;
  const e33 = percentOf(ct['32'], 10) - ct08;
  if (ct['33'] !== e33) {
    add('N', 'HTKK_33', ctx.pl142
      ? `Chỉ tiêu [33] (${ct['33']}) khác [32] x 10% - [08] trên PL NQ 142/2024/QH15 (${e33})`
      : `Chỉ tiêu [33] (${ct['33']}) khác [32] x 10% (${e33})`);
  }

  if (ct['21'] === true) {
    // Chỉ xét các chỉ tiêu phát sinh trong kỳ; [36], [40a], [40], [41], [43] có thể khác 0 do chuyển tiếp từ [22].
    const activity = ['23', '23a', '24', '24a', '25', '26', '27', '28', '29', '30', '31', '32', '32a', '33', '34', '35', '37', '38', '39a', '40b', '42'];
    const nonZero = activity.map(k => [k, ct[k]]).filter(([, v]) => v !== 0);
    if (nonZero.length) add('Y', 'SYS_21', `Đánh dấu [21] không phát sinh nhưng có số liệu ở ${nonZero.map(([k]) => '[' + k + ']').join(', ')}`);
  }
  for (const k of ['22', '40a', '40', '41']) {
    if (ct[k] < 0) add('Y', 'XSD_NON_NEG', `Chỉ tiêu [${k}] phải >= 0 (kiểu nonNegativeInteger trong XSD)`);
  }
  for (const [k, v] of Object.entries(ct)) {
    if (k !== '21' && !Number.isSafeInteger(v)) add('Y', 'SYS_INT', `Chỉ tiêu [${k}] không phải số nguyên: ${v}`);
  }
  return out;
}

module.exports = { checkDeclaration };
