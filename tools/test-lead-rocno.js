/*
  Ročno dodajanje leada: telefon in naslov gresta skozi vso pot.

      node tools/test-lead-rocno.js

  ZAKAJ OBSTAJA

    Obrazec "Dodaj ročno" je dolgo imel tri polja, uvoz seznama pa je
    telefon in naslov shranjeval. Kdor je lokal vpisal na roko, ga je
    torej vpisal brez telefona — in to se ni videlo nikjer, ker stolpca
    Telefon v tabeli ni bilo.

    Ob dodajanju polj se je pokazalo še eno: končna točka POST /api/leads
    je phone in address razpakirala stran. Obrazec bi ju pošiljal, strežnik
    bi ju tiho zavrgel, plošča pa bi kazala prazen stolpec — napaka, ki je
    videti kot "uporabnik pač ni vpisal telefona".

    Zato ta preizkus ne bere kode, ampak pelje pravo pot: pravi obrazec,
    pravi strežnik, prava baza, pravi izris tabele in pravo iskanje.

  KAJ POTREBUJE

    .env s SUPABASE_URL in SUPABASE_KEY. Strežnik se zažene lokalno na
    3099 z lastnim ADMIN_API_KEY, ki živi samo v tem procesu — master
    gesla ta preizkus ne potrebuje in ga ne sme potrebovati.

    Vrstica v bazi se na koncu pobriše, tudi če preizkus pade.
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const VRATA = 3099;
const KLJUC = 'preizkus-' + Math.random().toString(36).slice(2);
const KOREN = path.join(__dirname, '..');

const IME = 'PREIZKUS Gostilna Telefon';
const EPOSTA = 'preizkus.telefon@primer.invalid';
const TELEFON = '040 987 654';
const NASLOV = 'Glavna cesta 1, 4000 Kranj';

let ok = 0;
const napake = [];
function trdi(opis, pogoj, dodatek) {
  if (pogoj) { ok += 1; console.log('  ✓ ' + opis); }
  else { napake.push(opis + (dodatek ? ' — ' + dodatek : '')); console.log('  ✖ ' + opis + (dodatek ? ' — ' + dodatek : '')); }
}

/* ── Majhen DOM, ravno toliko, da stran teče ─────────────────────────── */
function narediDom(html) {
  const elementi = new Map();
  const nared = (id) => {
    const el = {
      id, value: '', textContent: '', innerHTML: '', className: '',
      style: {}, disabled: false,
      classList: { add() {}, remove() {} },
      addEventListener() {},
    };
    elementi.set(id, el);
    return el;
  };
  const document = {
    getElementById: (id) => elementi.get(id) || nared(id),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const shramba = { getItem: () => null, setItem() {}, removeItem() {} };
  return { document, elementi, shramba, html };
}

function naloziStran(fetchStub) {
  const html = fs.readFileSync(path.join(KOREN, 'public', 'leads.html'), 'utf8');
  const koda = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const dom = narediDom(html);
  const okolje = {
    document: dom.document,
    sessionStorage: dom.shramba,
    localStorage: dom.shramba,
    fetch: fetchStub,
    setTimeout, clearTimeout, console,
    location: { href: '', reload() {} },
    alert() {}, confirm: () => true,
    Date, Math, JSON, String, Number, Array, Object, RegExp, Error, Boolean, Promise,
  };
  okolje.window = okolje;
  vm.createContext(okolje);
  vm.runInContext(koda, okolje, { filename: 'leads.html' });
  /*
    allLeads in currentSearch sta na strani deklarirana z let, zato ne
    obstajata kot lastnosti peskovnika — brati in pisati ju je mogoče samo
    z izrazom, ki teče v istem obsegu. Brez tega bi zunanji zapis naredil
    drugo spremenljivko, stran pa bi še naprej gledala svojo, prazno.
  */
  const izvedi = (izraz) => vm.runInContext(izraz, okolje, { filename: 'leads.html (preizkus)' });
  return { okolje, dom, html, izvedi };
}

/* ── Strežnik ────────────────────────────────────────────────────────── */
function zazeni() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(KOREN, 'server.js')], {
      cwd: KOREN,
      env: { ...process.env, PORT: String(VRATA), ADMIN_API_KEY: KLJUC, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let izpis = '';
    const cakaj = setTimeout(() => reject(new Error('strežnik se ni zagnal:\n' + izpis)), 30000);
    p.stdout.on('data', (d) => {
      izpis += d;
      if (izpis.includes('running on port')) { clearTimeout(cakaj); resolve(p); }
    });
    p.stderr.on('data', (d) => { izpis += d; });
    p.on('exit', (c) => { clearTimeout(cakaj); reject(new Error('strežnik je končal s kodo ' + c + ':\n' + izpis)); });
  });
}

const SB = process.env.SUPABASE_URL;
const SBK = process.env.SUPABASE_KEY;
const SBH = { apikey: SBK, Authorization: 'Bearer ' + SBK, 'Content-Type': 'application/json' };

async function pocisti() {
  if (!SB || !SBK) return 0;
  const r = await fetch(SB + '/rest/v1/leads?business_name=eq.' + encodeURIComponent(IME),
    { method: 'DELETE', headers: { ...SBH, Prefer: 'return=representation' } });
  return r.ok ? (await r.json()).length : -1;
}

(async () => {
  if (!SB || !SBK) { console.error('Manjka SUPABASE_URL ali SUPABASE_KEY.'); process.exit(1); }

  await pocisti(); // ostanki prejšnjega neuspelega zagona
  const streznik = await zazeni();
  let zadnjeTelo = null;

  try {
    /*
      fetch, ki ga vidi stran: doda ključ (stran sicer pošlje master sejo,
      te pa tu nimamo) in zapiše telo, da se vidi, kaj je obrazec res poslal.
    */
    let vTeku = 0;
    const mojFetch = async (pot, moznosti = {}) => {
      const glave = { ...(moznosti.headers || {}), 'x-api-key': KLJUC };
      delete glave.Authorization;
      if (moznosti.body) zadnjeTelo = { pot, telo: JSON.parse(moznosti.body) };
      vTeku += 1;
      try { return await fetch('http://127.0.0.1:' + VRATA + pot, { ...moznosti, headers: glave }); }
      finally { vTeku -= 1; }
    };
    /*
      Stran po dodajanju sama osveži seznam. Če strežnik ubijemo sredi tega
      klica, pade s ECONNRESET in izpis izgleda, kot da je nekaj narobe.
    */
    const pocakajNaStran = async () => {
      for (let i = 0; vTeku && i < 600; i += 1) await new Promise((r) => setTimeout(r, 100));
    };

    console.log('\n1. Obrazec');
    const { okolje, dom, izvedi } = naloziStran(mojFetch);

    trdi('polje m-phone obstaja v HTML', dom.html.includes('id="m-phone"'));
    trdi('polje m-address obstaja v HTML', dom.html.includes('id="m-address"'));
    trdi('stolpec Telefon je v glavi tabele', /<th>Email<\/th>\s*<th>Telefon<\/th>/.test(dom.html));

    // Vpis v obrazec, kot bi ga natipkal človek.
    dom.document.getElementById('m-name').value = IME;
    dom.document.getElementById('m-email').value = EPOSTA;
    dom.document.getElementById('m-phone').value = TELEFON;
    dom.document.getElementById('m-address').value = NASLOV;
    dom.document.getElementById('m-cat').value = 'RESTAVRACIJE';

    console.log('\n2. Kaj obrazec pošlje');
    await okolje.addManual();
    trdi('klic je šel na /api/leads', zadnjeTelo && zadnjeTelo.pot === '/api/leads', zadnjeTelo ? zadnjeTelo.pot : 'ni klica');
    trdi('v telesu je telefon iz polja', zadnjeTelo && zadnjeTelo.telo.phone === TELEFON, zadnjeTelo && JSON.stringify(zadnjeTelo.telo.phone));
    trdi('v telesu je naslov iz polja', zadnjeTelo && zadnjeTelo.telo.address === NASLOV, zadnjeTelo && JSON.stringify(zadnjeTelo.telo.address));
    trdi('polja so po uspehu prazna', dom.document.getElementById('m-phone').value === '' && dom.document.getElementById('m-address').value === '');

    console.log('\n3. Kaj je pristalo v bazi');
    const r = await fetch(SB + '/rest/v1/leads?select=*&business_name=eq.' + encodeURIComponent(IME), { headers: SBH });
    const vrstice = await r.json();
    trdi('lead je v bazi', vrstice.length === 1, 'najdenih ' + vrstice.length);
    const l = vrstice[0] || {};
    trdi('telefon je shranjen', l.phone === TELEFON, JSON.stringify(l.phone));
    trdi('naslov je shranjen', l.address === NASLOV, JSON.stringify(l.address));

    console.log('\n4. Izris tabele');
    await pocakajNaStran(); // da osvežitev po dodajanju ne povozi seznama
    izvedi('allLeads = ' + JSON.stringify(vrstice) + '; currentPage = 1; renderTable();');
    const tbody = dom.document.getElementById('leads-tbody').innerHTML;
    trdi('telefon je v vrstici', tbody.includes(TELEFON));
    trdi('telefon je klicljiv (tel:)', tbody.includes('href="tel:040987654"'), tbody.match(/href="tel:[^"]*"/) || '');
    trdi('naslov je v vrstici', tbody.includes(NASLOV));

    console.log('\n5. Iskanje po telefonski številki');
    for (const niz of ['040 987 654', '987 654', '040 987']) {
      okolje.setSearch(niz);
      const izris = dom.document.getElementById('leads-tbody').innerHTML;
      trdi('»' + niz + '« najde lokal', izris.includes(IME));
    }
    okolje.setSearch('041 111 222');
    trdi('tuja številka ga ne najde', !dom.document.getElementById('leads-tbody').innerHTML.includes(IME));

    /*
      Meja, ki jo je vredno poznati: iskanje primerja dobesedno, zato
      "040987654" ne najde številke, zapisane s presledki. Preizkus to
      trdi namenoma — če se kdaj doda normalizacija, ta vrstica pade in
      opozori, da jo je treba popraviti, ne obratno.
    */
    okolje.setSearch('040987654');
    trdi('strnjen zapis (brez presledkov) NE najde — znana meja',
      !dom.document.getElementById('leads-tbody').innerHTML.includes(IME));
  } finally {
    await new Promise((r) => setTimeout(r, 200));
    streznik.kill();
    const pobrisano = await pocisti();
    console.log('\n  počiščeno vrstic: ' + pobrisano);
  }

  console.log('\n  ' + ok + ' trditev drži' + (napake.length ? ', ' + napake.length + ' pade' : '') + '\n');
  if (napake.length) { for (const n of napake) console.log('   ✖ ' + n); process.exit(1); }
})().catch((e) => { console.error('\nnapaka: ' + e.message); process.exit(1); });
