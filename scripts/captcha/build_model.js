// Tạo dvc/captcha/model.json:
//   1) python3 scripts/captcha/gen_synthetic.py 700 /tmp/syn/1 1   (lặp với vài seed; cần Pillow + numpy)
//   2) node scripts/captcha/build_model.js /tmp/samples.json /tmp/syn/1 /tmp/syn/2 ...   (mỗi thư mục có labels.json)
//   3) python3 scripts/captcha/condense.py /tmp/samples.json /tmp/model.json 150         (gom còn 150 mẫu/ký tự)
//   4) node scripts/captcha/build_model.js --add-real /tmp/model.json test/fixtures/captcha dvc/captcha/model.json
const fs = require('fs');
const path = require('path');
const { analyze } = require('../../dvc/captcha/solver');
const r3 = v => v.map(x => Math.round(x * 1e3) / 1e3);

if (process.argv[2] === '--add-real') {
  const [, , , modelIn, realDir, out] = process.argv;
  const m = JSON.parse(fs.readFileSync(modelIn, 'utf8'));
  m.samples = [];
  for (const f of fs.readdirSync(realDir).filter(x => x.endsWith('.png'))) {
    const label = f.slice(0, 5), a = analyze(fs.readFileSync(path.join(realDir, f)));
    if (a.vectors.length === 5) a.vectors.forEach((v, i) => m.samples.push({ c: label[i], v: r3(v), w: 3 }));
  }
  fs.writeFileSync(out, JSON.stringify(m));
  console.log('mẫu thật:', m.samples.length);
} else {
  const [, , out, ...dirs] = process.argv;
  const samples = []; let ok = 0, bad = 0;
  for (const d of dirs) {
    const L = JSON.parse(fs.readFileSync(path.join(d, 'labels.json'), 'utf8'));
    for (const [f, t] of Object.entries(L)) {
      const a = analyze(fs.readFileSync(path.join(d, f + '.png')));
      if (a.vectors.length !== 5) { bad++; continue; }
      ok++; a.vectors.forEach((v, i) => samples.push({ c: t[i], v: r3(v) }));
    }
  }
  fs.writeFileSync(out, JSON.stringify({ samples }));
  console.log('ảnh dùng được', ok, 'bỏ', bad, 'vector', samples.length);
}
