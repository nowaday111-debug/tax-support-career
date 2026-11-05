'use strict';
// Xử lý tiền VND bằng số nguyên. Không dùng phép nhân số thực để tránh sai số dấu phẩy động:
// mọi số thập phân trong XML hóa đơn được đọc dạng chuỗi rồi quy về BigInt có hệ số tỉ lệ.
//
// Quy tắc làm tròn: nửa lên, xa số 0 (0,5 -> 1; -0,5 -> -1). Đây là cách làm tròn
// tiền thông thường; HTKK yêu cầu số nguyên (xs:long) cho các chỉ tiêu tiền.

const DEC_RE = /^\s*([+-]?)(\d*)(?:[.,](\d*))?\s*$/;

/**
 * Đọc chuỗi số thập phân thành { neg, int: BigInt phần nguyên, frac: string phần lẻ }.
 * Trả về null nếu rỗng hoặc không phải số.
 */
function parseDecimal(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    value = value.toString();
    if (/e/i.test(value)) value = Number(value).toFixed(20).replace(/0+$/, '');
  }
  const s = String(value).trim();
  if (s === '') return null;
  const m = DEC_RE.exec(s);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
  return { neg: m[1] === '-', int: BigInt(m[2] || '0'), frac: (m[3] || '').replace(/0+$/, '') };
}

/** Chuỗi thập phân -> BigInt nhân 10^scale (cắt bớt phần lẻ vượt scale sau khi làm tròn). */
function toScaled(value, scale) {
  const d = parseDecimal(value);
  if (!d) return null;
  const frac = d.frac.padEnd(scale + 1, '0');
  let n = d.int * 10n ** BigInt(scale) + BigInt(frac.slice(0, scale) || '0');
  if (frac.length > scale && Number(frac[scale]) >= 5) n += 1n;
  return d.neg ? -n : n;
}

/** Chia BigInt có làm tròn nửa xa số 0. */
function divRound(num, den) {
  if (den === 0n) throw new Error('Chia cho 0');
  const neg = (num < 0n) !== (den < 0n);
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  let q = a / b;
  if ((a % b) * 2n >= b) q += 1n;
  return neg ? -q : q;
}

/** Chuỗi/số thập phân -> số nguyên VND (Number), làm tròn nửa xa số 0. null nếu không đọc được. */
function toVnd(value) {
  const n = toScaled(value, 0);
  return n === null ? null : bigToNumber(n);
}

/** Nhân hai số thập phân (vd: tiền ngoại tệ x tỷ giá) rồi làm tròn về VND. */
function mulToVnd(a, b) {
  const SCALE = 9;
  const x = toScaled(a, SCALE);
  const y = toScaled(b, SCALE);
  if (x === null || y === null) return null;
  return bigToNumber(divRound(x * y, 10n ** BigInt(SCALE * 2)));
}

/** round(amount * pct / 100) với amount nguyên VND, pct là số nguyên hoặc thập phân dạng chuỗi. */
function percentOf(amount, pct) {
  const SCALE = 6;
  const p = toScaled(pct, SCALE);
  return bigToNumber(divRound(BigInt(amount) * p, 100n * 10n ** BigInt(SCALE)));
}

function bigToNumber(n) {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Số tiền vượt giới hạn an toàn: ${n}`);
  }
  return Number(n);
}

/**
 * Phân bổ tổng `total` (số nguyên) theo trọng số `weights` (số nguyên, có thể âm),
 * dùng phương pháp phần dư lớn nhất để tổng các phần bằng đúng `total`.
 */
function allocate(total, weights) {
  if (weights.length === 0) return [];
  const sumW = weights.reduce((a, w) => a + w, 0);
  if (sumW === 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const T = BigInt(total);
  const S = BigInt(sumW);
  const raw = weights.map(w => {
    const num = T * BigInt(w);
    let q = num / S; // cắt về 0
    let r = num - q * S;
    if ((r !== 0n) && ((r < 0n) !== (S < 0n))) { q -= 1n; r += S; } // floor
    return { q, r: r < 0n ? -r : r };
  });
  let rest = T - raw.reduce((a, x) => a + x.q, 0n);
  const order = raw.map((x, i) => i).sort((i, j) => (raw[j].r > raw[i].r ? 1 : raw[j].r < raw[i].r ? -1 : i - j));
  const out = raw.map(x => x.q);
  const step = rest >= 0n ? 1n : -1n;
  let k = 0;
  while (rest !== 0n) {
    out[order[k % order.length]] += step;
    rest -= step;
    k++;
  }
  return out.map(bigToNumber);
}

module.exports = { parseDecimal, toScaled, divRound, toVnd, mulToVnd, percentOf, allocate };
