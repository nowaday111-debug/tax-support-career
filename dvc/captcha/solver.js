// Tự giải captcha của dichvucong.gdt.gov.vn (ảnh PNG 150x38, 5 ký tự a-z0-9, nền chuyển màu xám,
// chữ đậm có nhiễu dạng nét chải). Không dùng thư viện ngoài:
//   1. Giải mã PNG -> ảnh xám (png.js)
//   2. Bỏ khung đen, ước lượng nền theo từng cột (nền là dải chuyển màu ngang), lấy "độ mực" = nền - điểm ảnh
//   3. Làm mờ 3x3 để lấp nhiễu chải, phân ngưỡng -> ảnh nhị phân
//   4. Tách 5 ký tự bằng thành phần liên thông + gộp/tách theo hình chiếu cột
//   5. Mỗi ký tự -> vector đặc trưng (lưới 16x16 giữ tỉ lệ + vị trí trong dòng chữ) -> k-NN với thư viện mẫu
// Thư viện mẫu gồm mẫu khởi tạo (model.json, đóng gói sẵn) + mẫu học thêm trên máy (mỗi lần cổng chấp nhận
// captcha, kể cả captcha người dùng gõ tay, các ký tự được lưu lại để lần sau đoán đúng hơn).
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./png');

const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const N_CHARS = 5;
const GRID = 16;

// ---------------- Tiền xử lý ----------------
function stripFrame(img) {
  const { width: w, height: h, data } = img;
  const rowMean = y => { let s = 0; for (let x = 0; x < w; x++) s += data[y * w + x]; return s / w; };
  const colMean = x => { let s = 0; for (let y = 0; y < h; y++) s += data[y * w + x]; return s / h; };
  let t = 0, b = h - 1, l = 0, r = w - 1;
  while (t < 3 && rowMean(t) < 110) t++;
  while (b > h - 4 && rowMean(b) < 110) b--;
  while (l < 3 && colMean(l) < 110) l++;
  while (r > w - 4 && colMean(r) < 110) r--;
  const W = r - l + 1, H = b - t + 1, out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = data[(y + t) * w + x + l];
  return { width: W, height: H, data: out };
}

// Độ mực 0..255 (0 = nền). Nền mỗi cột = phân vị 80% của cột, làm trơn theo trung vị 7 cột.
function inkMap(img) {
  const { width: w, height: h, data } = img;
  const bg0 = new Float32Array(w);
  const col = new Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = data[y * w + x];
    col.sort((a, b) => a - b);
    bg0[x] = col[Math.min(h - 1, Math.floor(h * 0.8))];
  }
  const bg = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const win = [];
    for (let k = -3; k <= 3; k++) { const xx = x + k; if (xx >= 0 && xx < w) win.push(bg0[xx]); }
    win.sort((a, b) => a - b); bg[x] = win[win.length >> 1];
  }
  const ink = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ink[y * w + x] = Math.max(0, bg[x] - data[y * w + x]);
  return { width: w, height: h, data: ink };
}

function blur3(m) {
  const { width: w, height: h, data } = m, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) { s += data[yy * w + xx]; n++; }
    }
    out[y * w + x] = s / n;
  }
  return { width: w, height: h, data: out };
}

function binarize(m, thr) {
  const { width: w, height: h, data } = m, out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i] >= thr ? 1 : 0;
  return { width: w, height: h, data: out };
}

// ---------------- Tách ký tự ----------------
function components(bin) {
  const { width: w, height: h, data } = bin, lab = new Int32Array(w * h).fill(-1), comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!data[i] || lab[i] >= 0) continue;
    const c = { id: comps.length, px: [], x0: w, x1: -1, y0: h, y1: -1 };
    lab[i] = c.id; stack.push(i);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      c.px.push(p);
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (data[q] && lab[q] < 0) { lab[q] = c.id; stack.push(q); }
      }
    }
    comps.push(c);
  }
  return comps;
}

function mergeSegs(a, b) {
  return { px: a.px.concat(b.px), x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) };
}
const segW = s => s.x1 - s.x0 + 1;

function bboxOf(px, w) {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (const p of px) { const x = p % w, y = (p - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { px, x0, x1, y0, y1 };
}

// Tách 1 đoạn thành k phần tại các cột có ít mực nhất (gần vị trí chia đều)
function splitSeg(s, k, w) {
  const W = segW(s), proj = new Float32Array(W);
  for (const p of s.px) proj[(p % w) - s.x0]++;
  const cuts = [];
  for (let j = 1; j < k; j++) {
    const target = Math.round(W * j / k), rad = Math.max(2, Math.round(W / k * 0.35));
    let best = target, bv = Infinity;
    for (let c = Math.max(1, target - rad); c <= Math.min(W - 2, target + rad); c++) {
      const v = proj[c] + 0.3 * Math.abs(c - target); // ưu tiên cột ít mực, gần điểm chia đều
      if (v < bv) { bv = v; best = c; }
    }
    cuts.push(s.x0 + best);
  }
  const parts = Array.from({ length: k }, () => []);
  for (const p of s.px) { const x = p % w; let i = 0; while (i < cuts.length && x >= cuts[i]) i++; parts[i].push(p); }
  return parts.filter(p => p.length).map(p => bboxOf(p, w));
}

function segment(bin, n = N_CHARS) {
  const w = bin.width;
  let segs = components(bin).filter(c => c.px.length >= 6);
  if (!segs.length) return [];
  segs.sort((a, b) => a.x0 - b.x0);
  // 1) gộp các mảnh chồng nhau theo phương ngang (chấm của i/j, nét bị đứt)
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length && !changed; i++) for (let j = i + 1; j < segs.length && !changed; j++) {
      const a = segs[i], b = segs[j];
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
      if (ov > 0 && ov >= 0.6 * Math.min(segW(a), segW(b))) { segs.splice(j, 1); segs[i] = mergeSegs(a, b); changed = true; }
    }
  }
  segs.sort((a, b) => a.x0 - b.x0);
  // 2) bỏ mảnh vụn rất nhỏ nằm tách biệt (nhiễu)
  const total = segs.reduce((s, c) => s + c.px.length, 0);
  segs = segs.filter(c => c.px.length >= Math.max(10, total * 0.012));
  // 3) gộp mảnh nhỏ vào hàng xóm gần nhất cho đến khi ≤ n
  while (segs.length > n) {
    let bi = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].px.length < segs[bi].px.length) bi = i;
    const s = segs[bi], L = segs[bi - 1], R = segs[bi + 1];
    const gap = o => (o ? Math.max(0, Math.max(o.x0, s.x0) - Math.min(o.x1, s.x1)) + 0.15 * segW(o) : Infinity);
    const t = gap(L) <= gap(R) ? bi - 1 : bi + 1;
    const m = mergeSegs(segs[Math.min(bi, t)], segs[Math.max(bi, t)]);
    segs.splice(Math.min(bi, t), 2, m);
  }
  // 4) tách đoạn rộng nhất (ký tự dính nhau) cho đến khi đủ n
  let guard = 0;
  while (segs.length < n && guard++ < 10) {
    const span = segs[segs.length - 1].x1 - segs[0].x0 + 1, unit = span / n;
    let bi = 0;
    for (let i = 1; i < segs.length; i++) if (segW(segs[i]) > segW(segs[bi])) bi = i;
    const need = n - segs.length;
    const k = Math.max(2, Math.min(need + 1, Math.round(segW(segs[bi]) / unit)));
    const parts = splitSeg(segs[bi], k, w);
    if (parts.length < 2) break;
    segs.splice(bi, 1, ...parts);
  }
  return segs.sort((a, b) => a.x0 - b.x0);
}

// ---------------- Đặc trưng ----------------
function features(seg, w, line) {
  const W = seg.x1 - seg.x0 + 1, H = seg.y1 - seg.y0 + 1, S = Math.max(W, H);
  const g = new Float32Array(GRID * GRID);
  // đặt ký tự vào ô vuông S x S, căn giữa, rồi gom về lưới GRID x GRID
  const ox = (S - W) / 2, oy = (S - H) / 2;
  for (const p of seg.px) {
    const x = (p % w) - seg.x0 + ox, y = Math.floor(p / w) - seg.y0 + oy;
    const gx = Math.min(GRID - 1, Math.floor(x * GRID / S)), gy = Math.min(GRID - 1, Math.floor(y * GRID / S));
    g[gy * GRID + gx] += 1;
  }
  const cell = (S / GRID) ** 2;
  for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] / cell);
  // làm mờ lưới để chịu được lệch 1 ô (nét xoay/nghiêng nhẹ)
  const sm = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= GRID || xx >= GRID) continue;
      const wt = dx === 0 && dy === 0 ? 4 : (dx === 0 || dy === 0 ? 2 : 1); s += wt * g[yy * GRID + xx]; n += wt;
    }
    sm[y * GRID + x] = s / n;
  }
  g.set(sm);
  let norm = 0;
  for (let i = 0; i < g.length; i++) norm += g[i] * g[i];
  norm = Math.sqrt(norm) || 1;
  const v = Array.from(g, x => x / norm);
  const lh = Math.max(1, line.y1 - line.y0 + 1);
  // đặc trưng hình học: phân biệt o/0, l/1/i, p/q/g/y (đuôi dưới), b/d/h/k (nét lên)
  v.push(1.2 * (seg.y0 - line.y0) / lh, 1.2 * (line.y1 - seg.y1) / lh, 1.0 * H / lh, 0.8 * W / Math.max(H, 1));
  return v;
}

function lineBox(segs) {
  const tops = segs.map(s => s.y0).sort((a, b) => a - b), bots = segs.map(s => s.y1).sort((a, b) => a - b);
  return { y0: tops[0], y1: bots[bots.length - 1] };
}

// ---------------- Phân tích ảnh -> các vector ký tự ----------------
function analyze(input, { threshold = 52 } = {}) {
  let img;
  if (input && input.data && input.width) img = input;
  else {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input).replace(/^data:image\/\w+;base64,/, ''), 'base64');
    img = decodePng(buf);
  }
  const core = stripFrame(img);
  const ink = blur3(inkMap(core));
  const bin = binarize(ink, threshold);
  const segs = segment(bin);
  if (!segs.length) return { segs: [], vectors: [], width: core.width };
  const line = lineBox(segs);
  return { segs, vectors: segs.map(s => features(s, core.width, line)), width: core.width, bin };
}

// ---------------- Mô hình k-NN ----------------
function dist2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; }

class CaptchaSolver {
  // opts: { modelPath (mẫu đóng gói), learnPath (mẫu học thêm trên máy), k }
  constructor(opts = {}) {
    this.modelPath = opts.modelPath === undefined ? path.join(__dirname, 'model.json') : opts.modelPath;
    this.learnPath = opts.learnPath || null;
    this.k = opts.k || 3;
    this.maxLearned = opts.maxLearned || 6000;
    this.samples = [];   // {c, v, w(weight)}
    this.learned = [];
    this.load();
  }
  load() {
    this.samples = [];
    if (this.modelPath && fs.existsSync(this.modelPath)) {
      const m = JSON.parse(fs.readFileSync(this.modelPath, 'utf8'));
      if (m.data) {
        // dạng gọn: vector lượng tử hóa uint8 (giá trị × scale), base64; nhãn nối thành chuỗi
        const raw = Buffer.from(m.data, 'base64'), dim = m.dim, sc = m.scale || 100;
        for (let i = 0; i < m.labels.length; i++) {
          const v = new Float32Array(dim);
          for (let j = 0; j < dim; j++) v[j] = raw[i * dim + j] / sc;
          this.samples.push({ c: m.labels[i], v, w: 1 });
        }
      }
      for (const s of m.samples || []) this.samples.push({ c: s.c, v: s.v, w: s.w || 1 });
    }
    this.learned = [];
    if (this.learnPath && fs.existsSync(this.learnPath)) {
      try { this.learned = JSON.parse(fs.readFileSync(this.learnPath, 'utf8')).samples || []; } catch { this.learned = []; }
    }
  }
  get size() { return this.samples.length + this.learned.length; }
  get learnedCount() { return this.learned.length / N_CHARS; }
  // Ảnh {mime, base64} có đọc được không (chỉ PNG; cổng giả lập dùng SVG nên luôn phải nhập tay)
  canRead(img) { return !!(img && img.base64 && /png/i.test(img.mime || 'image/png')); }

  classify(v) {
    // mẫu thật học trên máy được ưu tiên (trọng số 2) so với mẫu khởi tạo
    const all = [];
    const push = (s, w) => all.push({ c: s.c, d: dist2(v, s.v), w });
    for (const s of this.samples) push(s, s.w || 1);
    for (const s of this.learned) push(s, 2);
    all.sort((a, b) => a.d - b.d);
    const top = all.slice(0, this.k);
    const score = {};
    for (const t of top) score[t.c] = (score[t.c] || 0) + t.w / (t.d + 0.05);
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    const tot = ranked.reduce((s, r) => s + r[1], 0) || 1;
    return { c: ranked[0] ? ranked[0][0] : '?', conf: ranked[0] ? ranked[0][1] / tot : 0, d: top[0] ? top[0].d : Infinity };
  }

  // Trả về { text, confidence (0..1), chars:[{c,conf,d}], ok }
  solve(input) {
    if (input && input.base64 !== undefined) input = input.base64; // nhận cả {mime, base64}
    if (!this.size) return { text: '', confidence: 0, chars: [], ok: false, reason: 'Chưa có mẫu' };
    let a;
    try { a = analyze(input); } catch (e) { return { text: '', confidence: 0, chars: [], ok: false, reason: e.message }; }
    if (a.vectors.length !== N_CHARS) return { text: '', confidence: 0, chars: [], ok: false, reason: `Tách được ${a.vectors.length} ký tự` };
    const chars = a.vectors.map(v => this.classify(v));
    const text = chars.map(c => c.c).join('');
    // độ tin cậy tổng = tích độ phiếu bầu × hệ số theo khoảng cách gần nhất
    let conf = 1;
    for (const c of chars) conf *= c.conf * Math.max(0.2, Math.min(1, 1.2 - c.d));
    return { text, confidence: Math.round(conf * 1000) / 1000, chars, ok: true };
  }

  // Ghi nhớ captcha đã được cổng chấp nhận (nhãn chắc chắn đúng)
  learn(input, label) {
    if (input && input.base64 !== undefined) input = input.base64;
    label = String(label || '').trim().toLowerCase();
    if (label.length !== N_CHARS || [...label].some(c => !CHARSET.includes(c))) return 0;
    let a;
    try { a = analyze(input); } catch { return 0; }
    if (a.vectors.length !== N_CHARS) return 0;
    a.vectors.forEach((v, i) => this.learned.push({ c: label[i], v: v.map(x => Math.round(x * 1e4) / 1e4) }));
    if (this.learned.length > this.maxLearned) this.learned.splice(0, this.learned.length - this.maxLearned);
    this.save();
    return N_CHARS;
  }
  save() {
    if (!this.learnPath) return;
    fs.mkdirSync(path.dirname(this.learnPath), { recursive: true });
    const tmp = this.learnPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, charset: CHARSET, grid: GRID, samples: this.learned }));
    fs.renameSync(tmp, this.learnPath);
  }
}

module.exports = { CaptchaSolver, analyze, segment, features, decodePng, CHARSET, N_CHARS, GRID };
