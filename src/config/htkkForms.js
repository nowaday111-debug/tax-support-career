'use strict';
// Cấu hình mẫu tờ khai HTKK. TẤT CẢ giá trị dưới đây lấy từ file của phần mềm HTKK 5.8.2:
//   - maTKhai, pbanTKhaiXML, tenTKhai, moTaBMau: Project/Menu.xml, mục ID="D1" (MaFile=01_GTGT_TT80).
//   - namespace, maDVu, tenDVu, ttinNhaCCapDVu: file 01/GTGT thật do HTKK kết xuất (DataFiles/<MST>/tmpExport.xml).
//   - Lược đồ kiểm tra: InterfaceTemplates/Validate/01_GTGT_TT80_283.xsd (bản sao trong schemas/htkk/).
// Không tự đặt giá trị. Khi HTKK phát hành mẫu mới (vd 01/GTGT TT89), thêm một mục mới ở đây.

const NAMESPACE = 'http://kekhaithue.gdt.gov.vn/TKhaiThue';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

const SERVICE = Object.freeze({
  maDVu: 'HTKK',
  tenDVu: 'HỖ TRỢ KÊ KHAI THUẾ',
  // Phiên bản phần mềm HTKK. File kết xuất thật ghi theo phiên bản HTKK lúc kết xuất;
  // máy người dùng đang chạy 5.8.2. Có thể ghi đè qua tham số khi gọi exporter.
  pbanDVu: '5.8.2',
  ttinNhaCCapDVu: 'TỔNG CỤC THUẾ HÀ NỘI',
});

const FORMS = Object.freeze({
  '01_GTGT_TT80_283': Object.freeze({
    id: '01_GTGT_TT80_283',
    maTKhai: '842',
    pbanTKhaiXML: '2.8.3',
    tenTKhai: 'TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (Mẫu số 01/GTGT)',
    moTaBMau: '(Ban hành kèm theo Thông tư số 80/2021/TT-BTC ngày 29 tháng 9 năm 2021 của Bộ trưởng Bộ Tài chính)',
    xsd: 'schemas/htkk/Validate/01_GTGT_TT80_283.xsd',
    // Giá trị hợp lệ của tieuMucHachToan theo XSD (kiểu tieuMucHT_empty); file thật dùng 1701.
    tieuMucHachToanAllowed: ['1701', '1704', '1705', '0000', '1761', '1052', '1056', '1057'],
    defaultTieuMuc: '1701',
    defaultNganhNghe: { ma: '00', ten: 'Hoạt động sản xuất kinh doanh thông thường' },
    // Phụ lục giảm thuế dùng chung cho NQ 142/2024, 174/2024, 204/2025 (sheet 01_10 trong HTKK).
    appendixReduction: 'PL_NQ142_GTGT',
  }),
});

/**
 * Chọn mẫu 01/GTGT cho kỳ. Hiện HTKK 5.8.2 chỉ có 01/GTGT TT80 trong menu (mẫu TT89 chưa phát hành),
 * nên mọi kỳ đều dùng TT80 bản 2.8.3.
 */
function formFor01Gtgt(/* period */) { return FORMS['01_GTGT_TT80_283']; }

module.exports = { NAMESPACE, XSI, SERVICE, FORMS, formFor01Gtgt };
