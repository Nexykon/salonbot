/*
  Trak lokalov na naslovnici: kartice, ki morajo preživeti prepis iz API-ja.

      node tools/test-lokali-trak.js

  ZAKAJ OBSTAJA

    Ko se naloži JS, se trak v celoti preriše iz /api/public/restaurants. Pri
    tem se odstranijo vse kartice z atributom data-lokal — statične v HTML-u
    so namreč le rezerva za obiskovalce brez JS.

    Past je v tem, da se tega ob dodajanju nove kartice ne vidi: v HTML-u je
    videti pravilno, na strani pa izgine v trenutku, ko se naloži skripta.
    Kartice, ki niso iz API-ja (povabilo "Tu je prostor" in lokali v pripravi),
    zato atributa ne smejo imeti.
*/
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let ok = 0;
const napake = [];
const trdi = (opis, pogoj, dodatek) => {
  if (pogoj) { ok += 1; console.log('  ✓ ' + opis); }
  else { napake.push(opis + (dodatek ? ' — ' + dodatek : '')); console.log('  ✖ ' + opis + (dodatek ? ' — ' + dodatek : '')); }
};

const zacetek = html.indexOf('id="lokali-strip"');
const konec = html.indexOf('</section>', zacetek);
const trak = html.slice(zacetek, konec);

console.log('\n1. Kaj JS odstrani');
trdi('prepis odstranjuje natanko [data-lokal]', html.includes("strip.querySelectorAll('[data-lokal]')"));

console.log('\n2. Kartice v traku');
/* Vsaka kartica se začne z <div class="card" ali <!-- komentarjem pred njo. */
const kartice = trak.split(/<div class="card/).slice(1);
trdi('v traku so tri kartice', kartice.length === 3, 'najdenih ' + kartice.length);

const imaAtribut = (k) => /data-lokal=/.test(k);
const vsebuje = (k, s) => k.includes(s);

trdi('prva je iz API-ja (rezerva z data-lokal)', imaAtribut(kartice[0]));
trdi('lokal v pripravi nima data-lokal', kartice[1] && !imaAtribut(kartice[1]),
  kartice[1] && imaAtribut(kartice[1]) ? 'ima ga — po nalaganju JS bi izginil' : '');
trdi('povabilo nima data-lokal', kartice[2] && !imaAtribut(kartice[2]));

console.log('\n3. Lokal v pripravi je ločen od tistih, ki že delujejo');
const vPripravi = kartice[1] || '';
trdi('nosi oznako V PRIPRAVI', vsebuje(vPripravi, 'V PRIPRAVI'));
trdi('pove, da priklop teče', vsebuje(vPripravi, 'Priklop je v teku'));
trdi('je vidno drugačen (črtkan rob)', /border-style:dashed/.test(vPripravi));
trdi('ne trdi, da sprejema naročila', !/sprejema|vzpostavljeno|naroč(a|i)/i.test(vPripravi.replace(/<!--[\s\S]*?-->/g, '')));

console.log('\n4. Logotip je naš, ne tuj strežnik');
const logo = (vPripravi.match(/src="([^"]+)"/) || [, ''])[1];
trdi('vir je lokalna datoteka', logo.startsWith('/'), logo);
trdi('datoteka obstaja', logo.startsWith('/') && fs.existsSync(path.join(__dirname, '..', 'public', logo.slice(1))), logo);
trdi('ima nadomestno besedilo', /alt="[^"]{3,}"/.test(vPripravi));

console.log('\n  ' + ok + ' trditev drži' + (napake.length ? ', ' + napake.length + ' pade' : '') + '\n');
if (napake.length) { for (const n of napake) console.log('   ✖ ' + n); process.exit(1); }
