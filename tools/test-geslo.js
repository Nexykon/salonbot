/*
  Preizkus ponastavitve pozabljenega gesla lastnika.

    node tools/test-geslo.js

  ZAHTEVE
  - lokalni strežnik na :3010 (npm start)
  - pognana migracija 008
  - .env s SUPABASE_URL in SUPABASE_KEY

  Dela na lokalu "TEST Frizer" in stanje na koncu VRNE. E-naslov med
  preizkusom zamenja s testnim, zato pošta ne odide nikomur pravemu.

  POZOR: ponastavitev je omejena na 10 poskusov na uro na IP. Ta preizkus jih
  porabi približno šest, zato dva zagona zapored zadeneta omejitev. Omejevalnik
  je v pomnilniku — ponovni zagon strežnika ga sprosti.
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const a = require('axios');
const auth = require('../src/auth');

const BASE = process.env.SUPABASE_URL + '/rest/v1';
const H = { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_KEY };
const HJ = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
const LOKAL = 'TEST Frizer';
const POLJA = 'id,name,owner_email,owner_password_hash,owner_password_set_at,owner_reset_token_hash,owner_reset_expires_at,sessions_valid_from';

function api(pot, metoda, telo) {
  const b = telo ? JSON.stringify(telo) : null;
  return new Promise((res, rej) => {
    const q = http.request({ host: 'localhost', port: 3010, path: pot, method: metoda,
      headers: { 'Content-Type': 'application/json', ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {}) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ koda: x.statusCode, telo: JSON.parse(d || '{}') }); } catch { res({ koda: x.statusCode, telo: String(d).slice(0, 200) }); } }); });
    q.on('error', rej); if (b) q.write(b); q.end();
  });
}

let ok = 0, ni = 0;
const je = (opis, dobil, pric) => {
  if (JSON.stringify(dobil) === JSON.stringify(pric)) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil: ' + JSON.stringify(dobil) + '  pričakoval: ' + JSON.stringify(pric)); }
};
// Omejitev poskusov se pokaže kot 429 in bi sicer izgledala kot kaskada napak.
const preveriOmejitev = (r, kje) => {
  if (r && r.koda === 429) {
    console.error('\n✖ USTAVLJENO: strežnik je vrnil 429 pri ' + kje + '.'
      + '\n  Omejitev je 10 ponastavitev na uro na IP in ta preizkus jih porabi ~6.'
      + '\n  Znova zaženi strežnik (omejevalnik je v pomnilniku) in poskusi spet.');
    process.exit(2);
  }
  return r;
};

(async () => {
  const beri = async () => (await a.get(`${BASE}/sb_salons?select=${POLJA}&name=eq.${encodeURIComponent(LOKAL)}`, { headers: H })).data[0];
  const s0 = await beri();
  if (!s0) throw new Error('lokala "' + LOKAL + '" ni');
  if (!('owner_reset_token_hash' in s0)) throw new Error('stolpcev ni — poženi migracijo 008');
  console.log(LOKAL + ' pred: email=' + s0.owner_email + ', geslo nastavljeno=' + !!s0.owner_password_hash + '\n');

  const TESTNI_EMAIL = 'preizkus.ponastavitve@example.invalid';
  const STARO_GESLO = 'staro-geslo-za-preizkus';
  const NOVO_GESLO = 'novo-geslo-za-preizkus';

  // Pripravimo znano izhodišče (in s tem tudi zavarujemo pravi e-naslov)
  await a.patch(`${BASE}/sb_salons?id=eq.${s0.id}`, {
    owner_email: TESTNI_EMAIL,
    owner_password_hash: auth.hashPassword(STARO_GESLO),
    owner_reset_token_hash: null, owner_reset_expires_at: null
  }, { headers: HJ });

  console.log('1) zahteva za povezavo');
  je('brez e-naslova → 400', (await api('/api/auth/owner-forgot', 'POST', {})).koda, 400);
  let r = await api('/api/auth/owner-forgot', 'POST', { email: 'nikogar@example.invalid' });
  je('neznan e-naslov → 200 (enak odgovor)', r.koda, 200);
  je('… in ne razkrije, ali obstaja', /Če email obstaja/.test(r.telo.message || ''), true);

  r = await api('/api/auth/owner-forgot', 'POST', { email: TESTNI_EMAIL });
  je('znan e-naslov → 200', r.koda, 200);
  const s1 = await beri();
  je('odtis žetona zapisan', typeof s1.owner_reset_token_hash === 'string' && s1.owner_reset_token_hash.length >= 32, true);
  je('rok postavljen', !!s1.owner_reset_expires_at, true);
  const minut = Math.round((new Date(s1.owner_reset_expires_at) - new Date()) / 60000);
  je('rok je ~30 minut (' + minut + ')', minut >= 27 && minut <= 31, true);

  // Žetona iz pošte tu ne dobimo, zato ga podtaknemo sami: preverjamo ravnanje
  // strežnika z odtisom, ne pošiljanja pošte.
  const ZETON = 'a'.repeat(64);
  await a.patch(`${BASE}/sb_salons?id=eq.${s1.id}`, {
    owner_reset_token_hash: auth.hashToken(ZETON),
    owner_reset_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
  }, { headers: HJ });

  console.log('\n2) zavrnitve pri nastavitvi gesla');
  je('brez žetona → 400', (await api('/api/auth/owner-reset', 'POST', { password: NOVO_GESLO })).koda, 400);
  je('prekratko geslo → 400', (await api('/api/auth/owner-reset', 'POST', { token: ZETON, password: 'kratko' })).koda, 400);
  je('napačen žeton → 401', (await api('/api/auth/owner-reset', 'POST', { token: 'b'.repeat(64), password: NOVO_GESLO })).koda, 401);

  console.log('\n3) potekla povezava');
  await a.patch(`${BASE}/sb_salons?id=eq.${s1.id}`, {
    owner_reset_expires_at: new Date(Date.now() - 60 * 1000).toISOString()
  }, { headers: HJ });
  r = await api('/api/auth/owner-reset', 'POST', { token: ZETON, password: NOVO_GESLO });
  preveriOmejitev(r.koda === 429 ? r : null, 'potekli povezavi');
  je('potekel žeton → 401', r.koda, 401);
  // Odtisov ni mogoce primerjati (nakljucna sol) — preverimo z geslom.
  je('staro geslo še vedno velja', auth.verifyPassword(STARO_GESLO, (await beri()).owner_password_hash), true);

  console.log('\n4) uspešna ponastavitev');
  await a.patch(`${BASE}/sb_salons?id=eq.${s1.id}`, {
    owner_reset_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
  }, { headers: HJ });
  r = await api('/api/auth/owner-reset', 'POST', { token: ZETON, password: NOVO_GESLO });
  preveriOmejitev(r.koda === 429 ? r : null, 'uspešni ponastavitvi');
  je('HTTP 200', r.koda, 200);
  const s2 = await beri();
  je('novo geslo shranjeno', auth.verifyPassword(NOVO_GESLO, s2.owner_password_hash), true);
  je('staro geslo ne velja več', auth.verifyPassword(STARO_GESLO, s2.owner_password_hash), false);
  je('žeton pobrisan', s2.owner_reset_token_hash, null);
  je('rok pobrisan', s2.owner_reset_expires_at, null);
  je('seje preklicane (sessions_valid_from postavljen)', !!s2.sessions_valid_from, true);
  je('datum gesla zapisan', !!s2.owner_password_set_at, true);

  console.log('\n5) žetona ni mogoče uporabiti dvakrat');
  je('drugi poskus → 401', (await api('/api/auth/owner-reset', 'POST', { token: ZETON, password: 'se-eno-geslo-123' })).koda, 401);

  console.log('\n6) prijava z novim geslom deluje, s starim ne');
  je('novo geslo → 200', (await api('/api/auth/login', 'POST', { email: TESTNI_EMAIL, password: NOVO_GESLO })).koda, 200);
  je('staro geslo → 401', (await api('/api/auth/login', 'POST', { email: TESTNI_EMAIL, password: STARO_GESLO })).koda, 401);

  console.log('\n7) povrnitev prvotnega stanja');
  await a.patch(`${BASE}/sb_salons?id=eq.${s0.id}`, {
    owner_email: s0.owner_email,
    owner_password_hash: s0.owner_password_hash,
    owner_password_set_at: s0.owner_password_set_at,
    owner_reset_token_hash: s0.owner_reset_token_hash,
    owner_reset_expires_at: s0.owner_reset_expires_at,
    sessions_valid_from: s0.sessions_valid_from
  }, { headers: HJ });
  const konec = await beri();
  je('stanje vrnjeno', JSON.stringify(konec), JSON.stringify(s0));

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})().catch(e => { console.error('NAPAKA: ' + (e.response ? e.response.status + ' ' + JSON.stringify(e.response.data) : e.message)); process.exit(1); });
