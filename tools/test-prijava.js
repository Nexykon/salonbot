/*
  Preizkus ene prijave: /prijava.html je vpis, edini poziv k odprtju računa je
  /kontakt.html, stari naslovi še naprej delujejo.

    node tools/test-prijava.js

  Preizkus bere datoteke, ne kliče strežnika — zanima nas, da se povezave,
  predloga generatorja in strežniške poti ne razhajajo med seboj. Prijava sama
  se preveri v brskalniku na TEST Frizerju in Test Piceriji.
*/
const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');
const beri = (rel) => fs.readFileSync(path.join(KOREN, rel), 'utf8');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const robots = beri('public/robots.txt');
const javne = fs.readdirSync(PUB).filter(f => f.endsWith('.html')).map(f => 'public/' + f)
  .concat(fs.readdirSync(path.join(PUB, 'panoga')).map(f => 'public/panoga/' + f));

console.log('\n1) Gumb »Prijava« v glavi');
const zGlavo = javne.filter(f => /class="head-actions"/.test(beri(f)));
je('glavo ima vsaj 25 strani', zGlavo.length >= 25, true);
je('vse kažejo na /prijava.html', zGlavo.filter(f => !/href="\/prijava\.html">Prijava/.test(beri(f))), []);
je('nobena več na /salon.html', javne.filter(f => /href="\/salon\.html">Prijava/.test(beri(f))), []);

console.log('\n2) Predloga generatorja (da gradnja ne povozi)');
const gen = beri('tools/gradi-panoge.js');
je('predloga kaže na /prijava.html', /href="\/prijava\.html">Prijava/.test(gen), true);
je('v predlogi ni starega naslova', /href="\/salon\.html">Prijava/.test(gen), false);

console.log('\n3) Prijavna stran');
const p = beri('public/prijava.html');
je('naslov je Prijava', /<title>Prijava — FlowTiq<\/title>/.test(p), true);
je('ni za iskalnike', /name="robots" content="noindex/.test(p), true);
je('geslo in e-naslov', /id="email"/.test(p) && /id="geslo"/.test(p), true);
/*
  Prijavna stran ne sme biti strožja od strežnika: /api/auth/login primerja
  owner_email kot navaden niz. Test Picerija je imela zapisano "test" in se
  zaradi zahteve po znaku "@" ni mogla prijaviti; e-naslov je od takrat
  popravljen, pravilo pa velja naprej za vsak tak zapis.
*/
je('polje za prijavo ni type="email"', /id="email"[^>]*type="email"|type="email"[^>]*id="email"/.test(p), false);
je('ne zahteva znaka @', /email\.indexOf\('@'\)/.test(p), false);
// Prijava z WhatsApp kodo je bila odstranjena — vpis je samo e-naslov in geslo.
je('brez prijave z WhatsApp kodo', /api\/auth\/start|api\/auth\/verify/.test(p), false);
je('brez ostankov polj za kodo', /id="telefon"|id="koda"|posljiKodo|preveriKodo/.test(p), false);
je('poskusi lastnika in skrbnika', /api\/auth\/login/.test(p) && /api\/auth\/master-login/.test(p), true);
je('e-naslova skrbnika ni več v kodi strani', /nexon666/.test(p), false);
je('skrbnik gre na /admin.html', /'\/admin\.html'/.test(p), true);
je('restavracija gre na /delivery.html', /'\/delivery\.html'/.test(p), true);
je('salon gre na /salon.html', /'\/salon\.html'/.test(p), true);
// Komentarji so izpuščeni — zanima nas koda, ne razlaga v njej.
const pKoda = p.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
je('žetona ne dodaja v naslov', /\?token=/.test(pKoda), false);
je('zapiše ključ za dostavno ploščo', /ft_delivery_token/.test(p), true);
je('povezava na pozabljeno geslo', /href="\/geslo"/.test(p), true);
je('stara Stripe povezava se preusmeri', /params\.get\('billing'\)/.test(p), true);
je('varovalka pred odprto preusmeritvijo', /charAt\(1\) === '\/'/.test(p), true);

console.log('\n4) Samostrežne registracije ni');
/*
  Priklop ni avtomatiziran, zato je edina pot do računa obrazec na
  /kontakt.html. Stran /registracija.html je odstranjena, njena pot se
  preusmerja, /api/signup pa odgovarja 410 — nepooblaščena pot, ki je
  ustvarjala lokale in odpirala Stripe seje, brez strani za njo ne sme
  ostati odprta.
*/
je('strani ni več', fs.existsSync(path.join(PUB, 'registracija.html')), false);
je('nobena stran ne kaže nanjo', javne.filter(f => /registracija\.html/.test(beri(f))), []);
je('prijava pelje na kontakt', /href="\/kontakt\.html">Še niste v FlowTiq/.test(p), true);
je('preklic plačila pelje na kontakt', /location\.replace\('\/kontakt\.html'/.test(p), true);
je('robots.txt je ne omenja', /registracija/.test(robots), false);

console.log('\n5) Plošče pošljejo brez žetona na skupno prijavo');
for (const [ime, f] of [['salon', 'public/salon.html'], ['dostava', 'public/delivery.html'], ['skrbnik', 'public/admin.html']]) {
  je(ime, /location\.replace\('\/prijava\.html/.test(beri(f)), true);
}
const d = beri('public/delivery.html');
je('dostavna plošča bere tudi skupni ključ', /localStorage\.getItem\('ft_owner_token'\)/.test(d), true);
je('… in ga zapiše ob prijavi', /localStorage\.setItem\('ft_owner_token', ownerToken\)/.test(d), true);
je('odjava počisti oba ključa', /removeItem\('ft_owner_token'\)/.test(d), true);

console.log('\n6) Pozabljeno geslo');
const g = beri('public/geslo.html');
je('nazaj na skupno prijavo', /href="\/prijava\.html">← Nazaj na prijavo/.test(g), true);
je('po ponastavitvi na skupno prijavo', /location\.href = '\/prijava\.html'/.test(g), true);
je('ne kaže več na /salon.html', /salon\.html/.test(g), false);
je('pove, kje geslo ponastavi skrbnik', /skrbni/i.test(g), true);
je('kliče owner-forgot in owner-reset', /owner-forgot/.test(g) && /owner-reset/.test(g), true);

console.log('\n7) Strežnik');
const s = beri('server.js');
je('čist naslov /prijava', /app\.get\('\/prijava',/.test(s), true);
je('/registracija se preusmeri na kontakt', /app\.get\('\/registracija', \(req, res\) => res\.redirect\(302, '\/kontakt\.html'\)\)/.test(s), true);
je('/registracija.html se preusmeri na kontakt', /app\.get\('\/registracija\.html', \(req, res\) => res\.redirect\(302, '\/kontakt\.html'\)\)/.test(s), true);
je('Stripe preklic pelje na kontakt', /cancel_url: `\$\{baseUrl\}\/kontakt\.html\?billing=cancel`/.test(s), true);
je('/api/signup odgovarja 410', /app\.post\('\/api\/signup', \(req, res\) => res\.status\(410\)/.test(s), true);
je('povezava za vpis v e-pošti je skupna', /const loginUrl = `\$\{baseUrl\}\/prijava\.html`/.test(s), true);
je('login_url v odgovoru je skupna', /login_url: '\/prijava\.html'/.test(s), true);
je('stari /dashboard.html se preusmerja', /app\.get\('\/dashboard\.html'/.test(s), true);
je('stari /settings.html se preusmerja', /app\.get\('\/settings\.html'/.test(s), true);
je('ponastavitev skrbnika ostaja v admin.html', /\/admin\.html\?reset=\$\{token\}/.test(s), true);

console.log('\n8) Stari naslovi ostanejo dosegljivi');
for (const f of ['public/salon.html', 'public/delivery.html', 'public/admin.html']) {
  je(f.replace('public/', '') + ' obstaja', fs.existsSync(path.join(KOREN, f)), true);
}
je('prijavni zaslon salona ostaja kot rezerva', /id="login-wrap"/.test(beri('public/salon.html')), true);
je('prijavni zaslon dostave ostaja kot rezerva', /id="login-screen"/.test(d), true);
je('skrbniški zaslon ostaja (ponastavitev gesla)', /id="login-screen"/.test(beri('public/admin.html')), true);

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
