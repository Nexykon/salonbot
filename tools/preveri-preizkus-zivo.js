/*
  Preverba štirih oglasnih strani na objavljeni strani.

      node tools/preveri-preizkus-zivo.js

  Odgovor 200 pove samo, da nekaj stoji na tistem naslovu. Te strani so
  plačane, zato se preveri tisto, kar stane, če je narobe: ohranjeni
  parametri UTM, oznaka GA4, noindex, pravo pripravljeno sporočilo v gumbu
  in to, da je na strežniku nova različica flowtek-nav.js z link_location.
*/
const fs = require('fs');
const path = require('path');
const { STRANI, SKUPNO } = require('./preizkus-podatki.js');

const DOMENA = 'https://flowtek.si';
const PUB = path.join(__dirname, '..', 'public');
const UTM = '?utm_source=ig&utm_medium=paid_social&utm_campaign=ft-meta-2026-10&utm_content=o1-test&utm_term=test';

let ok = 0;
const napake = [];
const trdi = (opis, pogoj, dodatek) => {
  if (pogoj) { ok += 1; console.log('  ✓ ' + opis); }
  else { napake.push(opis + (dodatek ? ' — ' + dodatek : '')); console.log('  ✖ ' + opis + (dodatek ? ' — ' + dodatek : '')); }
};

/* Cloudflare sam vrine zakrivanje e-naslova; to ni naša sprememba. */
const brezCf = (s) => s
  .replace(/<a href="\/cdn-cgi\/l\/email-protection[^"]*">[\s\S]*?<\/a>/g, '<a href="mailto:info@flowtek.si">info@flowtek.si</a>')
  .replace(/<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"]*"><\/script>/g, '')
  .replace(/\r/g, '');

(async () => {
  for (const s of STRANI) {
    console.log('\n  ' + s.slug);

    /* Čisti naslov z UTM: 200 in brez preusmeritve, ki bi parametre odnesla. */
    const r = await fetch(DOMENA + '/' + s.slug + UTM, { redirect: 'manual' });
    trdi('    čisti naslov z UTM vrne 200', r.status === 200, 'status ' + r.status
      + (r.headers.get('location') ? ', preusmeritev na ' + r.headers.get('location') : ''));

    const t = await (await fetch(DOMENA + '/' + s.slug + '.html')).text();
    const lokalno = fs.readFileSync(path.join(PUB, s.slug + '.html'), 'utf8');
    trdi('    stran je enaka datoteki v repozitoriju', brezCf(t) === brezCf(lokalno));

    trdi('    noindex, follow', t.includes('<meta name="robots" content="noindex, follow">'));
    trdi('    canonical nase', t.includes('<link rel="canonical" href="' + DOMENA + '/' + s.slug + '.html">'));
    trdi('    ena oznaka GA4', (t.match(/G-ZXH2YX58RX/g) || []).length === 2);
    trdi('    naslov strani', t.includes('<title>' + s.naslovStrani + '</title>'));

    const gumbi = [...t.matchAll(/href="(https:\/\/wa\.me\/38669323814\?text=[^"]+)"[^>]*data-wa-location="([^"]+)"/g)];
    trdi('    dva gumba na testno picerijo', gumbi.length === 2, 'najdenih ' + gumbi.length);
    for (const g of gumbi) {
      const sporocilo = decodeURIComponent(g[1].replace(/&amp;/g, '&').split('?text=')[1]);
      trdi('    sporočilo v gumbu (' + g[2] + ')', sporocilo === s.sporocilo, sporocilo);
    }
    trdi('    okvirni izračun ostane okviren', t.includes(SKUPNO.izracun) && t.includes(SKUPNO.izracunDrobno));

    /* Prepovedane številke — brez vrednosti href, ker se v "18.30?" skriva %3F. */
    const vidno = t.replace(/href="[^"]*"/g, 'href=""');
    for (const [ime, re] of [['43 %', /\b43\s*%/], ['71 %', /\b71\s*%/], ['28 %', /\b28\s*%/], ['30 %', /\b30\s*%/], ['1,4 s', /1[,.]4\s*s\b/], ['Botana', /Botana/i]]) {
      trdi('    brez ' + ime, !re.test(vidno));
    }
  }

  console.log('\n  Skupno');
  const vSitemapu = await (await fetch(DOMENA + '/sitemap.xml')).text();
  trdi('    nobene od štirih ni v sitemap.xml', !STRANI.some((s) => vSitemapu.includes(s.slug)));

  /* Skripta mora biti nova — sicer gumbi ne pošiljajo link_location. */
  const prva = await (await fetch(DOMENA + '/' + STRANI[0].slug + '.html')).text();
  const navPot = (prva.match(/src="(\/flowtek-nav\.js[^"]*)"/) || [, ''])[1];
  const nav = await (await fetch(DOMENA + navPot)).text();
  trdi('    flowtek-nav.js pošilja link_location', nav.includes('link_location:'), navPot);
  trdi('    flowtek-nav.js pošilja page_path', nav.includes('page_path:'));
  trdi('    bere data-wa-location', nav.includes("getAttribute('data-wa-location')"));
  trdi('    skripta je enaka datoteki', brezCf(nav) === brezCf(fs.readFileSync(path.join(PUB, 'flowtek-nav.js'), 'utf8')));

  console.log('\n  ' + ok + ' trditev drži' + (napake.length ? ', ' + napake.length + ' pade' : '') + '\n');
  if (napake.length) { for (const n of napake) console.log('   ✖ ' + n); process.exit(1); }
})();
