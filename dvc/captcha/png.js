// Giải mã PNG tối giản (không thư viện ngoài) đủ cho ảnh captcha của dichvucong:
// 8 bit/kênh, các kiểu màu Gray / RGB / Palette / Gray+Alpha / RGBA, không interlace.
// Trả về ảnh xám { width, height, data: Uint8Array } (0 = đen, 255 = trắng).
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('Không phải ảnh PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h) throw new Error('PNG thiếu IHDR');
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} chưa hỗ trợ`);
  if (interlace) throw new Error('PNG interlace chưa hỗ trợ');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error(`PNG color type ${ctype} chưa hỗ trợ`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[prev + x] : 0, c = x >= ch && y ? px[prev + x - ch] : 0;
      px[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, al = 255;
    if (ctype === 0) r = g = b = px[i];
    else if (ctype === 4) { r = g = b = px[i * 2]; al = px[i * 2 + 1]; }
    else if (ctype === 3) { const k = px[i] * 3; r = palette[k]; g = palette[k + 1]; b = palette[k + 2]; }
    else { r = px[i * ch]; g = px[i * ch + 1]; b = px[i * ch + 2]; if (ch === 4) al = px[i * 4 + 3]; }
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = Math.round(l * al / 255 + 255 * (1 - al / 255)); // nền trong suốt coi là trắng
  }
  return { width: w, height: h, data: gray };
}

module.exports = { decodePng };
