/*
  Predloga generatorja in objavljene strani se morata ujemati.

  tools/gradi-panoge.js na novo napiše 12 panožnih strani in osveži oznake v
  index.html in panoge.html. Kadar kdo popravi nogo neposredno na straneh,
  predloge pa ne, naslednja gradnja popravek tiho povozi. V tem projektu se je
  to zgodilo že dvakrat: enkrat s povezavama na llms.txt in razvoj po meri,
  drugič s povezavo na Webacus in odstranitvijo davčne številke.

  Trditev je preprosta: gradnja iz čistega stanja ne sme ničesar spremeniti.
  Preizkus stanje vrne tudi, kadar pade, da ne pusti sledi v repozitoriju.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');

const poti = [
  ...fs.readdirSync(path.join(PUB, 'panoga')).filter(f => f.endsWith('.html')).map(f => 'panoga/' + f),
  'index.html', 'panoge.html'
];

const pred = new Map(poti.map(p => [p, fs.readFileSync(path.join(PUB, p), 'utf8')]));

// Generator piše LF, delovno drevo ima na Windowsu CRLF. Git to ob commitu
// normalizira, zato prelomi vrstic niso vsebina in jih pri primerjavi
// izenačimo — drugače bi preizkus padal iz napačnega razloga.
const vsebina = (s) => s.replace(/\r\n/g, '\n');

let izhod = '';
try {
  izhod = execFileSync(process.execPath, [path.join(KOREN, 'tools/gradi-panoge.js')],
    { cwd: KOREN, encoding: 'utf8' });
} catch (e) {
  console.log('✖ generator se je ustavil z napako:\n' + (e.stdout || '') + (e.stderr || ''));
  process.exit(1);
}

const razlicne = poti.filter(p =>
  vsebina(fs.readFileSync(path.join(PUB, p), 'utf8')) !== vsebina(pred.get(p)));

// Delovno drevo vrnemo natanko tako, kot smo ga našli — tudi kadar se je
// spremenil samo prelom vrstic, da preizkus ne pušča sledi v repozitoriju.
for (const p of poti) {
  const zdaj = fs.readFileSync(path.join(PUB, p), 'utf8');
  if (zdaj !== pred.get(p)) fs.writeFileSync(path.join(PUB, p), pred.get(p));
}

const zgrajenih = (izhod.match(/Zgrajenih strani: (\d+)/) || [, '0'])[1];
console.log('\nUjemanje predloge in strani');
console.log('  ' + (zgrajenih === '12' ? '✔' : '✖') + ' generator zgradi 12 panožnih strani (' + zgrajenih + ')');

if (razlicne.length) {
  console.log('  ✖ gradnja spremeni ' + razlicne.length + ' datotek — predloga in strani se razhajata:');
  razlicne.forEach(p => console.log('      ' + p));
  console.log('\n  Popravi tools/gradi-panoge.js, da se ujema s stranmi (ali pa strani');
  console.log('  ustvari na novo z generatorjem). Datoteke so vrnjene v prvotno stanje.');
  process.exit(1);
}

console.log('  ✔ gradnja ne spremeni nobene datoteke');
console.log('\n✔ vse v redu (2)');
