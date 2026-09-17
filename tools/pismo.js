/*
  Sestavi personalizirano pismo za en lokal.

    node tools/pismo.js --ime "Miran's pica place" --slika ../flowtek-video/out/m-pal.png
    node tools/pismo.js --ime "Salon Vita" --panoga termini --slika ...

  Izpiše dve datoteki v out/:
    pismo-<slug>.html   za kopiranje v Roundcube
    pismo-<slug>.txt    navadno besedilo (za zapis in za morebitno samodejno pošiljanje)

  KAKO SLIKA PRIDE NOTER

    Vložena je v sporočilo kot data: URI. Prednost: nič se ne nalaga z
    zunanjega strežnika, torej ni ne prazne škatlice pri prejemniku, ki ima
    slike privzeto izklopljene z naših domen, ne sledi o tem, kdaj je kdo
    pismo odprl. Slabost: nekateri odjemalci data: URI zavrnejo — Gmail ga je
    leta zavračal in ni nikjer zapisano, da ga danes zanesljivo sprejme.
    Prav zato prvo pismo pošljemo na Gmail in pogledamo.

    Če slika odpade, pismo ostane berljivo: pod njo je besedilo, ki pove isto,
    naslov in gumb pa sta besedilna.

  VELIKOST

    Gmail sporočilo, daljše od 102 KB, odreže in pripne "Prikaži celotno
    sporočilo" — podpis in odjava takrat izpadeta. Skript zato izmeri in
    opozori. Slika naj bo PNG z omejeno paleto, ne JPEG: besedilo na ravni
    ploskvi da pri JPEG obroče okoli črk in večjo datoteko.
*/
const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..');
const PREDLOGA = path.join(__dirname, 'pismo-predloga.html');
const IZHOD = path.join(KOREN, 'out');

/* ── Argumenti ─────────────────────────────────────────────────────────── */
const arg = (ime, privzeto) => {
  const i = process.argv.indexOf('--' + ime);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : privzeto;
};

const IME = arg('ime');
const SLIKA = arg('slika');
const PANOGA = arg('panoga', 'narocila');   // narocila | termini
const SLUG = (arg('slug') || IME || 'lokal')
  .toLowerCase()
  .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!IME) {
  console.error('Manjka --ime "Ime lokala"');
  process.exit(1);
}

/* ── Vsebina ───────────────────────────────────────────────────────────────

   Vse trditve so tiste s spletne strani: postavitev v dveh dneh, brez nove
   aplikacije, brez provizije na naročilo, cena od 89 € brez vezave. Nobene
   številke, ki je na strani ni, in nobenega navedka stranke.

   Dve različici, ker demo številka 069 323 814 vodi na picerijo. Gostincu
   rečemo, naj naroči; vsem drugim povemo, da je tam picerija — sicer bi
   frizerki obljubili termin, odgovorila pa bi ji picerija.
*/
const GOSTINSTVO = PANOGA === 'narocila';

const V = {
  ZADEVA: GOSTINSTVO
    ? IME + ' — naročila prek WhatsAppa, brez nove aplikacije'
    : IME + ' — naročanje terminov prek WhatsAppa, brez nove aplikacije',

  PREDOGLED: 'Sliko spodaj sem naredil za vas — tako bi izgledal pogovor z gostom.',

  NASLOV: 'Tako bi pri vas izgledal pogovor',

  UVOD: '<p style="margin:0 0 14px;">Pozdravljeni,</p>'
    + '<p style="margin:0;">sliko spodaj sem naredil za <strong>' + IME + '</strong>. '
    + (GOSTINSTVO
      ? 'Tako bi izgledal pogovor z gostom, ki pri vas naroči prek WhatsAppa.'
      : 'Tako bi izgledal pogovor s stranko, ki se pri vas naroči prek WhatsAppa.')
    + '</p>',

  SLIKA_OPIS: 'Pogovor na WhatsAppu: gost naroči, pomočnik potrdi naročilo — ' + IME,

  GUMB_POVEZAVA: 'https://wa.me/38669323814?text=' + encodeURIComponent('Pozdravljeni, rad bi naročil.'),
  GUMB_BESEDILO: 'Preizkusite zdaj',
  GUMB_POD: GOSTINSTVO
    ? 'Odpre se WhatsApp. Naročite pico — odgovarja isti pomočnik, ki bi delal pri vas.'
    : 'Odpre se WhatsApp. Tam teče demo picerija, ker je naročanje najbolj nazorno.',

  BESEDILO: '<p style="margin:0 0 14px;">Postavljamo WhatsApp pomočnika za slovenske lokale. '
    + (GOSTINSTVO
      ? 'Gost piše na vašo obstoječo številko, pomočnik odgovori, sprejme naročilo in vam ga pošlje naprej. Vi kuhate naprej.'
      : 'Stranka piše na vašo obstoječo številko, pomočnik odgovori, ponudi proste termine in zabeleži rezervacijo. Vi delate naprej.')
    + '</p>'
    + '<p style="margin:0 0 14px;">Številka v gumbu je <strong>živa</strong> — ni posnetek in ni predstavitev. '
    + 'Napišite ji in v nekaj sekundah vidite, kako se obnaša.</p>'
    + '<p style="margin:0;">Postavimo v dveh dneh. Brez nove aplikacije, brez provizije na naročilo, '
    + 'od <strong>89 € na mesec</strong> brez vezave.</p>',

  PODPIS: '<p style="margin:0 0 14px;">Če vas zanima, odgovorite kar na to pošto ali pišite na '
    + '<a href="https://wa.me/38669323846" style="color:#0E7A38; font-weight:600;">069 323 846</a>.</p>'
    + '<p style="margin:0;">Lep pozdrav,<br /><strong>Miran</strong><br />'
    + '<a href="https://flowtek.si/?utm_source=pismo&amp;utm_medium=email&amp;utm_campaign=nagovor&amp;utm_content=' + SLUG + '" style="color:#5A6875;">flowtek.si</a></p>',

  NOGA: 'Pišem posamično, ne v paketu. Če ne želite več sporočil, zadošča kratek odgovor in vas takoj odstranim.',
};

/* ── Slika ─────────────────────────────────────────────────────────────── */
let slikaURI = '';
let slikaKB = 0;
if (SLIKA) {
  const p = path.isAbsolute(SLIKA) ? SLIKA : path.join(KOREN, SLIKA);
  if (!fs.existsSync(p)) { console.error('Slike ni: ' + p); process.exit(1); }
  const bajti = fs.readFileSync(p);
  slikaKB = bajti.length / 1024;
  const vrsta = path.extname(p).toLowerCase() === '.gif' ? 'image/gif'
    : path.extname(p).toLowerCase() === '.jpg' || path.extname(p).toLowerCase() === '.jpeg' ? 'image/jpeg'
      : 'image/png';
  slikaURI = 'data:' + vrsta + ';base64,' + bajti.toString('base64');
} else {
  console.log('  (brez slike — pismo bo brez vloženega posnetka pogovora)');
}

/* ── Sestavljanje ──────────────────────────────────────────────────────── */
let html = fs.readFileSync(PREDLOGA, 'utf8');
for (const [k, v] of Object.entries({ ...V, SLIKA: slikaURI })) {
  html = html.split('{{' + k + '}}').join(v);
}

const odstraniOznake = (s) => s.replace(/<br \/>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const besedilo = [
  V.ZADEVA,
  '',
  odstraniOznake(V.UVOD),
  '[ Slika: ' + V.SLIKA_OPIS + ' ]',
  '',
  'Preizkusite zdaj: ' + V.GUMB_POVEZAVA,
  V.GUMB_POD,
  '',
  odstraniOznake(V.BESEDILO),
  '',
  odstraniOznake(V.PODPIS),
  '',
  V.NOGA,
].join('\n');

fs.mkdirSync(IZHOD, { recursive: true });
const potHtml = path.join(IZHOD, 'pismo-' + SLUG + '.html');
const potTxt = path.join(IZHOD, 'pismo-' + SLUG + '.txt');
fs.writeFileSync(potHtml, html, 'utf8');
fs.writeFileSync(potTxt, besedilo, 'utf8');

const kb = Buffer.byteLength(html, 'utf8') / 1024;
console.log('\n  ZADEVA: ' + V.ZADEVA);
console.log('\n  ' + potHtml);
console.log('  ' + potTxt);
console.log('\n  slika ' + slikaKB.toFixed(1) + ' KB → pismo ' + kb.toFixed(1) + ' KB');
if (kb > 102) console.log('  ✖ ČEZ 102 KB — Gmail bo sporočilo odrezal. Zmanjšaj sliko.');
else if (kb > 80) console.log('  ⚠ blizu Gmailove meje 102 KB');
else console.log('  ✔ pod Gmailovo mejo 102 KB');
console.log('');
