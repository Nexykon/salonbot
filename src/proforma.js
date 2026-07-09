// Predračun (proforma) — HTML za email + PDF priponka. Plačilo po nakazilu.
const axios = require('axios');

const PLAN = {
  starter: { label: 'Osnovni',    price: 49.99 },
  pro:     { label: 'Pro',        price: 79.99 },
  ai:      { label: 'AI natakar', price: 159.99 },
  premium: { label: 'Premium',    price: 299 }
};

const ISSUER = {
  name:    process.env.PROFORMA_NAME    || 'Webacus, Valentin Iljaž s.p.',
  address: process.env.PROFORMA_ADDRESS || 'Nova vas 12, Bizeljsko',
  vat:     process.env.PROFORMA_VAT     || '35880643',
  iban:    process.env.PROFORMA_IBAN    || 'SI56 0298 5266 0633 091',
  novat:   'Nisem zavezanec za DDV (1. odst. 94. člena ZDDV-1). DDV ni obračunan.'
};

function eur(n) { return Number(n || 0).toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }

function computeProforma(salon, plan) {
  const p = PLAN[plan] || PLAN.starter;
  const yearly = salon.billing_period === 'yearly';
  const amount = yearly ? p.price * 12 : p.price;
  const no = 'PR-' + new Date().getFullYear() + '-' + String(salon.id).replace(/[^0-9a-f]/gi, '').slice(-6).toUpperCase();
  const sklic = 'SI00 ' + (String(salon.id).replace(/\D/g, '').slice(-8) || '0');
  return {
    p, yearly, amount, no, sklic,
    today: new Date(), due: new Date(Date.now() + 8 * 86400000),
    period: yearly ? 'letna naročnina' : 'mesečna naročnina'
  };
}

function proformaHtml(salon, plan) {
  const c = computeProforma(salon, plan);
  const td = 'border:1px solid #ccc;padding:8px';
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:640px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;gap:20px">
      <div style="font-size:14px;line-height:1.5"><b>${ISSUER.name}</b><br>${ISSUER.address}<br>Davčna št.: ${ISSUER.vat}</div>
      <div style="text-align:right;font-size:14px;line-height:1.5"><h2 style="margin:0">PREDRAČUN</h2>Št.: <b>${c.no}</b><br>Datum: ${c.today.toLocaleDateString('sl-SI')}<br>Rok plačila: ${c.due.toLocaleDateString('sl-SI')}</div>
    </div>
    <p style="margin-top:16px;font-size:14px;line-height:1.5"><b>Kupec:</b><br>${salon.company_name || salon.name || '—'}<br>${salon.address || ''}<br>${salon.vat_id ? ('Davčna št.: ' + salon.vat_id) : ''}</p>
    <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px">
      <tr><th style="${td};text-align:left">Opis</th><th style="${td};text-align:right">Znesek</th></tr>
      <tr><td style="${td}">FlowTiq paket ${c.p.label} — ${c.period}</td><td style="${td};text-align:right">${eur(c.amount)}</td></tr>
      <tr><td style="${td};text-align:right"><b>Za plačilo</b></td><td style="${td};text-align:right"><b>${eur(c.amount)}</b></td></tr>
    </table>
    <p style="font-size:14px;line-height:1.5"><b>Plačilo po nakazilu:</b> IBAN <b>${ISSUER.iban}</b><br>Sklic: <b>${c.sklic}</b><br>Namen: FlowTiq ${c.no}</p>
    <p style="color:#666;font-size:13px">${ISSUER.novat}<br>Predračun ni davčni dokument. Po prejemu plačila izdamo račun in aktiviramo storitev.</p>
    <p style="color:#111;font-size:13px"><b>Po plačilu nam prosim pošljite potrdilo o plačilu, da vas takoj aktiviramo.</b></p>
  </div>`;
}

// Unicode pisava (za šumnike) — naloži se enkrat in cachira. Če ne uspe, PDF pade (email vseeno gre).
let _font = null;
async function getFont() {
  if (_font) return _font;
  const url = process.env.PROFORMA_FONT_URL || 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf';
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  _font = Buffer.from(r.data);
  return _font;
}

async function proformaPdf(salon, plan) {
  const c = computeProforma(salon, plan);
  const PDFDocument = require('pdfkit');
  const font = await getFont();
  return await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', d => chunks.push(d));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.registerFont('u', font); doc.font('u');
      doc.fontSize(10).text(ISSUER.name); doc.text(ISSUER.address); doc.text('Davčna št.: ' + ISSUER.vat);
      doc.moveDown(0.5); doc.fontSize(22).text('PREDRAČUN'); doc.fontSize(10);
      doc.text('Številka: ' + c.no);
      doc.text('Datum: ' + c.today.toLocaleDateString('sl-SI'));
      doc.text('Rok plačila: ' + c.due.toLocaleDateString('sl-SI'));
      doc.moveDown(0.7); doc.fontSize(11).text('Kupec:'); doc.fontSize(10);
      doc.text(salon.company_name || salon.name || '-');
      if (salon.address) doc.text(salon.address);
      if (salon.vat_id) doc.text('Davčna št.: ' + salon.vat_id);
      doc.moveDown(0.7);
      doc.text('FlowTiq paket ' + c.p.label + ' — ' + c.period + ':    ' + eur(c.amount));
      doc.fontSize(12).text('ZA PLAČILO:    ' + eur(c.amount)); doc.fontSize(10);
      doc.moveDown(0.7); doc.text('Plačilo po nakazilu:');
      doc.text('IBAN: ' + ISSUER.iban);
      doc.text('Sklic: ' + c.sklic);
      doc.text('Namen: FlowTiq ' + c.no);
      doc.moveDown(0.7); doc.fontSize(8).fillColor('#666');
      doc.text(ISSUER.novat);
      doc.text('Predračun ni davčni dokument. Po prejemu plačila izdamo račun in aktiviramo storitev.');
      doc.end();
    } catch (e) { reject(e); }
  });
}

module.exports = { PLAN, ISSUER, computeProforma, proformaHtml, proformaPdf };
