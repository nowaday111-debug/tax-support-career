'use strict';
// Sinh XML hóa đơn TT78 GIẢ LẬP cho kiểm thử. Cấu trúc thẻ sao theo hóa đơn thật
// (HDon/DLHDon/TTChung, NDHDon/NBan, NMua, DSHHDVu/HHDVu, TToan/THTTLTSuat/LTSuat, MCCQT);
// tên, MST, số liệu đều là dữ liệu giả.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (n, v) => (v === undefined || v === null ? '' : (v === '' ? `<${n}/>` : `<${n}>${esc(v)}</${n}>`));

/**
 * @param {{seller?:{mst,name}, buyer?:{mst,name}, khms?:string, series?:string, number?:string, date?:string,
 *   currency?:string, rate?:string, items?:Array<{nature?:number,name:string,amount:string,tsuat?:string,tthue?:string}>,
 *   groups?:Array<{tsuat:string, net:string, vat:string}>, totals?:{net?:string,vat?:string,payable?:string,discount?:string},
 *   related?:{nature:string, khms:string, series:string, number:string, date:string}, mccqt?:string|null, root?:string}} o
 */
function invoiceXml(o = {}) {
  const seller = o.seller || { mst: '0300000003', name: 'CÔNG TY TNHH BÁN HÀNG MẪU' };
  const buyer = o.buyer || { mst: '0100000001', name: 'CÔNG TY TNHH MUA HÀNG MẪU' };
  const items = o.items || [];
  const groups = o.groups;
  const related = o.related
    ? `<TTHDLQuan>${tag('TCHDon', o.related.nature)}${tag('LHDCLQuan', '1')}${tag('KHMSHDCLQuan', o.related.khms)}${tag('KHHDCLQuan', o.related.series)}${tag('SHDCLQuan', o.related.number)}${tag('NLHDCLQuan', o.related.date)}</TTHDLQuan>`
    : '<TTHDLQuan/>';
  const lines = items.map((it, i) => `<HHDVu>${tag('TChat', it.nature || 1)}${tag('STT', i + 1)}${tag('MHHDVu', it.code || '')}${tag('THHDVu', it.name)}${tag('DVTinh', it.unit || 'Cái')}${tag('SLuong', it.qty || '1')}${tag('DGia', it.price || it.amount)}${tag('ThTien', it.amount)}${tag('TSuat', it.tsuat)}${tag('TThue', it.tthue)}</HHDVu>`).join('');
  const lt = groups ? `<THTTLTSuat>${groups.map(g => `<LTSuat>${tag('TSuat', g.tsuat)}${tag('ThTien', g.net)}${tag('TThue', g.vat)}</LTSuat>`).join('')}</THTTLTSuat>` : '';
  const t = o.totals || {};
  const mccqt = o.mccqt === null ? '' : `<MCCQT>${o.mccqt || '00ABCDEF0123456789ABCDEF0123456789'}</MCCQT>`;
  const root = o.root || 'HDon';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root}><DLHDon Id="data"><TTChung>${tag('PBan', '2.1.0')}${tag('THDon', o.khms === '2' ? 'Hóa đơn bán hàng' : 'Hóa đơn giá trị gia tăng')}${tag('KHMSHDon', o.khms || '1')}${tag('KHHDon', o.series || 'C26TAA')}${tag('SHDon', o.number || '00000001')}${tag('NLap', o.date || '2026-08-15')}${tag('DVTTe', o.currency || 'VND')}${tag('TGia', o.rate || '1')}${tag('HTTToan', 'TM/CK')}${tag('MSTTCGP', '0100000999')}${related}</TTChung><NDHDon><NBan>${tag('Ten', seller.name)}${tag('MST', seller.mst)}${tag('DChi', 'Số 1 đường Mẫu, Hà Nội')}</NBan><NMua>${tag('Ten', buyer.name)}${tag('MST', buyer.mst)}${tag('DChi', 'Số 2 đường Mẫu, Hà Nội')}</NMua><DSHHDVu>${lines}</DSHHDVu><TToan>${lt}${tag('TgTCThue', t.net)}${tag('TgTThue', t.vat)}${tag('TTCKTMai', t.discount)}${tag('TgTTTBSo', t.payable)}${tag('TgTTTBChu', 'Bằng chữ')}</TToan></NDHDon></DLHDon>${mccqt}<DSCKS><NBan><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></NBan></DSCKS></${root}>`;
}

module.exports = { invoiceXml };
