/*
  Katere strani nimajo merilne oznake GA4.

      node tools/najdi-ga4.js

  ZAKAJ OBSTAJA

    Oznaka je na vsaki strani zapisana posebej — skupne glave ni. Nova
    stran jo zato dobi samo, če se nanjo spomniš, in manjkajoča oznaka se
    ne pozna nikjer: stran deluje, v GA4 je preprosto ni.

    Ločeno od strani, ki so v sitemap.xml, se izpišejo plošče izdelka in
    strani z noindex — tam oznake namenoma ni ali pa o njej odloča kaj
    drugega.
*/
const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..', 'public');
const OZNAKA = 'G-ZXH2YX58RX';
const IZDELEK = ['salon.html', 'delivery.html', 'admin.html', 'leads.html', 'setup.html', 'geslo.html', 'prijava.html'];

function datoteke(dir) {
  const ven = [];
  for (const v of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, v.name);
    if (v.isDirectory()) ven.push(...datoteke(p));
    else if (path.extname(v.name) === '.html') ven.push(p);
  }
  return ven;
}

const sitemap = fs.existsSync(path.join(KOREN, 'sitemap.xml'))
  ? fs.readFileSync(path.join(KOREN, 'sitemap.xml'), 'utf8')
  : '';

const vrste = { manjka: [], dvojna: [], ima: [], izdelek: [], noindex: [] };

for (const f of datoteke(KOREN)) {
  const rel = path.relative(KOREN, f).replace(/\\/g, '/');
  const t = fs.readFileSync(f, 'utf8');
  const n = (t.match(new RegExp(OZNAKA, 'g')) || []).length;
  const vSitemap = sitemap.includes('/' + rel) || (rel === 'index.html' && sitemap.includes('<loc>https://flowtek.si/</loc>'));
  const noindex = /<meta[^>]+name="robots"[^>]+noindex/i.test(t);

  const zapis = { rel, n, vSitemap, noindex };
  if (IZDELEK.includes(path.basename(f))) vrste.izdelek.push(zapis);
  else if (n === 0 && noindex) vrste.noindex.push(zapis);
  else if (n === 0) vrste.manjka.push(zapis);
  else if (n > 2) vrste.dvojna.push(zapis);
  else vrste.ima.push(zapis);
}

const izpisi = (naslov, seznam, podrobno) => {
  console.log('\n  ' + naslov + ' (' + seznam.length + ')');
  for (const z of seznam) {
    console.log('    ' + z.rel.padEnd(36) + (podrobno ? 'pojavitev: ' + z.n + (z.vSitemap ? ' · v sitemap.xml' : '') : ''));
  }
  if (!seznam.length) console.log('    —');
};

console.log('\n  Oznaka ' + OZNAKA + '; pričakovani sta dve pojavitvi na stran (skripta + config).');
izpisi('MANJKA', vrste.manjka, true);
izpisi('VEČ KOT DVAKRAT — morda podvojeno', vrste.dvojna, true);
console.log('\n  ima oznako: ' + vrste.ima.length
  + ' · plošče izdelka (izvzete): ' + vrste.izdelek.length
  + ' · noindex brez oznake: ' + vrste.noindex.length);
for (const z of vrste.noindex) console.log('    noindex: ' + z.rel);
console.log('');

process.exitCode = (vrste.manjka.length || vrste.dvojna.length) ? 1 : 0;
