/*
  Ogrodje za preizkušanje plošče leads.html brez brskalnika.

  ZAKAJ TAKO

    Preizkusi, ki berejo kodo z regexom, potrdijo, da je nekje zapisana
    prava beseda — ne, da stran deluje. Tu se zato naloži pravi <script>
    iz leads.html, ob njem pa toliko brskalnika, kolikor ga stran res
    uporablja: getElementById, vrednosti polj, innerHTML, razredi.

    Zraven teče pravi strežnik na svojih vratih z lastnim ADMIN_API_KEY,
    ki živi samo v tem procesu. Master gesla preizkusi ne potrebujejo in
    ga ne smejo potrebovati.

  MEJE

    Ni postavitve, ni CSS, ni pravih dogodkov. Kar tu drži, drži o logiki
    strani; kako je videti, se mora pogledati v brskalniku.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const KOREN = path.join(__dirname, '..');

/* ── Majhen DOM, ravno toliko, da stran teče ─────────────────────────── */
function narediDom() {
  const elementi = new Map();
  const nared = (id) => {
    const el = {
      id, value: '', textContent: '', innerHTML: '', className: '',
      style: {}, disabled: false, checked: false,
      classList: {
        _v: new Set(),
        add(c) { this._v.add(c); }, remove(c) { this._v.delete(c); },
        contains(c) { return this._v.has(c); },
      },
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
  return { document, elementi, shramba };
}

/*
  Naloži stran. `odgovori` je predmet z odgovori na vprašanja, ki jih stran
  postavi uporabniku: confirm (privzeto da) in prompt (privzeto besedilo).
*/
function naloziStran(fetchStub, odgovori = {}) {
  const html = fs.readFileSync(path.join(KOREN, 'public', 'leads.html'), 'utf8');
  const koda = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const dom = narediDom();
  const vprasanja = [];
  const okolje = {
    document: dom.document,
    sessionStorage: dom.shramba,
    localStorage: dom.shramba,
    fetch: fetchStub,
    setTimeout, clearTimeout, console,
    location: { href: '', reload() {} },
    alert() {},
    confirm: (t) => { vprasanja.push({ vrsta: 'confirm', t }); return odgovori.confirm !== false; },
    prompt: (t, d) => { vprasanja.push({ vrsta: 'prompt', t }); return odgovori.prompt === undefined ? d : odgovori.prompt; },
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
  const vrstice = () => dom.document.getElementById('leads-tbody').innerHTML;
  return { okolje, dom, html, izvedi, vrstice, vprasanja };
}

/* ── Strežnik ────────────────────────────────────────────────────────── */
function zazeni(vrata, kljuc) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(KOREN, 'server.js')], {
      cwd: KOREN,
      env: { ...process.env, PORT: String(vrata), ADMIN_API_KEY: kljuc, NODE_ENV: 'test' },
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

/*
  fetch, ki ga vidi stran: pelje na lokalni strežnik, doda ključ (stran
  sicer pošlje master sejo, te pa tu nimamo) in zapiše, kaj je poslala.
*/
function naredFetch(vrata, kljuc, dnevnik) {
  let vTeku = 0;
  const f = async (pot, moznosti = {}) => {
    const glave = { ...(moznosti.headers || {}), 'x-api-key': kljuc };
    delete glave.Authorization;
    if (dnevnik) dnevnik.push({ pot, nacin: moznosti.method || 'GET', telo: moznosti.body ? JSON.parse(moznosti.body) : null });
    vTeku += 1;
    try { return await fetch('http://127.0.0.1:' + vrata + pot, { ...moznosti, headers: glave }); }
    finally { vTeku -= 1; }
  };
  /*
    Stran po vsakem posegu sama osveži seznam. Če strežnik ubijemo sredi
    tega klica, pade s ECONNRESET in izpis izgleda, kot da je nekaj narobe.
  */
  f.pocakaj = async () => { for (let i = 0; vTeku && i < 600; i += 1) await new Promise((r) => setTimeout(r, 100)); };
  return f;
}

/* ── Trditve ─────────────────────────────────────────────────────────── */
function stevec() {
  const s = { ok: 0, napake: [] };
  s.trdi = (opis, pogoj, dodatek) => {
    if (pogoj) { s.ok += 1; console.log('  ✓ ' + opis); }
    else {
      s.napake.push(opis + (dodatek ? ' — ' + dodatek : ''));
      console.log('  ✖ ' + opis + (dodatek ? ' — ' + dodatek : ''));
    }
  };
  s.konec = () => {
    console.log('\n  ' + s.ok + ' trditev drži' + (s.napake.length ? ', ' + s.napake.length + ' pade' : '') + '\n');
    if (s.napake.length) { for (const n of s.napake) console.log('   ✖ ' + n); process.exit(1); }
  };
  return s;
}

/* ── Supabase naravnost, za pripravo in pospravljanje ────────────────── */
const SB = process.env.SUPABASE_URL;
const SBK = process.env.SUPABASE_KEY;
const SBH = { apikey: SBK, Authorization: 'Bearer ' + SBK, 'Content-Type': 'application/json' };

async function sb(nacin, pot, telo) {
  const r = await fetch(SB + '/rest/v1' + pot, {
    method: nacin,
    headers: { ...SBH, Prefer: 'return=representation' },
    body: telo ? JSON.stringify(telo) : undefined,
  });
  const besedilo = await r.text();
  if (!r.ok) throw new Error(nacin + ' ' + pot + ' → ' + r.status + ' ' + besedilo.slice(0, 200));
  return besedilo ? JSON.parse(besedilo) : [];
}

module.exports = { KOREN, naloziStran, zazeni, naredFetch, stevec, sb, SB, SBK, SBH };
