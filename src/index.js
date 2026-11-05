'use strict';
// Điểm vào của lớp nghiệp vụ mới (src/). Ghép Parser -> Engine -> Exporter cho 01/GTGT TT80.

const fs = require('fs');
const path = require('path');
const { parseInvoiceXml } = require('./parsers/invoiceXmlParser');
const { computeGtgt01 } = require('./engines/gtgt01/engine');
const { selectInvoices } = require('./engines/gtgt01/selection');
const { buildGtgt01Tt80Xml } = require('./exporters/htkk/gtgt01Tt80Xml');
const ledger = require('./parsers/ledgerBuilder');
const { parsePeriod, makePeriod, previousPeriod } = require('./domain/period');

/** Đọc mọi file .xml trong thư mục (đệ quy). Trả về {invoices, errors}. */
function loadInvoicesFromDir(dir) {
  const invoices = [];
  const errors = [];
  const walk = d => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.xml$/i.test(name)) {
        try { invoices.push(parseInvoiceXml(fs.readFileSync(p), { sourceFile: p })); } catch (e) { errors.push({ file: p, code: e.code || 'ERROR', message: e.message }); }
      }
    }
  };
  walk(dir);
  return { invoices, errors };
}

module.exports = {
  parseInvoiceXml, computeGtgt01, selectInvoices, buildGtgt01Tt80Xml, ledger,
  parsePeriod, makePeriod, previousPeriod, loadInvoicesFromDir,
};
