/*
  Poišče prepovedane številke v vsem, kar gre na strežnik.

      node tools/najdi-stevilke.js

  ZAKAJ OBSTAJA

    43 %, 71 %, 28 %, 30 % in 1,4 s so trditve, za katere nimamo vira, ki
    bi ga lahko pokazali: dostavne platforme stopenj provizije ne objavljajo,
    hitrosti odgovora in zmanjšanja praznih terminov pa nismo merili.
    Nepodprta številka na strani je slabša od nobene — ob prvem vprašanju
    "od kod to?" pade vse drugo z njo vred.

    Iskanje je namenoma široko: ujame tudi &nbsp; in ozki presledek, ki ju
    urejevalnik vstavi sam in ju z navadnim iskanjem ne najdeš.

  KAJ NI NAPAKA

    Zneski v evrih, ki so resnični (747,60 €, 89 €), in primeri v
    demonstracijskem pogovoru (avans 30 % pri hotelih) niso trditve o
    učinku. Izpišejo se posebej, da se vidi, da so bili pregledani.

    Vrednosti atributa href se pred iskanjem izpraznijo. V pripravljenem
    sporočilu za WhatsApp "ob 18.30?" se vprašaj zakodira v %3F, kar da niz
    "30%" — videti je kot odstotek, čeprav je vprašaj. Brez tega bi vsak
    pregled javljal napako, ki je ni, in se ga človek čez tri tedne neha
    jemati resno.
*/
const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..', 'public');

/* Presledek je lahko navaden, trdi ( ), ozki ( ) ali &nbsp;. */
const P = '(?:\\s|&nbsp;|&#160;|\\u00a0|\\u202f)*';
const VZORCI = [
  ['43 %', new RegExp('\\b43' + P + '%', 'g')],
  ['71 %', new RegExp('\\b71' + P + '%', 'g')],
  ['28 %', new RegExp('\\b28' + P + '%', 'g')],
  ['30 %', new RegExp('(?:−|-|–)?' + '\\b30' + P + '%', 'g')],
  ['−30', new RegExp('(?:−|–|-)' + P + '30\\b', 'g')],
  ['1,4 s', new RegExp('1[,.]4' + P + 's\\b', 'g')],
];

const KONCNICE = ['.html', '.js', '.css', '.txt', '.xml', '.json'];
/* Plošče izdelka ne urejamo — a če je kaj tam, je treba vedeti. */
const IZDELEK = ['salon.html', 'delivery.html', 'admin.html', 'leads.html', 'setup.html', 'geslo.html'];

function datoteke(dir) {
  const ven = [];
  for (const v of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, v.name);
    if (v.isDirectory()) ven.push(...datoteke(p));
    else if (KONCNICE.includes(path.extname(v.name))) ven.push(p);
  }
  return ven;
}

const zadetki = [];
for (const f of datoteke(KOREN)) {
  const vrstice = fs.readFileSync(f, 'utf8').split(/\r?\n/)
    // Vrednost se nadomesti z enako dolgim nizom, da se stolpci ne premaknejo.
    .map((v) => v.replace(/href="([^"]*)"/g, (m, u) => 'href="' + ' '.repeat(u.length) + '"'));
  vrstice.forEach((vrstica, i) => {
    for (const [ime, re] of VZORCI) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(vrstica)) !== null) {
        zadetki.push({
          datoteka: path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/'),
          vrstica: i + 1,
          vzorec: ime,
          najdeno: m[0],
          kontekst: vrstica.trim().slice(Math.max(0, m.index - 60), m.index + 90).slice(0, 150),
          izdelek: IZDELEK.includes(path.basename(f)),
        });
      }
    }
  });
}

const strani = zadetki.filter((z) => !z.izdelek);
const plosce = zadetki.filter((z) => z.izdelek);

console.log('\n  JAVNE STRANI (' + strani.length + ')\n');
console.log('  ' + 'datoteka'.padEnd(34) + 'vrst.'.padStart(6) + '  ' + 'najdeno'.padEnd(10) + 'kontekst');
console.log('  ' + '-'.repeat(110));
for (const z of strani) {
  console.log('  ' + z.datoteka.padEnd(34) + String(z.vrstica).padStart(6) + '  '
    + z.najdeno.replace(/\s/g, ' ').padEnd(10) + z.kontekst.replace(/\s+/g, ' ').slice(0, 68));
}

if (plosce.length) {
  console.log('\n  PLOŠČE IZDELKA — se jih ne ureja (' + plosce.length + ')\n');
  for (const z of plosce) {
    console.log('  ' + z.datoteka.padEnd(34) + String(z.vrstica).padStart(6) + '  ' + z.najdeno);
  }
}

console.log('\n  skupaj: ' + zadetki.length + ' (javne strani: ' + strani.length + ')\n');
process.exitCode = strani.length ? 1 : 0;
