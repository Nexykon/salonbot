/*
  Obvesti IndexNow o spremenjenih naslovih.

      npm run indexnow            # pošlje, kar je novega od zadnjič
      npm run indexnow -- --suho  # pokaže, kaj bi poslal, in ne pošlje
      npm run indexnow -- --vse   # pošlje vse naslove iz sitemapa

  ZAKAJ OBSTAJA

    Bing in Yandex ob spremembi strani ne pridejo sama od sebe; lahko mine
    teden ali več. IndexNow je obvestilo v drugo smer: povemo jim, kaj se je
    spremenilo, in prideta pogledat.

    Google IndexNow ne uporablja — to orodje nanj ne vpliva.

  KAJ POŠLJE IN KAJ NE

    Naslove iz ŽIVEGA sitemapa, ne iz lokalnega. Tako je hkrati potrjeno, da
    je objava res šla skozi: če je na strežniku še stara različica, bodo tudi
    datumi stari in se ne bo poslalo nič. Lokalni sitemap tega ne bi pokazal.

    Pošljejo se samo naslovi z lastmod, novejšim od zadnjega zagona. Datum
    zadnjega zagona je v tools/.indexnow-zadnjic.json (ni v gitu). Ob prvem
    zagonu brez te datoteke se ne pošlje nič — za vse naenkrat je --vse.

  KLJUČ

    Bere se iz INDEXNOW_KEY. Nikoli se ne izpiše — ne v izpisu, ne ob napaki.
    Če ga lokalno ni, ga potegni iz Railwaya:  railway run npm run indexnow
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DOMENA = 'flowtek.si';
const SITEMAP = 'https://' + DOMENA + '/sitemap.xml';
const KONCNA_TOCKA = 'https://api.indexnow.org/indexnow';
const STANJE = path.join(__dirname, '.indexnow-zadnjic.json');

const SUHO = process.argv.includes('--suho');
const VSE = process.argv.includes('--vse');

const KLJUC = process.env.INDEXNOW_KEY;
if (!KLJUC) {
  console.error('\n  INDEXNOW_KEY ni nastavljen.');
  console.error('  Dodaj ga v .env ali poženi prek Railwaya: railway run npm run indexnow\n');
  process.exit(1);
}

const beriStanje = () => {
  try { return JSON.parse(fs.readFileSync(STANJE, 'utf8')).zadnjic || null; } catch (e) { return null; }
};

(async () => {
  const r = await fetch(SITEMAP, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) { console.error('\n  sitemap.xml se ni dal prebrati: HTTP ' + r.status + '\n'); process.exit(1); }
  const xml = await r.text();

  const vnosi = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    url: (m[1].match(/<loc>([^<]+)<\/loc>/) || [, ''])[1].trim(),
    lastmod: (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [, ''])[1].trim(),
  })).filter((v) => v.url);

  const zadnjic = beriStanje();
  const izbrani = VSE || !zadnjic
    ? (VSE ? vnosi : [])
    : vnosi.filter((v) => v.lastmod && v.lastmod > zadnjic);

  console.log('\n  sitemap: ' + vnosi.length + ' naslovov');
  console.log('  zadnji zagon: ' + (zadnjic || '(ni zapisa)'));
  console.log('  za poslati: ' + izbrani.length);

  if (!izbrani.length) {
    if (!zadnjic && !VSE) {
      console.log('\n  Prvi zagon brez zapisa o prejšnjem — nič se ne pošlje.');
      console.log('  Za vse naslove naenkrat: npm run indexnow -- --vse\n');
    } else {
      console.log('\n  Od zadnjega zagona se ni spremenilo nič.\n');
    }
    return;
  }

  for (const v of izbrani) console.log('    ' + v.lastmod + '  ' + v.url);

  if (SUHO) { console.log('\n  Suhi tek — nič ni poslano.\n'); return; }

  const odgovor = await fetch(KONCNA_TOCKA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: DOMENA,
      key: KLJUC,
      keyLocation: 'https://' + DOMENA + '/' + KLJUC + '.txt',
      urlList: izbrani.map((v) => v.url),
    }),
  });

  /*
    200 = sprejeto, 202 = sprejeto in ključ se še preverja. Oboje je v redu.
    Telesa odgovora ne izpisujemo: pri 4xx zna vsebovati poslani ključ.
  */
  const vRedu = odgovor.status === 200 || odgovor.status === 202;
  console.log('\n  IndexNow: HTTP ' + odgovor.status + (vRedu ? '  — sprejeto' : '  — NI sprejeto'));

  if (!vRedu) {
    console.error('  Naslovi niso bili sprejeti; zapis o zadnjem zagonu ostaja nespremenjen.\n');
    process.exit(1);
  }

  /*
    Zapis se posodobi šele po uspehu. Ob neuspehu gredo isti naslovi
    naslednjič znova — kar je bolje kot da bi tiho izpadli.
  */
  const najnovejsi = izbrani.map((v) => v.lastmod).filter(Boolean).sort().pop();
  fs.writeFileSync(STANJE, JSON.stringify({ zadnjic: najnovejsi || new Date().toISOString().slice(0, 10) }, null, 2) + '\n', 'utf8');
  console.log('  zapisano kot zadnji zagon: ' + najnovejsi + '\n');
})().catch((e) => {
  /* Sporočilo napake lahko nosi naslov s ključem, zato ga odrežemo. */
  console.error('\n  napaka: ' + String(e.message).replace(new RegExp(KLJUC, 'g'), '«ključ»') + '\n');
  process.exit(1);
});
