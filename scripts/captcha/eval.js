// Đo độ chính xác bộ tự đọc captcha trên 1 thư mục ảnh đã biết mã: tên file = mã đúng (vd. 2di7r.png).
//   node scripts/captcha/eval.js test/fixtures/captcha [--learned data/captcha/learned.json] [--no-real]
const fs = require('fs');
const path = require('path');
const { CaptchaSolver } = require('../../dvc/captcha/solver');

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', '..', 'test', 'fixtures', 'captcha');
const li = args.indexOf('--learned');
let modelPath;
if (args.includes('--no-real')) { // chỉ mẫu tổng hợp: đo khách quan khi thư mục ảnh trùng mẫu thật trong model.json
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'dvc', 'captcha', 'model.json'), 'utf8'));
  delete m.samples;
  modelPath = path.join(require('os').tmpdir(), 'captcha-model-syn.json');
  fs.writeFileSync(modelPath, JSON.stringify(m));
}
const solver = new CaptchaSolver({ modelPath, learnPath: li >= 0 ? args[li + 1] : null });
let n = 0, full = 0, chars = 0;
for (const f of fs.readdirSync(dir).filter(x => /\.png$/i.test(x))) {
  const label = path.basename(f, '.png').toLowerCase().slice(0, 5);
  const r = solver.solve(fs.readFileSync(path.join(dir, f)));
  const c = [...label].filter((x, i) => r.text[i] === x).length;
  n++; chars += c; if (r.text === label) full++;
  console.log(`${label}  ->  ${r.text || '(' + r.reason + ')'}  ${r.text === label ? 'ĐÚNG' : 'sai'}  tin cậy ${r.confidence}`);
}
console.log(`\n${n} ảnh: đúng cả mã ${full}/${n} (${Math.round(100 * full / Math.max(n, 1))}%), đúng ký tự ${chars}/${n * 5} (${Math.round(100 * chars / Math.max(n * 5, 1))}%)`);
