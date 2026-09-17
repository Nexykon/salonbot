/*
  Pripravi paket pisem za prvih N lokalov iz ene panoge.

    node tools/paket.js --panoga RESTAVRACIJE --koliko 30
    node tools/paket.js --panoga RESTAVRACIJE --koliko 30 --zares

  Brez --zares se NIČ ne zapiše v bazo in NIČ ne izriše: samo pokaže, koga
  bi vzel in koga izločil ter zakaj. Tako se da odločitev pogledati, preden
  se 4057 vrstic dotakne karkoli.

  KORAKI

    1. Iz baze vzame kandidate: prava panoga, ni odjavljen, še brez stika,
       ima e-naslov. Vzame več, kot jih rabimo, ker jih bo nekaj odpadlo.
    2. Vsakega preveri (spodaj).
    3. Izločene zapiše v bazo z razlogom, da ne pridejo več v vrsto.
    4. Za sprejete izriše personalizirane slike (flowtek-video) in sestavi
       pisma (tools/pismo.js).

  KAJ SE PREVERJA IN ČESA SE NE DA

    Preverim tisto, kar se preveriti da:

      · oblika naslova,
      · ali domena sploh sprejema pošto (zapis MX v DNS) — to je edini
        preizkus, ki res loči živ naslov od mrtvega, in ujame tudi tipkarske
        napake v domeni,
      · očitne packarije (noreply, example, test),
      · podvojeni naslovi — dva lokala z istim naslovom pomenita dve pismi
        isti osebi,
      · prazno ali okrnjeno ime lokala, ker gre ime v pismo in v sliko.

    Česar NE morem preveriti: ali je lokal primerna stranka. Ali ima gost
    dostavo, ali dela sploh še, ali je to podružnica verige, ki o tem ne
    odloča. To lahko pove samo človek, ki pogleda. Zato tega ne ugibam —
    seznam sprejetih je za pregled, ne za slepo pošiljanje.
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { execFileSync } = require('child_process');

const KOREN = path.join(__dirname, '..');
const IZHOD = path.join(KOREN, 'out');
const VIDEO = path.join(KOREN, '..', 'flowtek-video');

const SB = process.env.SUPABASE_URL;
const KLJUC = process.env.SUPABASE_KEY;
if (!SB || !KLJUC) { console.error('Manjka SUPABASE_URL ali SUPABASE_KEY.'); process.exit(1); }
const GLAVA = { apikey: KLJUC, Authorization: 'Bearer ' + KLJUC, 'Content-Type': 'application/json' };

const arg = (ime, privzeto) => {
  const i = process.argv.indexOf('--' + ime);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : privzeto;
};
const PANOGA = arg('panoga', 'RESTAVRACIJE');
const KOLIKO = Number(arg('koliko', 30));
const ZARES = process.argv.includes('--zares');

/*
  Ročna odločitev za primere, ki jih stroj ne more razsoditi.

    --izloci 707,708   gredo ven in se v bazo zapiše, da jih ne ponujamo več
    --vkljuci 713,745  gredo noter kljub temu, da so bili označeni za pregled

  Obstaja zato, ker se odločitev o konkretnem lokalu ne da zapisati v
  pravilo, ki bi veljalo za vseh 2236. Zapisana pa mora biti nekje, kjer se
  jo da ponoviti in preveriti — zato v ukazu in ne v glavi.
*/
const seznamId = (s) => new Set(String(s || '').split(/[,\s]+/).filter(Boolean).map(Number));
const ROCNO_IZLOCI = seznamId(arg('izloci', ''));
const ROCNO_VKLJUCI = seznamId(arg('vkljuci', ''));

/* Gostinstvo dobi drugo besedilo kot ostali — glej pismo.js. */
const JE_GOSTINSTVO = /restavrac|picerij|pizza|gostil/i.test(PANOGA);

const slugify = (s) => String(s).toLowerCase()
  .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/* ── Preverbe ──────────────────────────────────────────────────────────── */

const OBLIKA = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
const PACKARIJE = /^(no-?reply|nereply|donotreply|test|primer|example|admin@example)/i;
const SUMLJIVE_DOMENE = /(example\.(com|org|si)|test\.|localhost|gmial\.|gmai\.com|hotmial\.|yaho\.)/i;

const mxPredpomnilnik = new Map();
async function domenaSprejemaPosto(domena) {
  if (mxPredpomnilnik.has(domena)) return mxPredpomnilnik.get(domena);
  let ok = false;
  try {
    const zapisi = await dns.resolveMx(domena);
    ok = Array.isArray(zapisi) && zapisi.length > 0;
  } catch (e) {
    /*
      NXDOMAIN pomeni, da domene ni; ostale napake so lahko tudi trenutne.
      Ob dvomu naslova ne izločimo — raje pošljemo enemu preveč kot da bi
      dobrega za vedno označili za mrtvega.
    */
    ok = e.code !== 'ENOTFOUND' && e.code !== 'NXDOMAIN';
  }
  mxPredpomnilnik.set(domena, ok);
  return ok;
}

async function preveri(lead, videniNaslovi) {
  const email = String(lead.email || '').trim().toLowerCase();
  const ime = String(lead.business_name || '').trim();

  if (!email) return 'ni e-naslova';
  if (!OBLIKA.test(email)) return 'e-naslov ni pravilne oblike: ' + email;
  if (PACKARIJE.test(email)) return 'naslov, ki ne sprejema odgovorov: ' + email;
  if (SUMLJIVE_DOMENE.test(email)) return 'sumljiva ali napačno zapisana domena: ' + email;

  if (videniNaslovi.has(email)) return 'podvojen naslov (že v paketu pri ' + videniNaslovi.get(email) + ')';

  if (!ime) return 'lokal nima imena';
  if (ime.length < 3) return 'ime lokala je prekratko: "' + ime + '"';

  /*
    d.d. je delniška družba — hotelske in igralniške skupine, ne lokal, kjer
    bi gostinec sam odločal o WhatsAppu. HIT d.d. je tipičen primer.
  */
  if (/\bd\.\s?d\.?\b/i.test(ime)) return 'delniška družba (d.d.) — prevelika za to ponudbo';

  const kratko = imeZaPogovor(ime);
  if (kratko.length < 4) return 'iz imena ne ostane nič uporabnega: "' + ime + '"';

  const domena = email.split('@')[1];
  if (!(await domenaSprejemaPosto(domena))) return 'domena ne sprejema pošte (ni zapisa MX): ' + domena;

  return null;
}

/*
  Ime za glavo pogovora. V bazi so uradna imena iz registra — "OKUSNO
  D.O.O. PICERIJA OSMICA" — v WhatsApp glavi pa mora stati ime, po katerem
  lokal poznajo gostje. Odstranimo pravne oblike in ime skrajšamo.

  Kjer to ne da smiselnega rezultata, pustimo prvotno ime: napačno skrajšano
  ime je slabše od dolgega.
*/
/*
  Prvi poskus je imel vzorec brez meje besede na začetku. Pravna oblika
  "k.d." je zato v "GOSTIŠČE ŠTERK D.O.O." ujela "K D." — torej zadnjo črko
  imena — in iz lokala naredila "Gostišče Šter O.o.". Ime v pismu je edino,
  kar je res osebno; pokvarjeno je slabše od nobenega.
*/
const PRAVNE_OBLIKE = /[,;]?\s*\b(d\.\s?o\.\s?o\.?|d\.\s?d\.?|s\.\s?p\.?|k\.\s?d\.?|d\.\s?n\.\s?o\.?|doo|dd)\b\.?/gi;

function imeZaPogovor(uradno) {
  let s = String(uradno)
    .replace(PRAVNE_OBLIKE, ' ')
    .replace(/\bPE\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    // Ostanki ločil, ki jih pusti izrezovanje: "QTBR ." → "QTBR"
    .replace(/[\s.,;:\-]+$/, '')
    .replace(/^[\s.,;:\-]+/, '')
    .trim();

  /*
    Za vejico so v registru večinoma lastniki: "AMADEUS, VLADIMIRA KOROŠEC".
    Prag je bil 8 znakov in je "Amadeus" (7) pustil z lastnico vred. Zdaj je
    5; kar je krajše od tega, tako ali tako pade na preverbi dolžine.
  */
  const vejica = s.indexOf(',');
  if (vejica > 4) s = s.slice(0, vejica).replace(/[\s.,;:\-]+$/, '').trim();

  if (s.length < 3) return String(uradno).trim();

  // Velike tiskane iz registra → oblika, ki je videti kot napis nad lokalom.
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s(\-"„])([a-zčšžćđ])/g, (m, a, b) => a + b.toUpperCase());
  }
  return s.slice(0, 34).trim();
}

/*
  Besede, po katerih se vidi, da gre za gostinski lokal. Uporabljene niso za
  izločanje — restavracija se lahko imenuje tudi Amadeus — ampak za to, da
  se lokali brez njih pokažejo posebej. Tam je ime v sliki najbolj tvegano:
  v zeleni glavi bi pisalo "Qtbr" in prejemnik bi vedel, da je to stroj.
*/
const GOSTINSKA_BESEDA = /gostil|gostiš|gostinstv|picerij|pizzer|pizza|restavrac|kavarn|bistro|bife|okrepčeval|taverna|trattoria|osteria|krčma|pivnica|hotel|motel|slaščičar|burger|kebab|grill|gril|jedilnic|menza|catering|dostava/i;

const crkaZa = (ime) => (ime.match(/[A-Za-zČŠŽčšž]/) || ['?'])[0].toUpperCase();

/* ── Glavni tek ────────────────────────────────────────────────────────── */

(async () => {
  console.log('\n  Panoga: ' + PANOGA + ' · želimo: ' + KOLIKO + (ZARES ? ' · ZARES (piše v bazo)' : ' · samo pregled'));

  const pogoji = [
    'select=id,business_name,email,phone,address,category',
    'category=eq.' + encodeURIComponent(PANOGA),
    'ne_kontaktiraj=is.false',
    'zadnji_stik_at=is.null',
    'email=neq.',
    'order=id.asc',
    'limit=' + (KOLIKO * 3),
  ];
  const r = await fetch(SB + '/rest/v1/leads?' + pogoji.join('&'), { headers: GLAVA });
  const kandidati = await r.json();
  if (!Array.isArray(kandidati)) { console.error(kandidati); process.exit(1); }
  console.log('  kandidatov iz baze: ' + kandidati.length + '\n');

  const sprejeti = [];
  const izloceni = [];
  const videni = new Map();

  for (const l of kandidati) {
    if (sprejeti.length >= KOLIKO) break;

    if (ROCNO_IZLOCI.has(l.id)) {
      izloceni.push({ id: l.id, ime: l.business_name, email: l.email, razlog: 'ročno izločen pri pregledu' });
      continue;
    }

    const razlog = await preveri(l, videni);
    if (razlog) {
      izloceni.push({ id: l.id, ime: l.business_name, email: l.email, razlog });
      continue;
    }
    const ime = imeZaPogovor(l.business_name);
    videni.set(String(l.email).trim().toLowerCase(), ime);
    sprejeti.push({
      id: l.id,
      uradno: l.business_name,
      ime,
      crka: crkaZa(ime),
      email: l.email,
      kraj: String(l.address || '').split(',').pop().trim(),
      slug: slugify(ime) + '-' + l.id,
    });
  }

  const jeJasen = (s) => GOSTINSKA_BESEDA.test(s.uradno) || ROCNO_VKLJUCI.has(s.id);
  const jasni = sprejeti.filter(jeJasen);
  const zaPregled = sprejeti.filter((s) => !jeJasen(s));

  console.log('  ✔ SPREJETI (' + jasni.length + ')');
  for (const s of jasni) {
    console.log('     ' + String(s.id).padStart(5) + '  ' + s.ime.padEnd(34) + '  ' + s.email);
    if (s.ime !== s.uradno) console.log('            v registru: ' + s.uradno);
  }

  if (zaPregled.length) {
    console.log('\n  ? ZA TVOJ PREGLED (' + zaPregled.length + ') — v imenu ni gostinske besede,');
    console.log('    zato v zeleni glavi pogovora ne bo videti kot ime lokala:');
    for (const s of zaPregled) {
      console.log('     ' + String(s.id).padStart(5) + '  v sliki bi pisalo: "' + s.ime + '"');
      console.log('            v registru: ' + s.uradno + '  ·  ' + s.email);
    }
  }

  console.log('\n  ✖ IZLOČENI (' + izloceni.length + ')');
  for (const i of izloceni) console.log('     ' + String(i.id).padStart(5) + '  ' + String(i.ime).slice(0, 34).padEnd(34) + '  ' + i.razlog);

  if (!ZARES) {
    console.log('\n  Nič ni zapisano in nič izrisano. Za izvedbo dodaj --zares\n');
    return;
  }

  fs.mkdirSync(IZHOD, { recursive: true });
  fs.writeFileSync(path.join(IZHOD, 'paket.json'), JSON.stringify(sprejeti, null, 2), 'utf8');

  // 1) Izločene zapiši, da ne pridejo več v vrsto.
  for (const i of izloceni) {
    await fetch(SB + '/rest/v1/leads?id=eq.' + i.id, {
      method: 'PATCH',
      headers: GLAVA,
      body: JSON.stringify({
        ne_kontaktiraj: true,
        ne_kontaktiraj_razlog: 'Izločen pri pregledu paketa: ' + i.razlog,
      }),
    });
  }
  console.log('\n  v bazo zapisanih izločitev: ' + izloceni.length);

  // 2) Slike
  console.log('\n  izris slik …');
  execFileSync('node', [path.join(VIDEO, 'orodja', 'vabila.js'), path.join(IZHOD, 'paket.json')],
    { cwd: VIDEO, stdio: 'inherit' });

  // 3) Pisma
  console.log('\n  sestavljam pisma …');
  for (const s of sprejeti) {
    const slika = path.join(VIDEO, 'out', 'vabila', s.slug + '.png');
    if (!fs.existsSync(slika)) { console.log('  ✖ manjka slika za ' + s.slug); continue; }
    execFileSync('node', [
      path.join(__dirname, 'pismo.js'),
      '--ime', s.ime,
      '--slug', s.slug,
      '--panoga', JE_GOSTINSTVO ? 'narocila' : 'termini',
      '--slika', slika,
    ], { cwd: KOREN, stdio: 'ignore' });
  }

  // 4) Kazalo za delo
  const zadevaZa = (slug) => {
    const p = path.join(IZHOD, 'pismo-' + slug + '.html');
    if (!fs.existsSync(p)) return '';
    const m = fs.readFileSync(p, 'utf8').match(/<title>([^<]+)<\/title>/);
    return m ? m[1] : '';
  };
  const vrstice = sprejeti.map((s, i) =>
    '| ' + (i + 1) + ' | ' + s.ime + ' | ' + s.kraj + ' | ' + s.email + ' | ' + zadevaZa(s.slug) + ' | `out/pismo-' + s.slug + '.html` |');
  const kazalo = [
    '# Paket pisem — ' + PANOGA,
    '',
    'Pripravljeno: ' + new Date().toLocaleString('sl-SI'),
    '',
    /*
      Zadeva ni ista za vse — pismo.js jo sestavi iz imena lokala, ker so v
      isti panogi gostilne, restavracije in gostišča. Zato je v kazalu svoj
      stolpec in ne ena vrstica na vrhu.
    */
    '',
    '| # | Lokal | Kraj | E-naslov | Zadeva | Pismo |',
    '|---|---|---|---|---|---|',
    ...vrstice,
    '',
    '## Izločeni (' + izloceni.length + ')',
    '',
    'Zapisani v bazo z `ne_kontaktiraj`, da ne pridejo več v vrsto.',
    '',
    ...izloceni.map((i) => '- **' + i.ime + '** (' + i.email + ') — ' + i.razlog),
    '',
    '## Ko pismo pošlješ',
    '',
    'Zabeleži stik v konzoli (`node tools/nagovor.js`) ali neposredno v `sb_lead_stiki`,',
    'sicer bo lokal jutri spet v vrsti.',
  ].join('\n');
  fs.writeFileSync(path.join(IZHOD, 'paket.md'), kazalo, 'utf8');

  console.log('\n  ✔ ' + sprejeti.length + ' pisem v out/ · kazalo: out/paket.md\n');
})();
