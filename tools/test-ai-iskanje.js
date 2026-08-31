/*
  Preizkus vsega, kar berejo AI iskalniki: llms.txt, robots.txt, strukturirani
  podatki in povezava v nogi.

    node tools/test-ai-iskanje.js

  Namen ni "ali datoteka obstaja", ampak ali se ne razhaja s stranmi: vsaka
  javna stran mora biti v llms.txt in v sitemapu, vsaka nadzorna plošča pa
  zaprta za vse pajke — tudi za tiste, ki jih naštejemo po imenu, ker taki
  pravila iz "*" prezrejo.
*/
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const beri = f => fs.readFileSync(path.join(PUB, f), 'utf8');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const llms = beri('llms.txt');
const robots = beri('robots.txt');
const sitemap = beri('sitemap.xml');

console.log('\n1) llms.txt — oblika po llmstxt.org');
je('začne se z imenom', llms.startsWith('# FlowTiq\n'), true);
je('takoj za imenom je povzetek z ">"', /^# FlowTiq\n\n> .{80,}/.test(llms), true);
je('ima razdelke z "##"', (llms.match(/^## /gm) || []).length >= 4, true);
je('povezave so v obliki "- [ime](naslov): opis"', (llms.match(/^- \[[^\]]+\]\(https:\/\/flowtiq\.si\/[^)]*\): .+$/gm) || []).length >= 20, true);
je('vse povezave so absolutne', /\]\((?!https:\/\/flowtiq\.si)/.test(llms), false);
je('nikjer ni nezamenjanih oznak', /\{\w+\}|undefined|null/.test(llms), false);
je('ni HTML entitet', /&(amp|quot|nbsp|#39);/.test(llms), false);
je('ni šumnikov v pokvarjeni obliki', /Ã|Å|Ä/.test(llms), false);

console.log('\n2) llms.txt vsebuje dejstva, po katerih AI sprašuje');
for (const [opis, vzorec] of [
  ['cena vseh treh paketov', /89 €.*159,99 €.*299 €/s],
  ['mesečna narava cene', /na mesec/],
  ['brez provizije', /brez provizije/],
  ['brez vezave', /ni vezave|brez vezave/],
  ['obsegi naročil', /500.*1\.500.*10\.000/s],
  ['e-pošta', /info@flowtiq\.si/],
  ['telefon', /\+386 40 599 185/],
  ['podjetje', /Webacus/],
  ['davčna številka', /35880643/],
  ['država', /Slovenij/]
]) je(opis, vzorec.test(llms), true);

console.log('\n3) llms.txt in sitemap si ne nasprotujeta');
const vSitemapu = [...sitemap.matchAll(/<loc>https:\/\/flowtiq\.si([^<]*)<\/loc>/g)].map(m => m[1] || '/');
const vLlms = [...llms.matchAll(/\]\(https:\/\/flowtiq\.si([^)]*)\)/g)].map(m => m[1] || '/');
const manjkaVLlms = vSitemapu.filter(u => !vLlms.includes(u));
const odvecVLlms = vLlms.filter(u => !vSitemapu.includes(u));
je('vsaka stran iz sitemapa je v llms.txt', manjkaVLlms, []);
je('llms.txt ne kaže na strani, ki jih v sitemapu ni', odvecVLlms, []);

console.log('\n4) llms.txt ne razkriva zaprtih strani');
const ZAPRTE = ['/admin.html', '/salon.html', '/delivery.html', '/leads.html', '/book.html', '/setup.html', '/prijava.html', '/geslo.html'];
for (const z of ZAPRTE) je('ni povezave na ' + z, vLlms.includes(z), false);

console.log('\n5) robots.txt');
je('kaže na sitemap', /^Sitemap: https:\/\/flowtiq\.si\/sitemap\.xml$/m.test(robots), true);
je('omenja llms.txt', /llms\.txt/.test(robots), true);
/*
  Robots.txt beremo tako, kot ga bere pajek: skupina je ZAPOREDJE vrstic
  User-agent (lahko jih je več) in pravila, ki jim sledijo. Preprosto rezanje
  po vsaki vrstici "User-agent:" bi 18 naštetih pajkov razsekalo v 18 skupin
  brez pravil — in preizkus bi lagal, da so zapore na mestu.
*/
function skupineRobots(txt) {
  const skupine = [];
  let tek = null, seNabirajoAgenti = false;
  for (const surova of txt.split('\n')) {
    const v = surova.replace(/#.*$/, '').trim();
    if (!v) continue;
    const m = v.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const kljuc = m[1].toLowerCase(), vred = m[2].trim();
    if (kljuc === 'user-agent') {
      if (!seNabirajoAgenti) { tek = { agenti: [], disallow: [], allow: [] }; skupine.push(tek); seNabirajoAgenti = true; }
      tek.agenti.push(vred);
    } else if (kljuc === 'disallow' || kljuc === 'allow') {
      if (!tek) continue;
      seNabirajoAgenti = false;
      tek[kljuc].push(vred);
    }
  }
  return skupine;
}
const skupine = skupineRobots(robots);
je('ima dve skupini (vsi + AI)', skupine.length, 2);
je('prva velja za vse', skupine[0] && skupine[0].agenti, ['*']);
je('druga našteva več pajkov', skupine[1] && skupine[1].agenti.length >= 15, true);
const AI_PAJKI = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'meta-externalagent'];
for (const p of AI_PAJKI) je('našteva ' + p, new RegExp('^User-agent: ' + p + '$', 'm').test(robots), true);

console.log('\n6) Vsak pajek z imenom ima iste zapore kot "*"');
// Pajek, ki najde svojo skupino, pravila iz "*" prezre — zato jih mora imeti.
const zaVse = (skupine[0] || { disallow: [] }).disallow;
const zaAi = (skupine[1] || { disallow: [] }).disallow;
je('AI skupina nima manj zapor', zaVse.filter(d => !zaAi.includes(d)), []);
je('javna vsebina je dovoljena', (skupine[1] || { allow: [] }).allow.includes('/'), true);
je('nadzorne plošče so zaprte', ['/admin.html', '/salon.html', '/api/'].every(d => zaAi.includes(d)), true);
je('naslovi z žetoni so zaprti', zaAi.includes('/*?token='), true);
/*
  Pravila preberemo tako, kot jih uporabi pajek: vzorec pozna "*" (poljubno
  zaporedje) in "$" (konec naslova), odloči pa NAJDALJŠE ujemanje — zato
  "Allow: /" ne odpre "/admin.html", "Disallow: /*?token=" pa ne zapre
  "/cenik.html".
*/
const ujemaVzorec = (vzorec, pot) => {
  if (!vzorec) return false;                        // prazen Disallow ne prepove ničesar
  let re = '^' + vzorec.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  if (re.endsWith('\\$')) re = re.slice(0, -2) + '$';
  return new RegExp(re).test(pot);
};
const dovoljeno = (skupina, pot) => {
  const najdaljse = seznam => seznam.filter(v => ujemaVzorec(v, pot)).reduce((m, v) => Math.max(m, v.length), -1);
  return najdaljse(skupina.allow) >= najdaljse(skupina.disallow);
};
console.log('  javno mora ostati odprto:');
for (const pot of ['/', '/llms.txt', '/sitemap.xml', '/cenik.html', '/panoga/restavracije.html', '/imenik.html']) {
  je(pot, skupine.every(s => dovoljeno(s, pot)), true);
}
console.log('  zaprto mora ostati zaprto:');
for (const pot of ['/admin.html', '/salon.html', '/delivery.html', '/leads.html', '/prijava.html', '/api/salons', '/cenik.html?token=abc']) {
  je(pot, skupine.some(s => dovoljeno(s, pot)), false);
}

console.log('\n7) Strukturirani podatki na prvi strani');
const index = beri('index.html');
const bloki = [...index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
je('en blok JSON-LD', bloki.length, 1);
let graf = null;
try { graf = JSON.parse(bloki[0])['@graph']; ok++; console.log('  ✔ JSON je veljaven'); }
catch (e) { ni++; console.log('  ✖ JSON ni veljaven: ' + e.message); }
if (graf) {
  const najdi = t => graf.find(x => x['@type'] === t);
  const org = najdi('Organization'), app = najdi('SoftwareApplication');
  je('Organization ima naslov', !!(org && org.address && org.address.streetAddress), true);
  je('Organization ima davčno', org && org.taxID, '35880643');
  je('SoftwareApplication ima opis', !!(app && app.description && app.description.length > 60), true);
  je('… seznam zmožnosti', !!(app && Array.isArray(app.featureList) && app.featureList.length >= 8), true);
  je('… komu je namenjen', !!(app && app.audience), true);
  je('trije paketi', app && app.offers.length, 3);
  for (const o of (app ? app.offers : [])) {
    const ps = o.priceSpecification || {};
    je('cena "' + o.name + '" je mesečna', ps.unitCode === 'MON' && ps.billingDuration === 1, true);
    je('… enak znesek v obeh zapisih', String(ps.price), String(o.price));
  }
  const cene = (app ? app.offers : []).map(o => o.price).join(' ');
  je('zneski se ujemajo z llms.txt', /89/.test(cene) && /159.99/.test(cene) && /299/.test(cene), true);
}

console.log('\n8) Povezava v nogi');
const straniZNogo = fs.readdirSync(PUB).filter(f => f.endsWith('.html'))
  .concat(fs.readdirSync(path.join(PUB, 'panoga')).map(f => 'panoga/' + f))
  .filter(f => /Piškotki<\/a>/.test(beri(f)));
// Števila strani ne zapisujemo v preizkus — nova stran ne sme podreti testa.
// Trditev je: KJER JE NOGA, sta obe povezavi.
je('nogo ima vsaj 25 strani', straniZNogo.length >= 25, true);
je('vse imajo povezavo na llms.txt', straniZNogo.filter(f => !/href="\/llms\.txt"/.test(beri(f))), []);
je('vse imajo povezavo na razvoj po meri', straniZNogo.filter(f => !/href="\/ai-resitve\.html"/.test(beri(f))), []);

console.log('\n9) Stran za razvoj po meri');
const ai = beri('ai-resitve.html');
je('je v sitemapu', /<loc>https:\/\/flowtiq\.si\/ai-resitve\.html<\/loc>/.test(sitemap), true);
je('je v llms.txt', /\/ai-resitve\.html/.test(llms), true);
je('llms.txt jo opiše v razdelku "Razvoj po meri"', /## Razvoj po meri/.test(llms), true);
je('ima kanonični naslov', /<link rel="canonical" href="https:\/\/flowtiq\.si\/ai-resitve\.html">/.test(ai), true);
je('ima opis pod 200 znaki', (ai.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1].length < 200, true);
je('naslov omenja platforme', /<title>[^<]*(WhatsApp|Viber)[^<]*<\/title>/.test(ai), true);
je('pas na prvi strani pelje nanjo', /href="\/ai-resitve\.html"[^>]*>Razvoj AI rešitev/.test(beri('index.html')), true);
{
  const bl = [...ai.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  je('en blok JSON-LD', bl.length, 1);
  let g = null;
  try { g = JSON.parse(bl[0])['@graph']; ok++; console.log('  ✔ JSON je veljaven'); }
  catch (e) { ni++; console.log('  ✖ JSON ni veljaven: ' + e.message); }
  if (g) {
    const tipi = g.map(x => x['@type']);
    je('vsebuje Service, FAQPage in BreadcrumbList', tipi.sort(), ['BreadcrumbList', 'FAQPage', 'Service']);
    const srv = g.find(x => x['@type'] === 'Service');
    je('Service kaže na isto organizacijo kot prva stran', srv.provider['@id'], 'https://flowtiq.si/#organizacija');
    je('katalog storitev ima štiri postavke', srv.hasOfferCatalog.itemListElement.length, 4);
    const faq = g.find(x => x['@type'] === 'FAQPage');
    je('vsako vprašanje ima odgovor', faq.mainEntity.every(q => q.acceptedAnswer && q.acceptedAnswer.text.length > 40), true);
    const vidnih = (ai.match(/<summary><span>/g) || []).length;
    je('vprašanj v shemi je toliko kot na strani', faq.mainEntity.length, vidnih);
    je('shema ne obljublja cene, ki je na strani ni', /\d+\s*€/.test(JSON.stringify(g)), false);
  }
}

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
