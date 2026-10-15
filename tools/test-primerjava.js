/*
  Preverba strani /primerjava.html.

      node tools/test-primerjava.js

  ZAKAJ OBSTAJA

    Stran je napisana zato, da jo berejo AI iskalniki in da jo lahko
    navajajo. Trditve o ponudnikih morajo zato ostati pripisane njim
    ("po navedbi ponudnika"), tabela mora biti pravi <table> in ne mreža
    iz divov, strukturirani podatki pa se morajo razčleniti.

    Prepovedane številke (43 %, 71 %, 28 %, 30 %, 1,4 s) so trditve brez
    vira; na tej strani ne smejo biti niti enkrat.
*/
const fs = require('fs');
const path = require('path');

const POT = path.join(__dirname, '..', 'public', 'primerjava.html');
const t = fs.readFileSync(POT, 'utf8');

let ok = 0;
const napake = [];
const trdi = (opis, pogoj, dodatek) => {
  if (pogoj) { ok += 1; console.log('  ✓ ' + opis); }
  else { napake.push(opis + (dodatek ? ' — ' + dodatek : '')); console.log('  ✖ ' + opis + (dodatek ? ' — ' + dodatek : '')); }
};

console.log('\n1. Glava');
trdi('naslov', t.includes('<title>FlowTek, WhatsPortal ali dostavna platforma — primerjava za lokale | FlowTek</title>'));
trdi('opis', /<meta name="description" content="Kako se razlikujejo FlowTek, WhatsPortal/.test(t));
trdi('canonical', t.includes('<link rel="canonical" href="https://flowtek.si/primerjava.html">'));
trdi('og:url', t.includes('<meta property="og:url" content="https://flowtek.si/primerjava.html">'));
trdi('og:title in og:description', t.includes('og:title') && t.includes('og:description'));
trdi('jezik strani je slovenščina', t.includes('<html lang="sl">'));
trdi('GA4 oznaka G-ZXH2YX58RX', (t.match(/G-ZXH2YX58RX/g) || []).length === 2);

console.log('\n2. Strukturirani podatki');
const bloki = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
  try { return JSON.parse(m[1]); } catch (e) { return { napaka: e.message }; }
});
trdi('trije bloki JSON-LD', bloki.length === 3, 'najdenih ' + bloki.length);
trdi('vsi se razčlenijo', bloki.every((b) => !b.napaka), bloki.map((b) => b.napaka).filter(Boolean).join('; '));
const faq = bloki.find((b) => b['@type'] === 'FAQPage');
const krusek = bloki.find((b) => b['@type'] === 'BreadcrumbList');
const stran = bloki.find((b) => b['@type'] === 'WebPage');
trdi('FAQPage s petimi vprašanji', faq && faq.mainEntity.length === 5, faq ? String(faq.mainEntity.length) : 'ni bloka');
trdi('FAQPage je v slovenščini', faq && faq.inLanguage === 'sl-SI');
trdi('vsako vprašanje ima odgovor', faq && faq.mainEntity.every((q) => q.acceptedAnswer && q.acceptedAnswer.text.length > 40));
trdi('BreadcrumbList Domov > Primerjava',
  krusek && krusek.itemListElement.map((i) => i.name).join(' > ') === 'Domov > Primerjava',
  krusek ? krusek.itemListElement.map((i) => i.name).join(' > ') : 'ni bloka');
trdi('WebPage inLanguage sl-SI', stran && stran.inLanguage === 'sl-SI');
trdi('WebPage dateModified 2026-10-15', stran && stran.dateModified === '2026-10-15', stran && stran.dateModified);

/*
  Besedilo v JSON-LD se mora ujemati z vidnim besedilom. Če se razideta,
  Google to šteje za zavajajoče označevanje in strukturirane podatke
  preneha upoštevati.
*/
console.log('\n3. Vidna vprašanja se ujemajo z JSON-LD');
const vidnaV = [...t.matchAll(/<summary><span>([^<]+)<\/span>/g)].map((m) => m[1]);
const vidnoO = [...t.matchAll(/<div class="faq-body measure-76">([\s\S]*?)<\/div>/g)].map((m) => m[1].trim());
trdi('pet vidnih vprašanj', vidnaV.length === 5, String(vidnaV.length));
if (faq) {
  for (const [i, q] of faq.mainEntity.entries()) {
    trdi('vprašanje ' + (i + 1) + ' enako', vidnaV[i] === q.name, vidnaV[i]);
    const razlika = vidnoO[i] !== q.acceptedAnswer.text;
    trdi('odgovor ' + (i + 1) + ' enak', !razlika, razlika ? 'vidno: ' + String(vidnoO[i]).slice(0, 60) : '');
  }
}

console.log('\n4. Tabela');
trdi('je pravi <table>', /<table>/.test(t) && /<thead>/.test(t) && /<tbody>/.test(t));
trdi('sedem vrstic', (t.match(/<th scope="row">/g) || []).length === 7, String((t.match(/<th scope="row">/g) || []).length));
trdi('štirje stolpci v glavi', (t.match(/<th scope="col"/g) || []).length === 4);
trdi('ima caption za bralnike', t.includes('<caption'));
trdi('se na ozkem zaslonu premika vstran', t.includes('overflow-x:auto'));
trdi('datum preverjanja', t.includes('Podatki preverjeni: 15. 10. 2026'));
trdi('povezava na whatsportal.io', t.includes('href="https://whatsportal.io"'));
trdi('povezava na merchant.wolt.com', t.includes('href="https://merchant.wolt.com/sl/svn"'));

console.log('\n5. Trditve o ponudnikih ostanejo pripisane njim');
/*
  Vsaka trditev o WhatsPortalu mora nositi pripis. Brez njega bi jo
  bralec (in AI iskalnik) prebral kot naše preverjeno dejstvo.
*/
const pripisi = ['po navedbi ponudnika', 'Po navedbi ponudnika', 'po ceniku ponudnika', 'Po ceniku ponudnika', 'po lastni predstavitvi', 'Po lastni predstavitvi', 'ponudnik navaja', 'ponudnik ne navaja', 'se predstavlja kot'];
const najdeniPripisi = pripisi.filter((p) => t.includes(p));
trdi('pripisi so uporabljeni', najdeniPripisi.length >= 5, 'najdenih ' + najdeniPripisi.length);
trdi('stopnje Wolt ne navajamo', t.includes('Stopnje Wolt javno ne objavlja'));

console.log('\n6. Prepovedane številke');
const P = '(?:\\s|&nbsp;|\\u00a0|\\u202f)*';
for (const [ime, re] of [
  ['43 %', new RegExp('\\b43' + P + '%')],
  ['71 %', new RegExp('\\b71' + P + '%')],
  ['28 %', new RegExp('\\b28' + P + '%')],
  ['30 %', new RegExp('\\b30' + P + '%')],
  ['1,4 s', new RegExp('1[,.]4' + P + 's\\b')],
]) trdi(ime + ' ni na strani', !re.test(t));

console.log('\n7. Povezave naprej');
trdi('gumb na testno picerijo', t.includes('https://wa.me/38669323814'));
trdi('povezava na cenik', t.includes('href="/cenik.html"'));
trdi('cenik kaže sem', fs.readFileSync(path.join(__dirname, '..', 'public', 'cenik.html'), 'utf8').includes('href="/primerjava.html"'));
trdi('v sitemap.xml', fs.readFileSync(path.join(__dirname, '..', 'public', 'sitemap.xml'), 'utf8').includes('https://flowtek.si/primerjava.html'));
trdi('v llms.txt', fs.readFileSync(path.join(__dirname, '..', 'public', 'llms.txt'), 'utf8').includes('https://flowtek.si/primerjava.html'));

console.log('\n  ' + ok + ' trditev drži' + (napake.length ? ', ' + napake.length + ' pade' : '') + '\n');
if (napake.length) { for (const n of napake) console.log('   ✖ ' + n); process.exit(1); }
