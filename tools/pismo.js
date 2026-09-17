/*
  Sestavi personalizirano pismo za en lokal.

    node tools/pismo.js --ime "Miran's pica place" --slika ../flowtek-video/out/m-pal.png
    node tools/pismo.js --ime "Salon Vita" --panoga termini --slika ...

  Izpiše dve datoteki v out/:
    pismo-<slug>.html   za kopiranje v Roundcube
    pismo-<slug>.txt    navadno besedilo (za zapis in za morebitno samodejno pošiljanje)

  KAKO SLIKA PRIDE NOTER

    Vložena je v sporočilo kot data: URI. Nič se ne nalaga z zunanjega
    strežnika: ni prazne škatlice pri prejemniku, ki ima slike privzeto
    izklopljene, in ni sledi o tem, kdaj je kdo pismo odprl.

    PREVERJENO 17. 9. 2026: Gmail vloženo sliko PRIKAŽE. To je bila edina
    prava neznanka v tej zasnovi — Gmail je data: URI leta zavračal in v
    dokumentaciji ni nikjer zapisano, da ga sprejme. Preizkušeno s pravim
    pismom na pravi Gmail račun, ne v pregledovalniku.

    Če bi kdaj nehalo delovati, se to pokaže kot manjkajoča slika in ne kot
    napaka — pismo ostane berljivo, ker sta naslov in gumb besedilna, pod
    sliko pa je stavek, ki pove isto.

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
/*
  Kdo piše. To ime je v pismu dvakrat — v prvi vrstici in v podpisu — in mora
  biti človek, ki bo tudi odgovarjal. Prejemnik bo odgovoril temu imenu; če
  mu nato odpiše nekdo drug, je prvi vtis pokvarjen že pri drugem sporočilu.
*/
const PODPISNIK = arg('podpisnik', 'Tomaž');

/*
  Članek. Edini kos kredibilnosti v pismu, ki ne prihaja od nas samih —
  naslov sam nosi argument, zato je povezan naslov in ne beseda "tukaj".

  Iz naslova je odstranjen ?trackingId=… iz LinkedInovega vmesnika: to je
  njihova sledilna oznaka za klik znotraj LinkedIna, v pismu ne pomeni nič
  in sčasoma poteče.

  Cena: to je drugi naslov v pismu poleg gumba. Filtri za neželeno pošto
  štejejo naslove, pozornost pa se deli. Zato stoji na koncu, za glavnim
  pozivom, in ne pred njim.
*/
const CLANEK = arg('clanek', 'https://www.linkedin.com/pulse/zakaj-ai-asistent-v-lokalu-ni-luksuz-ampak-razbremenitev-ekipe-ubgoe/');
const CLANEK_NASLOV = arg('clanek-naslov', 'AI asistent v lokalu ni luksuz, ampak razbremenitev ekipe');
const SLUG = (arg('slug') || IME || 'lokal')
  .toLowerCase()
  .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!IME) {
  console.error('Manjka --ime "Ime lokala"');
  process.exit(1);
}

/* ── Vsebina ───────────────────────────────────────────────────────────────

   Prva različica je bila predolga in preveč o nas. Popravljeno po podatkih
   iz .claude/skills/cold-email:

   DOLŽINA. Pod 75 besed prinese 83 % več odgovorov. Prva različica je imela
   okoli 150 in je naštevala lastnosti. Zdaj jih je 65: slika pove tisto, za
   kar je prej bilo potrebnih pet stavkov.

   ZAČETEK. Skill pravi "ne začni s tem, kdo si". Tu ga namenoma ne
   ubogamo do konca: ena vrstica pove, kdo piše, in takoj preide nanje.
   Slovenski lokal dobi malo hladne pošte in pismo brez imena pošiljatelja
   tu bolj diši po prevari kot po prodaji. Ena vrstica je poklon vljudnosti,
   odstavek bi bil predstavitev podjetja — in ta bi res škodila.

   CENE NI. V prvem stiku sproži filter "predrago", še preden je vrednost
   vidna. Brez nje je vprašanje o ceni razlog za odgovor — in odgovor je
   edini cilj tega pisma.

   EN POZIV. Prej so bili trije: gumb, odgovori na pošto in piši na 069 323
   846. Zdaj gumb (preizkusi) in mehko vprašanje na koncu. Številka za
   podporo je izpadla; kdor hoče pisati, odgovori na pošto.

   ZADEVA. Kratka, brez imena izdelka in brez prodaje. Podatki: predstavitev
   izdelka v zadevi pomeni 57 % manj odgovorov, ime v zadevi 12 % manj.

   Vse trditve ostajajo tiste s spletne strani. Dve različici, ker demo
   številka 069 323 814 vodi na picerijo: gostincu rečemo, naj naroči, vsem
   drugim povemo, da je tam picerija — sicer bi frizerki obljubili termin,
   odgovorila pa bi ji picerija.
*/
const GOSTINSTVO = PANOGA === 'narocila';

/*
  Kakšen lokal to sploh je — iz imena, ne iz panoge.

  Prej je bilo tu `GOSTINSTVO ? 'picerijo' : 'salon'` in vseh trideset pisem
  prvega paketa je imelo zadevo "Slika za vašo picerijo". Med njimi ni bilo
  niti ene picerije: deset restavracij, deset gostiln, tri gostišča. Lastnik
  Gostilne Puncer ob taki zadevi v sekundi ve, da je to predloga — in s tem
  je izgubljeno natanko tisto, kar personalizirana slika pridobi.

  Sklanjatev je del podatka: "za vašo gostilno", "za vaše gostišče", "za vaš
  lokal". Napačen spol je enako opazen kot napačna panoga.
*/
const VRSTE = [
  [/picerij|pizzer/i, 'vašo picerijo'],
  [/gostiln/i, 'vašo gostilno'],
  [/gostišč|gostisc/i, 'vaše gostišče'],
  [/restavrac/i, 'vašo restavracijo'],
  [/kavarn/i, 'vašo kavarno'],
  [/slaščičar/i, 'vašo slaščičarno'],
  [/pivnic/i, 'vašo pivnico'],
  [/hotel|motel/i, 'vaš hotel'],
  [/frizer/i, 'vaš salon'],
  [/nohtarn|kozmetik/i, 'vaš studio'],
  [/masaž|wellness|spa\b/i, 'vaš salon'],
  [/tattoo|tetoviran/i, 'vaš studio'],
];
const LOKAL = (VRSTE.find(([v]) => v.test(IME)) || [null, GOSTINSTVO ? 'vaš lokal' : 'vaš salon'])[1];

const V = {
  /*
    Zadeva: opisna, brez prodaje in brez imena izdelka.

    Prej je bila "Slika za vašo picerijo". Dvoje je bilo narobe: vseh
    trideset prejemnikov prvega paketa ni bilo picerij, beseda "Slika" pa
    spominja na ponudbe tipa "naredili smo vam logotip".

    Bolj prodajna zadeva ni rešitev — podatki pravijo, da prodajni jezik
    pomeni 17,9 % manj odprtij in predstavitev izdelka 57 % manj odgovorov.
    Rešitev je konkretnost brez ponudbe: pove temo in ne obljublja ničesar.

    "AI na vašem WhatsAppu" je konkretna in ni ponudba — pove, o čem pismo
    je. Beseda AI je hkrati vez s preostalo znamko: naslov prve strani se
    glasi "Tvoj AI pomočnik", paketa sta AI Start in AI Pro, video oglasi
    nosijo oznako "AI, KI DELA NA WHATSAPPU". Prva različica pisma besede AI
    ni imela nikjer — kdor je videl oglas in nato pismo, ju ni povezal.

    Tveganje, ki ga je treba poznati: "AI" je pri delu filtrov za neželeno
    pošto beseda z zgodovino, in del starejših lastnikov jo bere kot "robot".
    Če bo odzivov malo, je to prva stvar za zamenjavo — z --zadeva.
  */
  ZADEVA: arg('zadeva', 'AI na vašem WhatsAppu'),

  /*
    Predogled je vrstica, ki jo Gmail pokaže za zadevo v seznamu sporočil.
    Prej se je glasil "Naredil sem jo za vas" in se je naslanjal na besedo
    "slika" iz stare zadeve; ko je ta odpadla, je "jo" viselo v zraku.

    Tu je zato prostor za vrsto lokala: zadeva pove temo, predogled pa, da
    je nekaj narejeno prav zanje.
  */
  PREDOGLED: 'Sliko spodaj sem naredil za ' + LOKAL + ' — tako bi pri vas izgledal pogovor.',

  /*
    Ime lokala stoji v imenovalniku, za dvopičjem — in ne za predlogom.

    Prej se je glasilo "naredil sem jo za <ime>", kar je zahtevalo tožilnik:
    "za Gostilno Puncer". Sklanjanje poljubnih imen iz registra pa ni
    rešljivo s pravilom, ki bi držalo: "Gostilna" → "Gostilno" gre, "Kitajska
    Restavracija Dva Zmaja" pa se zalomi pri "Dva". Napačno sklanjano ime je
    enako opazno kot napačna panoga — obrnjen stavek je zato edina oblika, ki
    je pravilna pri vseh 2236 lokalih.
  */
  UVOD: '<p style="margin:0 0 14px;">Pozdravljeni,</p>'
    + '<p style="margin:0;">sem ' + PODPISNIK + ' iz FlowTeka. Spodnjo sliko sem naredil posebej za vas: '
    + '<strong>' + IME + '</strong> na WhatsAppu, kjer na sporočila '
    + (GOSTINSTVO ? 'gostov' : 'strank') + ' odgovarja AI.</p>',

  SLIKA_OPIS: GOSTINSTVO
    ? 'Pogovor na WhatsAppu: gost naroči, pomočnik potrdi naročilo — ' + IME
    : 'Pogovor na WhatsAppu: stranka vpraša za termin, pomočnik ga zabeleži — ' + IME,

  GUMB_POVEZAVA: 'https://wa.me/38669323814?text=' + encodeURIComponent('Pozdravljeni, rad bi naročil.'),
  GUMB_BESEDILO: 'Preizkusite zdaj',
  GUMB_POD: GOSTINSTVO
    ? 'Odpre se WhatsApp. Naročite pico — odgovarja isti AI, ki bi delal pri vas.'
    : 'Odpre se WhatsApp. Tam teče demo picerija, ker je naročanje najbolj nazorno.',

  BESEDILO: '<p style="margin:0;">'
    + (GOSTINSTVO
      ? 'Gost piše na vašo obstoječo številko, AI pomočnik odgovori in naročilo pošlje vam.'
      : 'Stranka piše na vašo obstoječo številko, AI pomočnik ponudi proste termine in rezervacijo zabeleži.')
    + ' Brez nove aplikacije in brez provizije. Postavimo v dveh dneh.</p>',

  PODPIS: (CLANEK
    ? '<p style="margin:0 0 14px;">O tem sem pisal tudi na LinkedInu: '
      + '<a href="' + CLANEK + '" style="color:#0E7A38;">' + CLANEK_NASLOV + '</a>.</p>'
    : '')
    + '<p style="margin:0 0 14px;">Se vam zdi uporabno? Odgovorite kar na to pošto.</p>'
    + '<p style="margin:0;">Lep pozdrav,<br /><strong>' + PODPISNIK + '</strong><br />'
    + '<a href="https://flowtek.si/?utm_source=pismo&amp;utm_medium=email&amp;utm_campaign=nagovor&amp;utm_content=' + SLUG + '" style="color:#5A6875;">FlowTek · flowtek.si</a></p>',

  /*
    NOGA — troje, in vsako je tam iz svojega razloga.

    1. "To je poslovno sporočilo" in od kod naslov. Zakon o elektronskem
       poslovanju na trgu zahteva, da je komercialno sporočilo kot tako
       prepoznavno in da je razvidno, v čigavem imenu je poslano. Splošna
       uredba (GDPR) pa zahteva, da človeku, čigar podatka nismo dobili od
       njega samega, povemo, od kod ga imamo.

    2. Odjava v enem stavku, brez obrazca in brez povezave. Povezava za
       odjavo v glavi sporočila (List-Unsubscribe) je stvar strežnika in je
       iz Roundcube ni mogoče dodati; navodilo "odgovorite z ne" je tisto,
       kar pri ročnem pošiljanju res deluje. Pomembno ni zaradi zakona,
       ampak zaradi pritožb: prijava kot neželena pošta je za ugled domene
       najdražja stvar, ki se lahko zgodi, in ljudje jo pritisnejo takrat,
       ko ne najdejo lažje poti ven.

    3. Polni podatki podjetja. Zakon o gospodarskih družbah zahteva, da
       poslovna pisma — in e-pošta to je — nosijo firmo, sedež in matične
       podatke. Isti podatki so na vseh straneh spletnega mesta; tukaj so
       prepisani od tam, da se ne razideta.

    Nisem pravnik; členov namenoma ne navajam po spominu. Če bo pošiljanje
    steklo v resnih količinah, je to pol ure dela za nekoga, ki to je.
  */
  NOGA: '<p style="margin:0 0 10px;">To je poslovno sporočilo. Vaš e-naslov je javno objavljen na spletu; pišem posamično, ne v paketu.</p>'
    + '<p style="margin:0 0 10px;">Če ne želite več sporočil, odgovorite z <strong>„ne"</strong> ali pišite na '
    + '<a href="mailto:info@flowtek.si" style="color:#93A0AC;">info@flowtek.si</a> — naslov takoj odstranim in vam ne pišem več.</p>'
    + '<p style="margin:0;">FlowTek · Webacus, Valentin Iljaž s.p. · Nova vas 12, Bizeljsko, Slovenija<br />'
    + 'Davčna številka: 35880643 · info@flowtek.si · 069 323 846 · '
    + '<a href="https://flowtek.si/" style="color:#93A0AC;">flowtek.si</a></p>',
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
