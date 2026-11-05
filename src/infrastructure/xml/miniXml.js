'use strict';
// Bộ đọc XML tối giản, không cần thư viện ngoài. Đủ cho hóa đơn điện tử và tờ khai HTKK:
// phần tử, thuộc tính, văn bản, CDATA, chú thích, chỉ thị xử lý, thực thể chuẩn và số.
// Tên có tiền tố namespace (ds:Signature) được giữ ở `qname`, còn `name` là tên cục bộ.
// Không hỗ trợ DTD nội tuyến có khai báo thực thể riêng (gặp sẽ báo lỗi).

class XmlError extends Error {}

/** Giải mã Buffer theo BOM: UTF-8 (mặc định), UTF-16 LE/BE. */
function decode(input) {
  if (typeof input === 'string') return input.replace(/^﻿/, '');
  const b = Buffer.from(input);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescape(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(cp);
    }
    if (ENT[e] !== undefined) return ENT[e];
    throw new XmlError(`Thực thể không hỗ trợ: &${e};`);
  });
}

function parse(input) {
  const s = decode(input);
  let i = 0;
  const root = { name: '#document', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) { addText(top(), s.slice(i)); break; }
    if (lt > i) addText(top(), s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlError('Chú thích không đóng');
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlError('CDATA không đóng');
      top().text = (top().text || '') + s.slice(lt + 9, end);
      i = end + 3;
    } else if (s.startsWith('<?', lt)) {
      const end = s.indexOf('?>', lt + 2);
      if (end === -1) throw new XmlError('Chỉ thị xử lý không đóng');
      i = end + 2;
    } else if (s.startsWith('<!DOCTYPE', lt)) {
      const end = s.indexOf('>', lt);
      if (s.slice(lt, end).includes('[')) throw new XmlError('Không hỗ trợ DOCTYPE có khai báo nội tuyến');
      i = end + 1;
    } else if (s[lt + 1] === '/') {
      const end = s.indexOf('>', lt);
      if (end === -1) throw new XmlError('Thẻ đóng không hoàn chỉnh');
      const qname = s.slice(lt + 2, end).trim();
      const el = stack.pop();
      if (!el || el.qname !== qname) throw new XmlError(`Thẻ đóng </${qname}> không khớp <${el && el.qname}>`);
      i = end + 1;
    } else {
      // thẻ mở: đọc tên và thuộc tính, tôn trọng dấu nháy
      let j = lt + 1;
      while (j < s.length && !/[\s/>]/.test(s[j])) j++;
      const qname = s.slice(lt + 1, j);
      if (!qname) throw new XmlError(`Tên thẻ rỗng tại vị trí ${lt}`);
      const attrs = {};
      let selfClose = false;
      for (;;) {
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === '>') { j++; break; }
        if (s[j] === '/' && s[j + 1] === '>') { selfClose = true; j += 2; break; }
        if (j >= s.length) throw new XmlError(`Thẻ <${qname}> không đóng`);
        let k = j;
        while (k < s.length && !/[\s=]/.test(s[k])) k++;
        const an = s.slice(j, k);
        while (/\s/.test(s[k])) k++;
        if (s[k] !== '=') throw new XmlError(`Thuộc tính ${an} thiếu dấu =`);
        k++;
        while (/\s/.test(s[k])) k++;
        const q = s[k];
        if (q !== '"' && q !== "'") throw new XmlError(`Giá trị thuộc tính ${an} thiếu dấu nháy`);
        const ve = s.indexOf(q, k + 1);
        if (ve === -1) throw new XmlError(`Giá trị thuộc tính ${an} không đóng`);
        attrs[an] = unescape(s.slice(k + 1, ve));
        j = ve + 1;
      }
      const el = { name: localName(qname), qname, attrs, children: [], text: '' };
      top().children.push(el);
      if (!selfClose) stack.push(el);
      i = j;
    }
  }
  if (stack.length !== 1) throw new XmlError(`Thẻ <${top().qname}> chưa đóng`);
  const elements = root.children;
  if (elements.length !== 1) throw new XmlError('Tài liệu XML phải có đúng một phần tử gốc');
  return elements[0];
}

function addText(el, raw) {
  if (el.name === '#document') {
    if (raw.trim()) throw new XmlError('Có văn bản ngoài phần tử gốc');
    return;
  }
  el.text = (el.text || '') + unescape(raw);
}

function localName(q) { const p = q.indexOf(':'); return p === -1 ? q : q.slice(p + 1); }

// ---- truy vấn ----
/** Con trực tiếp đầu tiên có tên cục bộ `name`. */
function child(el, name) { return el ? el.children.find(c => c.name === name) || null : null; }
/** Tất cả con trực tiếp có tên `name`. */
function children(el, name) { return el ? el.children.filter(c => c.name === name) : []; }
/** Đi theo đường dẫn "A/B/C" qua các con trực tiếp. */
function at(el, path) {
  let cur = el;
  for (const p of path.split('/')) { cur = child(cur, p); if (!cur) return null; }
  return cur;
}
/** Văn bản đã trim tại đường dẫn; null nếu không có thẻ; '' nếu thẻ rỗng. */
function text(el, path) {
  const n = path ? at(el, path) : el;
  return n ? String(n.text || '').trim() : null;
}

module.exports = { parse, decode, child, children, at, text, XmlError };
