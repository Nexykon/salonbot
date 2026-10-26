/*
  Preverba štirih oglasnih strani za Meta kampanjo.

      node tools/test-preizkus.js

  ZAKAJ OBSTAJA

    Te strani so plačane: vsak obisk nanje nekaj stane. Tiha napaka —
    izgubljen parameter utm_content, podvojena oznaka GA4, gumb brez
    pripravljenega sporočila — se ne pokaže nikjer, razen v poročilu, ki
    je nato neuporabno.

    Preverja se tudi, da strani niso v sitemap.xml in da nosijo noindex:
    štiri skoraj enake strani v iskalniku tekmujejo s cenikom.
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { SKUPNO, STRANI } = require('./preizkus-podatki.js');
const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');
const VRATA = 3097;

let ok = 0;
const napake = [];
const trdi = (opis, pogoj, dodatek) => {
  if (pogoj) { ok += 1; console.log('  ✓ ' + opis); }
  else { napake.push(opis + (dodatek ? ' — ' + dodatek : '')); console.log('  ✖ ' + opis + (dodatek ? ' — ' + dodatek : '')); }
};

const PREPOVEDANE = [
  ['43 %', /\b43\s*%/], ['71 %', /\b71\s*%/], ['28 %', /\b28\s*%/],
  ['30 %', /\b30\s*%/], ['1,4 s', /1[,.]4\s*s\b/], ['Botana', /Botana/i],
];

function zazeni() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(KOREN, 'server.js')], {
      cwd: KOREN, env: { ...process.env, PORT: String(VRATA) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let izpis = '';
    const cakaj = setTimeout(() => reject(new Error('strežnik se ni zagnal:\n' + izpis)), 30000);
    p.stdout.on('data', (d) => { izpis += d; if (izpis.includes('running on port')) { clearTimeout(cakaj); resolve(p); } });
    p.stderr.on('data', (d) => { izpis += d; });
    p.on('exit', (c) => { clearTimeout(cakaj); reject(new Error('strežnik je končal s kodo ' + c)); });
  });
}

(async () => {
  console.log('\n1. Vsebina strani');
  const sitemap = fs.readFileSync(path.join(PUB, 'sitemap.xml'), 'utf8');
  const nav = fs.readFileSync(path.join(PUB, 'flowtek-nav.js'), 'utf8');

  for (const s of STRANI) {
    const t = fs.readFileSync(path.join(PUB, s.slug + '.html'), 'utf8');
    console.log('\n   ' + s.slug);

    trdi('    naslov in opis', t.includes('<title>' + s.naslovStrani + '</title>') && t.includes(s.opis));
    trdi('    noindex, follow', t.includes('<meta name="robots" content="noindex, follow">'));
    trdi('    canonical nase', t.includes('<link rel="canonical" href="https://flowtek.si/' + s.slug + '.html">'));
    trdi('    ni v sitemap.xml', !sitemap.includes(s.slug));
    trdi('    ena oznaka GA4', (t.match(/G-ZXH2YX58RX/g) || []).length === 2,
      'pojavitev ' + (t.match(/G-ZXH2YX58RX/g) || []).length + ' (skripta + config = ena oznaka)');
    trdi('    naloži flowtek-nav.js', /src="\/flowtek-nav\.js/.test(t));
    trdi('    H1 in podnaslov', t.includes(s.h1) && t.includes(s.podnaslov));

    /* Gumba dva, oba na testno picerijo, oba s pripravljenim sporočilom. */
    const gumbi = [...t.matchAll(/<a class="btn btn--primary pz-gumb" href="([^"]+)"[^>]*data-wa-location="([^"]+)"/g)];
    trdi('    dva gumba', gumbi.length === 2, 'najdenih ' + gumbi.length);
    trdi('    mesti hero in bottom',
      gumbi.map((g) => g[2]).join(',') === s.slug + '-hero,' + s.slug + '-bottom',
      gumbi.map((g) => g[2]).join(','));
    for (const g of gumbi) {
      const url = g[1].replace(/&amp;/g, '&');
      trdi('    gumb vodi na testno picerijo', url.startsWith('https://wa.me/38669323814?text='));
      trdi('    sporočilo je pripravljeno',
        decodeURIComponent(url.split('?text=')[1]) === s.sporocilo,
        decodeURIComponent(url.split('?text=')[1] || ''));
    }

    trdi('    opomba pod gumbom', (t.match(new RegExp(SKUPNO.opombaPodGumbom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 2);

    /*
      Vrstni red v junaku je bistvo te spremembe: komu je stran namenjena,
      nato naslov, nato pojasnilo o testni piceriji — in šele potem gumb.
      Prej je pojasnilo stalo POD gumbom, torej za odločitvijo.
    */
    const junak = t.slice(t.indexOf('pz-junak'), t.indexOf('</section>', t.indexOf('pz-junak')));
    const mesto = (igla) => junak.indexOf(igla);
    trdi('    pove, komu je namenjena', junak.includes('<p class="pz-za">' + s.zaKoga + '</p>'));
    trdi('    nagovor stoji nad naslovom', mesto('pz-za') < mesto('<h1'), '');
    trdi('    pojasnilo o demonstraciji je v junaku', junak.includes('<p class="pz-demo">' + s.demo + '</p>'));
    trdi('    pojasnilo stoji NAD gumbom', mesto('pz-demo') > -1 && mesto('pz-demo') < mesto('pz-gumb'), '');
    trdi('    pod gumbom je ena sama opomba', (junak.match(/class="pz-opomba"/g) || []).length === 1,
      'najdenih ' + (junak.match(/class="pz-opomba"/g) || []).length);
    trdi('    trije koraki', SKUPNO.koraki.every((k) => t.includes(k)));
    trdi('    pet kljukic', s.kot.every((v) => t.includes('✅ ' + v)), '');
    trdi('    cene vseh treh paketov', SKUPNO.paketi.every((p) => t.includes(p.cena)));
    trdi('    vrstica pod cenami', t.includes(SKUPNO.podCenami));
    trdi('    povezava na cenik', t.includes('href="/cenik.html"') && t.includes(SKUPNO.primerjajPakete));
    trdi('    okvirni izračun ostane okviren', t.includes(SKUPNO.izracun) && t.includes(SKUPNO.izracunDrobno));
    trdi('    spodnji poziv', t.includes(SKUPNO.spodnjiNaslov));
    trdi('    glava in noga strani', t.includes('<header class="site-head">') && t.includes('<footer class="site-foot">'));
    trdi('    v meniju ni označena', !/aria-current/.test(t));

    /*
      Prepovedane številke se iščejo v vidnem besedilu, ne v naslovih.

      V pripravljenem sporočilu "ob 18.30?" se vprašaj zakodira v %3F, kar
      da niz "30%" — videti je kot odstotek, čeprav ni. Zato se vrednosti
      atributov href pred iskanjem odstranijo, pripravljeno sporočilo pa se
      preveri posebej, odkodirano.
    */
    const brezNaslovov = t.replace(/href="[^"]*"/g, 'href=""');
    for (const [ime, re] of PREPOVEDANE) trdi('    brez ' + ime, !re.test(brezNaslovov));
    for (const [ime, re] of PREPOVEDANE) trdi('    sporočilo brez ' + ime, !re.test(s.sporocilo));

    /* ── Obrazec za povratni klic ── */
    const obr = t.slice(t.indexOf('id="poklici"'), t.indexOf('</section>', t.indexOf('id="poklici"')));
    /* Ne "Kako deluje" kot niz — tako piše tudi povezava v glavi, ki stoji prej. */
    trdi('    obrazec stoji takoj za junakom',
      t.indexOf('id="poklici"') > t.indexOf('pz-junak')
      && t.indexOf('id="poklici"') < t.indexOf('<h2 class="h-4">' + SKUPNO.korakiNaslov + '</h2>'), '');
    trdi('    naslov obrazca', obr.includes(SKUPNO.obrazecNaslov));
    trdi('    polje za ime je obvezno', /id="pz-ime"[^>]*autocomplete="name"[^>]*required/.test(obr));
    trdi('    polje za telefon je obvezno', /id="pz-tel"[^>]*inputmode="tel"[^>]*required/.test(obr));
    trdi('    soglasje je obvezno', /id="pz-soglasje"[^>]*required/.test(obr));
    trdi('    povezava na zasebnost se odpre v novem zavihku', /href="\/varnost\.html" target="_blank" rel="noopener"/.test(obr));
    trdi('    sporočilo o napaki ima role=alert', /id="pz-napaka"[^>]*role="alert"/.test(obr));
    trdi('    potrdilo je skrito do oddaje', /id="pz-uspeh"[^>]*display:none/.test(obr));
    /* Gumb obrazca je tihi, da glavni poziv ostane eden — gumb na WhatsApp. */
    trdi('    gumb obrazca ni glavni poziv', /id="pz-poslji"/.test(obr) && /btn btn--ghost[^>]*type="submit"|class="btn btn--ghost" type="submit"/.test(obr));

    /* ── Skripta obrazca ── */
    trdi('    dogodka se sprožita šele po r.ok', t.indexOf('if (!r.ok)') < t.indexOf("gtag('event', 'generate_lead'"), '');
    trdi('    generate_lead nosi method in pot', /method: 'preizkus-obrazec', page_path: location\.pathname/.test(t));
    trdi('    Lead nosi ime strani', t.includes("'preizkus-obrazec-' + SLUG"));
    trdi('    ob napaki se gumb spet omogoči', /catch\(function \(e\) \{\s*gumb\.disabled = false;/.test(t));
    trdi('    parametri kampanje gredo zraven', t.includes("k.indexOf('utm_') === 0"));
    trdi('    strežnik dobi source', t.includes('source: SLUG'));

    /* ── En sam glavni poziv ── */
    trdi('    telo nosi razred strani', /<body class="pz-stran">/.test(t));
    trdi('    Prijava in Odpri račun sta skrita', t.includes('.pz-stran .head-actions { display: none; }'));
    trdi('    povezave v meniju ostanejo', t.includes('<nav class="head-nav">'));
  }

  console.log('\n2. Merjenje klika');
  trdi('  handler bere data-wa-location', nav.includes("getAttribute('data-wa-location')"));
  trdi('  pošlje link_location', nav.includes('link_location:'));
  trdi('  pošlje page_path', nav.includes('page_path:'));
  trdi('  obstoječi parametri ostajajo', nav.includes('kje: kje(a)') && nav.includes('stevilka: stevilka') && nav.includes('vrsta: vrsta'));
  trdi('  ena sama poslušalka za wa.me', (nav.match(/a\[href\*="wa\.me\/"\]/g) || []).length === 1);
  trdi('  opomba o meji merjenja ostane', nav.includes('izkazano zanimanje'));
  trdi('  številke lokalov se še naprej ne merijo', nav.includes("var NASE = { '38669323814'"));

  console.log('\n3. Naslovi in parametri UTM');
  const streznik = await zazeni();
  try {
    const utm = '?utm_source=ig&utm_medium=paid_social&utm_campaign=ft-meta-2026-10&utm_content=o1-test&utm_term=test';
    for (const s of STRANI) {
      for (const pot of ['/' + s.slug, '/' + s.slug + '.html']) {
        const r = await fetch('http://127.0.0.1:' + VRATA + pot + utm, { redirect: 'manual' });
        const koncni = r.status >= 300 && r.status < 400 ? r.headers.get('location') : pot + utm;
        trdi('  ' + pot.padEnd(28) + ' 200 in parametri ostanejo',
          r.status === 200 && koncni.includes('utm_content=o1-test') && koncni.includes('utm_campaign=ft-meta-2026-10'),
          'status ' + r.status + ', naslov ' + koncni);
      }
    }
  } finally {
    streznik.kill();
  }

  console.log('\n  ' + ok + ' trditev drži' + (napake.length ? ', ' + napake.length + ' pade' : '') + '\n');
  if (napake.length) { for (const n of napake) console.log('   ✖ ' + n); process.exit(1); }
})().catch((e) => { console.error('\nnapaka: ' + e.message); process.exit(1); });
