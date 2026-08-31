/*
  Preizkus ene prijave: /prijava.html je vpis, /registracija.html je vpis v
  sistem, stari naslovi še naprej delujejo.

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
je('WhatsApp koda', /api\/auth\/start/.test(p) && /api\/auth\/verify/.test(p), true);
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
je('povezava na registracijo', /href="\/registracija\.html"/.test(p), true);
je('stara Stripe povezava se preusmeri', /params\.get\('billing'\)/.test(p), true);
je('varovalka pred odprto preusmeritvijo', /charAt\(1\) === '\/'/.test(p), true);

console.log('\n4) Registracija');
const r = beri('public/registracija.html');
je('obrazec oddaja na /api/signup', /\/api\/signup/.test(r), true);
je('kanonični naslov je popravljen', /canonical" href="https:\/\/flowtiq\.si\/registracija\.html"/.test(r), true);
je('nikjer več ne kaže nase kot prijava', /flowtiq\.si\/prijava\.html/.test(r), false);
// Vsa polja, ki jih bere /api/signup — preoblikovanje ne sme nobenega spustiti.
const POLJA = ['company_name', 'vat_id', 'address', 'contact_person', 'owner_email',
  'password', 'password2', 'phone', 'business_type', 'website',
  'plans', 'period', 'paymethod', 'payHint', 'submitBtn', 'msg', 'formCard', 'successBox', 'successMsg', 'loginBtn'];
je('vsa polja in deli obrazca so na strani', POLJA.filter(id => !new RegExp('id="' + id + '"').test(r)), []);
je('past proti robotom je nevidna', /class="past"/.test(r) && /\.past\s*\{[^}]*left:-9999px/.test(r), true);
je('trije paketi z cenami', /89/.test(r) && /159\.99/.test(r) && /299/.test(r), true);
je('dejavnosti bere iz strežnika', /\/api\/business-types/.test(r), true);
je('po registraciji pelje na skupno prijavo', /id="loginBtn" href="\/prijava\.html"/.test(r), true);
je('preklic plačila je pojasnjen', /obvestilo-preklic/.test(r) && /billing'\) === 'cancel'/.test(r), true);

console.log('\n4b) Registracija je v oblikovanju strani');
je('uporablja skupni slog', /href="\/flowtiq-site\.css"/.test(r), true);
je('ima glavo strani', /class="site-head"/.test(r), true);
je('ima nogo strani', /class="site-foot"/.test(r), true);
je('brez stare palete', /#f8f7ff|#25D366/.test(r), false);
je('ni za iskalnike', /name="robots" content="noindex/.test(r), true);

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
je('čist naslov /registracija', /app\.get\('\/registracija',/.test(s), true);
je('Stripe preklic na registracijo', /cancel_url: `\$\{baseUrl\}\/registracija\.html\?billing=cancel`/.test(s), true);
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
