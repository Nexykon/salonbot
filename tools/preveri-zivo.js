/*
  Primerja objavljene strani s tem, kar je v repozitoriju, in na objavljenem
  HTML-u znova poišče prepovedane številke.

      node tools/preveri-zivo.js

  ZAKAJ NE ZADOŠČA ODGOVOR 200

    Odgovor 200 pove samo, da nekaj stoji na tistem naslovu — lahko tudi
    prejšnja različica. Pred Cloudflarom je privzeti predpomnilnik brskalnika
    nastavljen na štiri ure, zato se da objavo opaziti šele, ko stran res
    primerjaš z datoteko.

  ENA PRIČAKOVANA RAZLIKA

    Cloudflare v HTML sam vstavi zakrivanje e-naslova (__cf_email__ in
    email-decode.min.js). To ni naša sprememba, zato se pred primerjavo
    odstrani.
*/
const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..', 'public');
const STRANI = ['/', '/primerjava.html', '/cenik.html', '/funkcije.html', '/zgodbe.html',
  '/panoga/frizerski-saloni.html', '/panoga/kozmetika.html', '/panoga/zobozdravniki.html',
  '/sitemap.xml', '/llms.txt'];

const brezCf = (s) => s
  .replace(/<a href="\/cdn-cgi\/l\/email-protection[^"]*">[\s\S]*?<\/a>/g, '<a href="mailto:info@flowtek.si">info@flowtek.si</a>')
  .replace(/<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"]*"><\/script>/g, '')
  .replace(/\r/g, '');

const P = '(?:\\s|&nbsp;|&#160;|\\u00a0|\\u202f)*';
const PREPOVEDANE = [
  ['43 %', new RegExp('\\b43' + P + '%')],
  ['71 %', new RegExp('\\b71' + P + '%')],
  ['28 %', new RegExp('\\b28' + P + '%')],
  ['30 %', new RegExp('\\b30' + P + '%')],
  ['1,4 s', new RegExp('1[,.]4' + P + 's\\b')],
];

(async () => {
  let enakih = 0;
  const razlike = [];
  const stevilke = [];

  console.log('');
  for (const pot of STRANI) {
    const r = await fetch('https://flowtek.si' + pot, { headers: { 'cache-control': 'no-cache' } });
    const zivo = await r.text();
    const lokalno = fs.readFileSync(path.join(KOREN, pot === '/' ? 'index.html' : pot.slice(1)), 'utf8');
    const enako = brezCf(zivo) === brezCf(lokalno);
    if (enako) enakih += 1; else razlike.push(pot);
    console.log('  ' + String(r.status) + '  ' + pot.padEnd(36) + (enako ? 'enako datoteki' : 'RAZLIKA'));

    for (const [ime, re] of PREPOVEDANE) if (re.test(zivo)) stevilke.push(pot + ' → ' + ime);
  }

  console.log('\n  enakih: ' + enakih + ' / ' + STRANI.length);
  if (razlike.length) console.log('  razlike: ' + razlike.join(', '));

  console.log('\n  prepovedane številke na objavljenih straneh: ' + (stevilke.length ? '' : 'nobene'));
  for (const s of stevilke) console.log('    ' + s);

  /* Strukturirani podatki, kot jih vidi pajek — ne kot jih vidimo mi v datoteki. */
  const p = await (await fetch('https://flowtek.si/primerjava.html')).text();
  const bloki = [...p.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  console.log('\n  JSON-LD na objavljeni primerjavi: ' + bloki.length + ' blokov');
  for (const b of bloki) {
    try {
      const o = JSON.parse(b[1]);
      console.log('    ✓ ' + o['@type'] + (o.mainEntity ? ' (' + o.mainEntity.length + ' vprašanj)' : ''));
    } catch (e) { console.log('    ✖ se ne razčleni: ' + e.message); }
  }

  const c = await (await fetch('https://flowtek.si/cenik.html')).text();
  const faq = [...c.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch (e) { return null; } })
    .find((o) => o && o['@type'] === 'FAQPage');
  console.log('\n  cenik FAQPage: ' + (faq ? faq.mainEntity.length + ' vprašanj, se razčleni' : 'NE razčleni se'));
  const letni = faq && faq.mainEntity.find((q) => /letno/i.test(q.name));
  if (letni) console.log('    odgovor o letnem plačilu se začne: "' + letni.acceptedAnswer.text.slice(0, 40) + '…"');

  console.log('');
  process.exitCode = (razlike.length || stevilke.length) ? 1 : 0;
})();
