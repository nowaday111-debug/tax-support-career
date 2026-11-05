'use strict';
// Sinh file XML tờ khai 01/GTGT mẫu TT80 (maTKhai 842, bản 2.8.3) để nhập vào HTKK.
// Thứ tự và tên thẻ theo XSD 01_GTGT_TT80_283.xsd + TKhaiThue.xsd (bản sao trong schemas/htkk/).
// Định dạng giá trị theo file thật do HTKK kết xuất:
//   - namespace mặc định http://kekhaithue.gdt.gov.vn/TKhaiThue, khai báo thêm xmlns:xsi
//   - HSoKhaiThue id="ID_1"; ngày lập/ký dạng yyyy-mm-dd; kỳ quý "Q/YYYY"
//   - không có đại lý thuế -> bỏ thẻ DLyThue; không có phụ lục -> bỏ thẻ PLuc
//   - ct21 = 1 khi đánh dấu không phát sinh (kiểu xs:boolean)

const { NAMESPACE, XSI, SERVICE, FORMS } = require('../../config/htkkForms');
const { toVnDate } = require('../../domain/period');

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class XmlWriter {
  constructor() { this.lines = []; this.depth = 0; }
  pad() { return '  '.repeat(this.depth); }
  open(name, attrs) { this.lines.push(`${this.pad()}<${name}${fmtAttrs(attrs)}>`); this.depth++; return this; }
  close(name) { this.depth--; this.lines.push(`${this.pad()}</${name}>`); return this; }
  leaf(name, value) {
    const s = value === null || value === undefined ? '' : String(value);
    this.lines.push(s === '' ? `${this.pad()}<${name} />` : `${this.pad()}<${name}>${esc(s)}</${name}>`);
    return this;
  }
  toString() { return this.lines.join('\r\n') + '\r\n'; }
}
function fmtAttrs(a) { return a ? Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : ''; }

function requireInt(name, v) {
  if (!Number.isSafeInteger(v)) throw new Error(`Chỉ tiêu ${name} phải là số nguyên, nhận ${v}`);
  return v;
}

/**
 * @param {Object} decl     kết quả computeGtgt01()
 * @param {{
 *   taxpayer: {taxCode:string, name:string, address:string, wardName?:string, districtCode?:string, districtName?:string,
 *              provinceCode:string, provinceName:string, phone?:string, fax?:string, email?:string},
 *   taxOffice: {code:string, name:string},
 *   signer?: string,
 *   signDate?: string,          // yyyy-mm-dd, mặc định hôm nay
 *   createdDate?: string,       // yyyy-mm-dd, mặc định = signDate
 *   tieuMuc?: string,
 *   industry?: {ma:string, ten:string},
 *   pbanDVu?: string,
 *   allowBlocking?: boolean,    // cho phép xuất dù còn lỗi chặn (mức Y)
 * }} profile
 * @returns {string}
 */
function buildGtgt01Tt80Xml(decl, profile) {
  const form = FORMS['01_GTGT_TT80_283'];
  if (decl.form !== form.id) throw new Error(`Tờ khai lập theo mẫu ${decl.form}, exporter này chỉ hỗ trợ ${form.id}`);
  if (decl.blocking && !profile.allowBlocking) {
    const msg = decl.checks.filter(c => c.level === 'Y').map(c => c.message).join('; ');
    throw new Error(`Tờ khai còn lỗi chặn theo quy tắc HTKK: ${msg}`);
  }
  const tp = profile.taxpayer || {};
  for (const f of ['taxCode', 'name', 'address', 'provinceCode', 'provinceName']) {
    if (!tp[f]) throw new Error(`Thiếu thông tin người nộp thuế: ${f}`);
  }
  if (!/^(\d{10}(-\d{3})?|\d{12})$/.test(tp.taxCode)) throw new Error(`MST không đúng mẫu XSD (TINType): ${tp.taxCode}`);
  if (!profile.taxOffice || !profile.taxOffice.code || !profile.taxOffice.name) throw new Error('Thiếu mã/tên cơ quan thuế nơi nộp');
  const tieuMuc = profile.tieuMuc || form.defaultTieuMuc;
  if (!form.tieuMucHachToanAllowed.includes(tieuMuc)) throw new Error(`Tiểu mục ${tieuMuc} không nằm trong danh sách XSD cho phép`);
  const industry = profile.industry || form.defaultNganhNghe;
  const today = new Date().toISOString().slice(0, 10);
  const signDate = profile.signDate || today;
  const createdDate = profile.createdDate || signDate;
  const p = decl.period;
  const ct = decl.ct;

  const w = new XmlWriter();
  w.lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  w.open('HSoThueDTu', { 'xmlns:xsi': XSI, xmlns: NAMESPACE });
  w.open('HSoKhaiThue', { id: 'ID_1' });

  w.open('TTinChung');
  w.open('TTinDVu')
    .leaf('maDVu', SERVICE.maDVu).leaf('tenDVu', SERVICE.tenDVu)
    .leaf('pbanDVu', profile.pbanDVu || SERVICE.pbanDVu).leaf('ttinNhaCCapDVu', SERVICE.ttinNhaCCapDVu)
    .close('TTinDVu');
  w.open('TTinTKhaiThue');
  w.open('TKhaiThue')
    .leaf('maTKhai', form.maTKhai).leaf('tenTKhai', form.tenTKhai).leaf('moTaBMau', form.moTaBMau)
    .leaf('pbanTKhaiXML', form.pbanTKhaiXML).leaf('loaiTKhai', 'C').leaf('soLan', 0);
  w.open('KyKKhaiThue')
    .leaf('kieuKy', p.kieuKy).leaf('kyKKhai', p.kyKKhai)
    .leaf('kyKKhaiTuNgay', toVnDate(p.startDate)).leaf('kyKKhaiDenNgay', toVnDate(p.endDate))
    .leaf('kyKKhaiTuThang', '').leaf('kyKKhaiDenThang', '')
    .close('KyKKhaiThue');
  w.leaf('maCQTNoiNop', profile.taxOffice.code).leaf('tenCQTNoiNop', profile.taxOffice.name)
    .leaf('ngayLapTKhai', createdDate);
  w.open('GiaHan').leaf('maLyDoGiaHan', '').leaf('lyDoGiaHan', '').close('GiaHan');
  w.leaf('nguoiKy', profile.signer || '').leaf('ngayKy', signDate).leaf('nganhNgheKD', '');
  w.close('TKhaiThue');
  w.open('NNT')
    .leaf('mst', tp.taxCode).leaf('tenNNT', tp.name).leaf('dchiNNT', tp.address)
    .leaf('phuongXa', tp.wardName || '').leaf('maHuyenNNT', tp.districtCode || '').leaf('tenHuyenNNT', tp.districtName || '')
    .leaf('maTinhNNT', tp.provinceCode).leaf('tenTinhNNT', tp.provinceName)
    .leaf('dthoaiNNT', tp.phone || '').leaf('faxNNT', tp.fax || '').leaf('emailNNT', tp.email || '')
    .close('NNT');
  w.close('TTinTKhaiThue');
  w.close('TTinChung');

  w.open('CTieuTKhaiChinh');
  w.leaf('ma_NganhNghe', industry.ma).leaf('ten_NganhNghe', industry.ten).leaf('tieuMucHachToan', tieuMuc);
  w.open('Header').leaf('ct09', '').leaf('ct10', '');
  w.open('DiaChiHDSXKDKhacTinhNDTSC')
    .leaf('ct11a_phuongXa_ma', '').leaf('ct11a_phuongXa_ten', '')
    .leaf('ct11b_quanHuyen_ma', '').leaf('ct11b_quanHuyen_ten', '')
    .leaf('ct11c_tinhTP_ma', '').leaf('ct11c_tinhTP_ten', '')
    .close('DiaChiHDSXKDKhacTinhNDTSC');
  w.close('Header');
  const n = k => requireInt(`[${k}]`, ct[k]);
  w.leaf('ct21', ct['21'] ? 1 : 0);
  w.leaf('ct22', n('22'));
  w.open('GiaTriVaThueGTGTHHDVMuaVao').leaf('ct23', n('23')).leaf('ct24', n('24')).close('GiaTriVaThueGTGTHHDVMuaVao');
  w.open('HangHoaDichVuNhapKhau').leaf('ct23a', n('23a')).leaf('ct24a', n('24a')).close('HangHoaDichVuNhapKhau');
  w.leaf('ct25', n('25')).leaf('ct26', n('26'));
  w.open('HHDVBRaChiuThueGTGT').leaf('ct27', n('27')).leaf('ct28', n('28')).close('HHDVBRaChiuThueGTGT');
  w.leaf('ct29', n('29'));
  w.open('HHDVBRaChiuTSuat5').leaf('ct30', n('30')).leaf('ct31', n('31')).close('HHDVBRaChiuTSuat5');
  w.open('HHDVBRaChiuTSuat10').leaf('ct32', n('32')).leaf('ct33', n('33')).close('HHDVBRaChiuTSuat10');
  w.leaf('ct32a', n('32a'));
  w.open('TongDThuVaThueGTGTHHDVBRa').leaf('ct34', n('34')).leaf('ct35', n('35')).close('TongDThuVaThueGTGTHHDVBRa');
  for (const k of ['36', '37', '38', '39a', '40a', '40b', '40', '41', '42', '43']) w.leaf(`ct${k}`, n(k));
  w.close('CTieuTKhaiChinh');

  if (decl.pl142) writePl142(w, decl.pl142);

  w.close('HSoKhaiThue');
  w.close('HSoThueDTu');
  return w.toString();
}

function writePl142(w, pl) {
  w.open('PLuc');
  w.open('PL_NQ142_GTGT');
  if (pl.purchases.length) {
    w.open('HH_DV_MuaVaoTrongKy');
    pl.purchases.forEach((l, i) => {
      // Giá trị thuộc tính ID: đánh số dòng 1, 2, ... (chưa đối chiếu được với file kết xuất thật có dòng phụ lục)
      w.open('BangKeTenHHDV', { ID: String(i + 1) })
        .leaf('tenHHDVMuaVao', l.name).leaf('giaTriHHDVMuaVao', requireInt('giaTriHHDVMuaVao', l.value))
        .leaf('thueGTGTHHDV', requireInt('thueGTGTHHDV', l.vat))
        .close('BangKeTenHHDV');
    });
    w.leaf('tongCongGiaTriHHDVMuaVao', pl.totalPurchaseValue).leaf('tongCongThueGTGTHHDV', pl.totalPurchaseVat);
    w.close('HH_DV_MuaVaoTrongKy');
  }
  if (pl.sales.length) {
    w.open('HH_DV_BanRaTrongKy');
    pl.sales.forEach((l, i) => {
      w.open('BangKeTenHHDV', { ID: String(i + 1) })
        .leaf('tenHHDV', l.name).leaf('giaTriHHDV', requireInt('giaTriHHDV', l.value))
        .leaf('thueSuatTheoQuyDinh', l.rateStd).leaf('thueSuatSauGiam', l.rateReduced)
        .leaf('thueGTGTDuocGiam', requireInt('thueGTGTDuocGiam', l.reduced))
        .close('BangKeTenHHDV');
    });
    w.leaf('tongCongGiaTriHHDV', pl.totalSalesValue).leaf('tongCongThueGTGTDuocGiam', pl.totalReduced);
    w.close('HH_DV_BanRaTrongKy');
  }
  w.open('ChenhLech').leaf('ct9', pl.ct9).close('ChenhLech');
  w.close('PL_NQ142_GTGT');
  w.close('PLuc');
}

module.exports = { buildGtgt01Tt80Xml };
