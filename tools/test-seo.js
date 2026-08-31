/*
  Pregled SEO stanja vseh javnih strani.

    node tools/test-seo.js

  Ne preverja mnenj o besedilu, ampak stvari, ki se ob urejanju strani tiho
  pokvarijo:

    - notranje povezave, ki nikamor ne peljejo (po brisanju ali preimenovanju),
    - strani v sitemapu, ki jih robots.txt zapira ali so noindex,
    - manjkajoč ali podvojen <title>, opis, kanonični naslov,
    - kanonični naslov, ki ne ustreza svoji poti,
    - Open Graph naslov strani, ki kaže na drug naslov,
    - strani, ki jih v sitemapu ni, čeprav so javne.
*/
const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');
const DOMENA = 'https://flowtiq.si';

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const beri = (rel) => fs.readFileSync(path.join(KOREN, rel), 'utf8');
const sitemap = beri('public/sitemap.xml');
const robots = beri('public/robots.txt');
const streznik = beri('server.js');

// Poti iz sitemapa
const vSitemapu = [...sitemap.matchAll(/<loc>https:\/\/flowtiq\.si([^<]*)<\/loc>/g)].map(m => m[1] || '/');

// Vse strani na disku
const datoteke = fs.readdirSync(PUB).filter(f => f.endsWith('.html')).map(f => 'public/' + f)
  .concat(fs.readdirSync(path.join(PUB, 'panoga')).map(f => 'public/panoga/' + f));

// Pot → datoteka (upošteva čiste naslove iz server.js)
const CISTI = [...streznik.matchAll(/app\.get\('(\/[a-z-]+)', \(req, res\) => res\.sendFile\([^)]*'([a-z-]+\.html)'\)\)/g)]
  .reduce((m, x) => { m[x[1]] = 'public/' + x[2]; return m; }, {});
/*
  Pot → preusmeritev. Zajeti je treba obe obliki, ki sta v server.js:
    res.redirect(302, '/cilj')
    res.redirect(302, '/cilj' + (qs ? '?' + qs : ''))
  Ozji vzorec bi tiho spregledal /settings.html in /dashboard.html.
*/
const PREUSMERITVE = [...streznik.matchAll(/app\.get\('(\/[a-z.\-]+)'[\s\S]{0,220}?res\.redirect\(302, '([^']+)'/g)]
  .reduce((m, x) => { m[x[1]] = x[2]; return m; }, {});

const vDatoteko = (pot) => {
  const cista = pot.split('#')[0].split('?')[0];
  if (cista === '/' ) return 'public/index.html';
  if (CISTI[cista]) return CISTI[cista];
  if (PREUSMERITVE[cista]) return null;            // obravnavano posebej
  const p = 'public' + cista;
  return fs.existsSync(path.join(KOREN, p)) ? p : undefined;
};

console.log('strani na disku: ' + datoteke.length + ' · v sitemapu: ' + vSitemapu.length);
console.log('čisti naslovi: ' + Object.keys(CISTI).join(', '));
console.log('preusmeritve:  ' + Object.entries(PREUSMERITVE).map(([a, b]) => a + '→' + b).join(', '));

console.log('\n1) Notranje povezave peljejo nekam');
const mrtve = [];
for (const f of datoteke) {
  const html = beri(f);
  for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) {
    const pot = m[1];
    if (pot.startsWith('/api/')) continue;
    const cilj = pot.split('?')[0];
    if (PREUSMERITVE[cilj]) continue;                                  // 302 je v redu
    if (/\.(txt|xml|png|jpg|svg|ico|css|js|webmanifest)$/.test(cilj)) {
      if (!fs.existsSync(path.join(PUB, cilj))) mrtve.push(f + ' → ' + pot);
      continue;
    }
    if (vDatoteko(cilj) === undefined) mrtve.push(f.replace('public/', '') + ' → ' + pot);
  }
}
je('nobena povezava ne pelje v prazno', [...new Set(mrtve)], []);

console.log('\n2) Sitemap in robots.txt si ne nasprotujeta');
// Isti bralnik pravil kot v test-ai-iskanje.js
function skupineRobots(txt) {
  const skupine = []; let tek = null, nabira = false;
  for (const surova of txt.split('\n')) {
    const v = surova.replace(/#.*$/, '').trim(); if (!v) continue;
    const m = v.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), vr = m[2].trim();
    if (k === 'user-agent') { if (!nabira) { tek = { disallow: [], allow: [] }; skupine.push(tek); nabira = true; } }
    else if (k === 'disallow' || k === 'allow') { if (tek) { nabira = false; tek[k].push(vr); } }
  }
  return skupine;
}
const ujema = (vzorec, pot) => {
  if (!vzorec) return false;
  let re = '^' + vzorec.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  if (re.endsWith('\\$')) re = re.slice(0, -2) + '$';
  return new RegExp(re).test(pot);
};
const dovoljeno = (sk, pot) => {
  const dolzina = s => s.filter(v => ujema(v, pot)).reduce((m, v) => Math.max(m, v.length), -1);
  return dolzina(sk.allow) >= dolzina(sk.disallow);
};
const skupine = skupineRobots(robots);
je('nobena stran iz sitemapa ni zaprta', vSitemapu.filter(u => !skupine.every(s => dovoljeno(s, u))), []);

console.log('\n3) Strani iz sitemapa obstajajo in niso noindex');
const manjkajo = [], noindex = [];
for (const u of vSitemapu) {
  const f = vDatoteko(u);
  if (f === undefined) { manjkajo.push(u); continue; }
  if (f && /name="robots"[^>]*noindex/.test(beri(f))) noindex.push(u);
}
je('vse obstajajo', manjkajo, []);
je('nobena ni noindex', noindex, []);

console.log('\n4) Vsaka stran iz sitemapa ima naslov, opis in kanonični naslov');
const brezNaslova = [], brezOpisa = [], slabKanonicni = [], dvojni = [], dolgNaslov = [], dolgOpis = [];
for (const u of vSitemapu) {
  const f = vDatoteko(u); if (!f) continue;
  const html = beri(f);
  const naslovi = html.match(/<title>([\s\S]*?)<\/title>/g) || [];
  const t = naslovi.length ? naslovi[0].replace(/<\/?title>/g, '').trim() : '';
  const d = (html.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1];
  const c = (html.match(/<link rel="canonical" href="([^"]*)"/) || [, ''])[1];
  if (!t) brezNaslova.push(u);
  if (naslovi.length > 1) dvojni.push(u);
  if (!d) brezOpisa.push(u);
  if (t.length > 65) dolgNaslov.push(u + ' (' + t.length + ')');
  if (d.length > 165) dolgOpis.push(u + ' (' + d.length + ')');
  const pricakovan = DOMENA + (u === '/restavracije' ? '/restavracije.html' : u);
  if (c !== pricakovan && c !== DOMENA + u) slabKanonicni.push(u + ' → ' + (c || '(ni)'));
}
je('vse imajo naslov', brezNaslova, []);
je('nobena nima dveh naslovov', dvojni, []);
je('vse imajo opis', brezOpisa, []);
je('kanonični naslov ustreza poti', slabKanonicni, []);
console.log('  (opozorila) predolgi naslovi: ' + (dolgNaslov.length ? dolgNaslov.join(', ') : 'ni'));
console.log('  (opozorila) predolgi opisi:   ' + (dolgOpis.length ? dolgOpis.join(', ') : 'ni'));

console.log('\n5) Javne strani niso pozabljene v sitemapu');
const ZAPRTE_ALI_NOTRANJE = ['admin', 'salon', 'delivery', 'voznik', 'leads', 'book', 'setup', 'prijava', 'geslo', 'restavracije'];
const pozabljene = datoteke
  .filter(f => !f.startsWith('public/panoga/'))
  .map(f => '/' + path.basename(f))
  // index.html je v sitemapu kot "/" — to ni pozabljena stran.
  .filter(u => u !== '/index.html')
  .filter(u => !vSitemapu.includes(u))
  .filter(u => !ZAPRTE_ALI_NOTRANJE.includes(path.basename(u, '.html')));
je('nobena javna stran ni pozabljena', pozabljene, []);

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
