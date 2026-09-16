/*
  Preizkus: skupne datoteke imajo v naslovu SVEŽO različico.

    node tools/test-verzija.js

  ZAKAJ OBSTAJA

    flowtek-nav.js in flowtek-site.css se strežeta s Cache-Control
    max-age=14400. Brez različice v naslovu obiskovalec, ki je stran videl
    pred objavo, do štiri ure dobiva svež HTML s staro datoteko.

    To se je zgodilo trikrat: gumbi brez sloga, stara telefonska številka in
    nazadnje — Meta pixel se sploh ni naložil, torej štiri ure neizmerjenega
    oglasnega prometa po vsaki objavi.

    Past, ki jo ta preizkus lovi, ni "ni oznake", ampak "oznaka je STARA":
    kdor spremeni datoteko in pozabi pognati oznaci-verzijo.js, dobi natanko
    isto napako, le da je še težje opazna.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');
const DATOTEKE = [
  'flowtek-nav.js', 'flowtek-site.css', 'flowtek-pravno.css', 'flowtek-theme.css',
  'urnik-vmesnik.js', 'dostava-vmesnik.js', 'pomoc.js'
];

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const verzija = (ime) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(PUB, ime))).digest('hex').slice(0, 8);

const tarce = [
  ...fs.readdirSync(PUB).filter((f) => f.endsWith('.html')).map((f) => ({ ime: f, pot: path.join(PUB, f) })),
  ...fs.readdirSync(path.join(PUB, 'panoga')).filter((f) => f.endsWith('.html'))
    .map((f) => ({ ime: 'panoga/' + f, pot: path.join(PUB, 'panoga', f) })),
  { ime: 'tools/gradi-panoge.js', pot: path.join(KOREN, 'tools', 'gradi-panoge.js') },
];

console.log('\n1) Vsak sklic nosi različico, in to svežo');
for (const d of DATOTEKE) {
  const v = verzija(d);
  const brezOznake = [];
  const staraOznaka = [];

  for (const t of tarce) {
    const s = fs.readFileSync(t.pot, 'utf8');
    const re = new RegExp('(?:src|href)="\\/' + d.replace('.', '\\.') + '(\\?v=([a-f0-9]+))?"', 'g');
    for (const m of s.matchAll(re)) {
      if (!m[1]) brezOznake.push(t.ime);
      else if (m[2] !== v) staraOznaka.push(t.ime + ' (' + m[2] + ' namesto ' + v + ')');
    }
  }
  je(d + ': nobenega sklica brez različice', [...new Set(brezOznake)], []);
  je(d + ': nobene stare različice', [...new Set(staraOznaka)], []);
}

console.log('\n2) Predloga generatorja je zajeta');
/*
  Brez tega bi naslednja gradnja panožnih strani oznake povozila — ista past,
  ki je v tem projektu že dvakrat pojedla popravke v nogi.
*/
const predloga = fs.readFileSync(path.join(KOREN, 'tools', 'gradi-panoge.js'), 'utf8');
je('predloga ima različico za nav.js', new RegExp('flowtek-nav\\.js\\?v=' + verzija('flowtek-nav.js')).test(predloga), true);
je('predloga ima različico za site.css', new RegExp('flowtek-site\\.css\\?v=' + verzija('flowtek-site.css')).test(predloga), true);

console.log('\n3) Pixel je za predpomnilnikom dosegljiv');
// Če se nav.js ne naloži, ni ne merjenja klikov ne pixla — zato je prav ta
// datoteka najbolj občutljiva na zastarelo različico.
const nav = fs.readFileSync(path.join(PUB, 'flowtek-nav.js'), 'utf8');
je('nav.js res nosi pixel', /fbevents\.js/.test(nav), true);
je('nav.js res nosi merjenje klikov', /wa_click/.test(nav), true);

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
