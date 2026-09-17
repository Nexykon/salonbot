/*
  Lokalna konzola za nagovarjanje lokalov — po enem naenkrat.

    node tools/nagovor.js          → http://127.0.0.1:3020

  KAJ POČNE IN ČESA NE

    Ne pošilja ničesar. Pripravi naslovnika, zadevo in besedilo, ti pa
    pritisneš pošlji v svojem predalu. Pošta tako odide iz pravega predala,
    kar je pri hladnem nagovarjanju bolje sprejeto kot pošiljanje prek API-ja
    — predvsem pa ugled domene flowtek.si, od katerega so odvisne prijavne
    povezave in obvestila strankam, ostane nedotaknjen.

    Za Facebook in Instagram odpre iskanje po imenu lokala. Sporočila tam
    pišeš sam, v njihovem vmesniku. Avtomatizacija sporočil prek nepooblaščenih
    orodij je proti pravilom Mete in tvega blokado profila — tega orodje ne
    počne in ne bo.

    Edino, kar zapiše v bazo, je to, kar mu poveš, da si naredil: vrstica v
    sb_lead_stiki. Povzetek na leadu se posodobi sam, prek prožilca iz
    migracije 010.

  ZAKAJ LOKALNO

    Ker je pošiljanje iz administracije prav zaradi tega odstranjeno. Orodje,
    ki teče na tvojem računalniku in posluša samo na 127.0.0.1, ne more
    ponoviti tistega, kar je "Pošlji vsem" počel: en klik, 3874 podjetij.

  DNEVNA MEJA

    30 odhodnih stikov na dan. Meja ni tehnična — spodaj je zapisana kot
    številka in jo lahko kdorkoli poveča. Je opomnik: hladno nagovarjanje v
    velikih količinah iz enega predala je najhitrejša pot do tega, da tvoja
    pošta konča v neželeni.
*/
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const VRATA = Number(process.env.NAGOVOR_PORT) || 3020;
const NA_DAN = 30;

const SB = process.env.SUPABASE_URL;
const KLJUC = process.env.SUPABASE_KEY;
if (!SB || !KLJUC) {
  console.error('Manjka SUPABASE_URL ali SUPABASE_KEY v .env — orodje brez baze nima kaj početi.');
  process.exit(1);
}

const GLAVA = { apikey: KLJUC, Authorization: 'Bearer ' + KLJUC, 'Content-Type': 'application/json' };

async function baza(metoda, pot, telo, dodatno = {}) {
  const r = await fetch(SB + '/rest/v1' + pot, {
    method: metoda,
    headers: { ...GLAVA, ...dodatno },
    body: telo ? JSON.stringify(telo) : undefined,
  });
  const besedilo = await r.text();
  if (!r.ok) throw new Error('Baza ' + r.status + ': ' + besedilo.slice(0, 200));
  return {
    podatki: besedilo ? JSON.parse(besedilo) : null,
    obseg: r.headers.get('content-range'),
  };
}

/* ── BESEDILO ──────────────────────────────────────────────────────────────

   Dve različici, ker demo številka vodi na picerijo. Gostincu rečemo "naroči
   pico", vsem drugim pa povemo, da je demo picerija — sicer bi frizerki
   obljubili termin, odgovorila pa bi ji picerija. Ista past kot v oglasih.

   Vse trditve so tiste s strani: dva dneva, brez provizije, brez nove
   aplikacije, cena od 89 € brez vezave. Nobene številke, ki je na strani ni.
*/
const JE_GOSTINSTVO = (kategorija) => /picer|restavrac|pizza|gostiln|bar|kavarn/i.test(kategorija || '');

function sestaviPosto(lead) {
  const ime = lead.business_name || 'Pozdravljeni';
  const gostinstvo = JE_GOSTINSTVO(lead.category);

  const zadeva = gostinstvo
    ? ime + ' — naročila prek WhatsAppa, brez nove aplikacije'
    : ime + ' — naročanje terminov prek WhatsAppa, brez nove aplikacije';

  const preizkus = gostinstvo
    ? 'Da ne razlagam na prazno: napišite na 069 323 814 in naročite pico. Odgovarja isti pomočnik, ki bi delal pri vas.'
    : 'Da ne razlagam na prazno: napišite na 069 323 814. Tam teče demo picerija, ker je naročanje najbolj nazorno — pri vas bi na enak način sprejemal termine.';

  const kaj = gostinstvo
    ? 'gost piše na vašo obstoječo številko, pomočnik odgovori, sprejme naročilo in vam ga pošlje naprej'
    : 'stranka piše na vašo obstoječo številko, pomočnik odgovori, ponudi proste termine in zabeleži rezervacijo';

  const besedilo = [
    'Pozdravljeni,',
    '',
    'pišem iz FlowTeka. Postavljamo WhatsApp pomočnika za slovenske lokale: ' + kaj + '.',
    '',
    preizkus,
    '',
    'Priložen je kratek posnetek, kako tak pogovor izgleda pri vas.',
    '',
    'Postavimo v dveh dneh. Brez nove aplikacije, brez provizije na naročilo, cena od 89 € na mesec brez vezave.',
    '',
    'Če vas zanima, odgovorite na to pošto ali pišite na 069 323 846.',
    '',
    'Lep pozdrav,',
    'FlowTek · flowtek.si',
  ].join('\n');

  return { zadeva, besedilo };
}

/* ── VRSTA ─────────────────────────────────────────────────────────────────

   Kdor ni odjavljen, ima e-naslov in mu še nismo pisali (ali je zapadel
   naslednji korak). Nikoli kontaktirani gredo prvi.
*/
async function vrsta(koliko) {
  const pogoji = [
    'select=id,business_name,email,phone,address,category,website,facebook_url,instagram_url,status,stikov,zadnji_stik_at,naslednji_korak_at,notes',
    'ne_kontaktiraj=is.false',
    'email=neq.',
    'or=(naslednji_korak_at.is.null,naslednji_korak_at.lte.' + new Date().toISOString().slice(0, 10) + ')',
    'order=zadnji_stik_at.nullsfirst,id.asc',
    'limit=' + koliko,
  ];
  const { podatki } = await baza('GET', '/leads?' + pogoji.join('&'));
  return podatki;
}

async function stikovDanes() {
  const zacetek = new Date();
  zacetek.setHours(0, 0, 0, 0);
  const { obseg } = await baza(
    'GET',
    '/sb_lead_stiki?select=id&smer=eq.odhod&zgodilo_at=gte.' + zacetek.toISOString(),
    null,
    { Prefer: 'count=exact', Range: '0-0' }
  );
  return Number((obseg || '/0').split('/')[1]) || 0;
}

/* ── STREŽNIK ─────────────────────────────────────────────────────────────── */

const preberiTelo = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
});

const streznik = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const odgovori = (koda, telo) => {
    res.writeHead(koda, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(telo));
  };

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'nagovor.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/api/vrsta') {
      const [leadi, danes] = await Promise.all([vrsta(Number(url.searchParams.get('koliko')) || 25), stikovDanes()]);
      return odgovori(200, {
        danes,
        naDan: NA_DAN,
        leadi: leadi.map((l) => ({ ...l, posta: sestaviPosto(l) })),
      });
    }

    // Zabeleži, kaj si naredil. Edini zapis, ki ga to orodje naredi v dnevnik.
    if (req.method === 'POST' && url.pathname === '/api/stik') {
      const t = await preberiTelo(req);
      if (!t.lead_id || !t.kanal) return odgovori(400, { napaka: 'Manjka lead_id ali kanal' });
      const { podatki } = await baza('POST', '/sb_lead_stiki', {
        lead_id: t.lead_id,
        kanal: t.kanal,
        smer: 'odhod',
        izid: t.izid || 'poslano',
        zadeva: t.zadeva || null,
        priponka: t.priponka || null,
        opomba: t.opomba || null,
      }, { Prefer: 'return=representation' });
      return odgovori(200, { ok: true, stik: podatki && podatki[0] });
    }

    // Dopolnitev podatkov o lokalu — največ dela bo prav tu, ker sta FB in IG prazna.
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/lead/')) {
      const id = url.pathname.split('/').pop();
      const t = await preberiTelo(req);
      const dovoljeno = ['email', 'phone', 'address', 'facebook_url', 'instagram_url', 'notes', 'naslednji_korak_at'];
      const spremembe = {};
      for (const k of dovoljeno) if (t[k] !== undefined) spremembe[k] = t[k] === '' ? null : t[k];
      if (!Object.keys(spremembe).length) return odgovori(400, { napaka: 'Nič za spremeniti' });
      await baza('PATCH', '/leads?id=eq.' + encodeURIComponent(id), spremembe);
      return odgovori(200, { ok: true });
    }

    // Odjava. Ločena od statusa, da je ponastavitev ne more povoziti.
    if (req.method === 'POST' && url.pathname.startsWith('/api/ne-kontaktiraj/')) {
      const id = url.pathname.split('/').pop();
      const t = await preberiTelo(req);
      await baza('PATCH', '/leads?id=eq.' + encodeURIComponent(id), {
        ne_kontaktiraj: true,
        ne_kontaktiraj_razlog: t.razlog || 'Označeno ročno v konzoli',
      });
      return odgovori(200, { ok: true });
    }

    odgovori(404, { napaka: 'Ni take poti' });
  } catch (err) {
    odgovori(500, { napaka: err.message });
  }
});

/*
  Samo 127.0.0.1. Orodje ima v rokah service_role ključ in seznam 4057
  podjetij; na 0.0.0.0 bi bilo dosegljivo vsakomur v istem omrežju.
*/
streznik.listen(VRATA, '127.0.0.1', () => {
  console.log('\n  Nagovor — lokalna konzola');
  console.log('  http://127.0.0.1:' + VRATA);
  console.log('\n  Ne pošilja ničesar. Pripravi besedilo, ti pošlješ iz svojega predala.');
  console.log('  Dnevna meja: ' + NA_DAN + ' odhodnih stikov.\n');
});
