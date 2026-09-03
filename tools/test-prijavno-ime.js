/*
  Preizkus: prijavno ime ne sme delovati kot vzorec.

    node tools/test-prijavno-ime.js          (potrebuje .env in strežnik na 3010)

  PostgREST pri "ilike" pretvori "*" v "%". Dokler je prijava iskala z
  "ilike", je vnos "*" ujel VSE lokale — /api/auth/login je geslo primerjal z
  zgoščenko vsakega, /api/auth/owner-forgot pa je prepisal žetone za
  ponastavitev pri vseh hkrati.

  Preizkus ne ugiba nobenega gesla: uporablja namenoma napačno.
  Pred klicem owner-forgot naredi posnetek polj za ponastavitev in na koncu
  preveri, da se NISO spremenila.
*/
require('dotenv').config();
const db = require('../src/supabase');

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const STREZNIK = process.env.TEST_BASE || 'http://localhost:3010';

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const posnetek = async () => {
  const r = await fetch(URL + '/rest/v1/sb_salons?select=id,name,owner_email,owner_reset_token_hash,owner_reset_expires_at&order=name', { headers: H });
  return await r.json();
};

(async () => {
  const pred = await posnetek();
  if (!Array.isArray(pred) || !pred.length) { console.log('Ni dostopa do baze — preizkus preskočen.'); process.exit(0); }
  console.log('lokalov v bazi: ' + pred.length);

  console.log('\n1) Iskanje po prijavnem imenu (src/supabase.js)');
  const imena = (s) => s.map(x => x.name).sort();
  // Prijavno ime testnega lokala je bil nekoč "test" (brez @); zdaj je pravi
  // e-naslov, ker prijavno ime, ki ni e-naslov, zamegli vse ostalo.
  const IME = 'test-picerija@flowtek.si';
  je('pravo ime najde svoj lokal', imena(await db.getSalonsByOwnerEmail(IME)), ['Test Picerija']);
  je('velike črke ne motijo', imena(await db.getSalonsByOwnerEmail(IME.toUpperCase())), ['Test Picerija']);
  je('presledki ne motijo', imena(await db.getSalonsByOwnerEmail('  ' + IME + '  ')), ['Test Picerija']);
  je('staro ime "test" ne najde ničesar', await db.getSalonsByOwnerEmail('test'), []);
  for (const vzorec of ['*', '%', '*@*', '*@gmail.com', 'te*', '_' .repeat(4), 'tes_', '\\']) {
    je('vzorec "' + vzorec + '" ne najde ničesar', await db.getSalonsByOwnerEmail(vzorec), []);
  }
  je('prazen vnos ne najde ničesar', await db.getSalonsByOwnerEmail(''), []);
  je('en lokal: pravo ime', (await db.getSalonByOwnerEmail(IME) || {}).name, 'Test Picerija');
  je('en lokal: vzorec je nič', await db.getSalonByOwnerEmail('*'), null);

  console.log('\n2) Prijava (/api/auth/login) z vzorcem');
  const prijava = async (email) => {
    const r = await fetch(STREZNIK + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'zagotovo-napacno-geslo-za-preizkus' })
    }).catch(() => null);
    return r ? r.status : 0;
  };
  const koda = await prijava('*');
  if (!koda) { console.log('  (strežnik na ' + STREZNIK + ' ne odgovarja — 2) in 3) preskočena)'); }
  else {
    je('vzorec "*" → 401', koda, 401);
    je('vzorec "%" → 401', await prijava('%'), 401);
    je('neobstoječe ime → 401', await prijava('nekaj.cesar.ni@example.invalid'), 401);

    console.log('\n3) Pozabljeno geslo (/api/auth/owner-forgot) z vzorcem');
    const r = await fetch(STREZNIK + '/api/auth/owner-forgot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '*' })
    }).catch(() => null);
    je('odgovor je enak kot vedno (ne razkrije ničesar)', r ? r.status : 0, 200);
    const po = await posnetek();
    const spremenjeni = po.filter(s => {
      const p = pred.find(x => x.id === s.id) || {};
      return p.owner_reset_token_hash !== s.owner_reset_token_hash
        || p.owner_reset_expires_at !== s.owner_reset_expires_at;
    }).map(s => s.name);
    je('nobenemu lokalu ni prepisalo žetona za ponastavitev', spremenjeni, []);
  }

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
