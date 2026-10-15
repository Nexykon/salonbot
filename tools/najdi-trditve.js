/*
  Popis trditev brez navedenega vira — samo izpis, nič ne spreminja.

      node tools/najdi-trditve.js

  To niso prepovedane številke (za tiste je tools/najdi-stevilke.js), ampak
  trditve, za katere na strani ni navedeno, od kod so. Nekatere so morda
  resnične in jih je mogoče podpreti; dokler to ni jasno, je vredno vedeti,
  kje stojijo, da se o njih odloči naenkrat in ne po naključju.
*/
const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..', 'public');
const IZDELEK = ['salon.html', 'delivery.html', 'admin.html', 'leads.html', 'setup.html', 'geslo.html'];

const ISKANO = [
  ['+2 uri plačanega dela', /\+2 uri/],
  ['≈ 16 h manj telefoniranja', /16 h\b/],
  ['3 od 10 terminov prazna', /3 od 10/],
  ['1 od 10', /1 od 10/],
  ['Naročilo v 3 minutah', /v 3 minutah/],
  ['pogovor v manj kot dveh minutah', /manj kot dveh minutah/],
  ['0 zamujenih povpraševanj', /0 zamujenih/],
  ['lijak 100 → 73 → 27', /\b73\b/],
  ['≈ 660 €', /660 €/],
  ['13 × vrnjeno', /13 ?× ?vrnjen|13-krat/],
];

function datoteke(dir) {
  const ven = [];
  for (const v of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, v.name);
    if (v.isDirectory()) ven.push(...datoteke(p));
    else if (['.html', '.txt'].includes(path.extname(v.name)) && !IZDELEK.includes(v.name)) ven.push(p);
  }
  return ven;
}

const najdbe = new Map(ISKANO.map(([ime]) => [ime, []]));
for (const f of datoteke(KOREN)) {
  const rel = path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/');
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((vrstica, i) => {
    for (const [ime, re] of ISKANO) if (re.test(vrstica)) najdbe.get(ime).push(rel + ':' + (i + 1));
  });
}

console.log('\n  TRDITVE BREZ NAVEDENEGA VIRA — samo popis, nič spremenjenega\n');
for (const [ime, mesta] of najdbe) {
  console.log('  ' + ime);
  console.log('    ' + (mesta.length ? mesta.join('\n    ') : '(ni na strani)'));
}
console.log('');
