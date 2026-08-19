/*
  Preveri dve varnostni lastnosti prijave:

    1. omejevanje poskusov (brute force) na vseh prijavnih poteh
    2. preklic seje ob odjavi — ukraden žeton po odjavi ne sme več delati

  Druga preverba potrebuje stolpca sessions_valid_from; če ju ni, to javi
  in preskoči, namesto da bi tiho pokazala zeleno.

    set FT_MASTER_EMAIL=...&& set FT_MASTER_PASS=...
    node tools/preveri-varnost.js [--host=flowtiq.si]

  Privzeto teče proti lokalnemu strežniku. Za prijave uporablja izmišljene
  e-naslove, da ne zaklene pravega računa; izjema je preverba odjave, ki se
  mora prijaviti zares.

  POZOR: peta preverba se odjavi, odjava pa velja za vse naprave. Ko bosta
  stolpca dodana, te bo ta zagon odjavil iz odprtih admin zavihkov.
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const https = require('https');

const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
const HOST = arg('host');
const VRATA = parseInt(process.env.PORT) || 3010;
const EMAIL = process.env.FT_MASTER_EMAIL;
const GESLO = process.env.FT_MASTER_PASS;

function zahteva(pot, telo, glave) {
  const body = telo ? JSON.stringify(telo) : null;
  const opt = {
    path: pot, method: telo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...(glave || {}) }
  };
  const mod = HOST ? https : http;
  if (HOST) opt.host = HOST; else { opt.host = '127.0.0.1'; opt.port = VRATA; }
  return new Promise((res, rej) => {
    const r = mod.request(opt, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => { try { res({ koda: x.statusCode, telo: JSON.parse(d || '{}'), glave: x.headers }); } catch { res({ koda: x.statusCode, telo: d.slice(0, 120), glave: x.headers }); } });
    });
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}

let napak = 0, preskoceno = 0;
const trdi = (o, a, b) => {
  const ok = String(a) === String(b);
  if (!ok) napak++;
  console.log('    ' + (ok ? 'OK ' : '!! ') + o.padEnd(46) + String(a).padEnd(12) + (ok ? '' : '(pričakovano ' + b + ')'));
};
const nakljucni = () => Math.random().toString(36).slice(2, 8);

(async () => {
  console.log('cilj: ' + (HOST ? 'https://' + HOST : 'http://localhost:' + VRATA) + '\n');

  // ── 1. omejevanje poskusov ────────────────────────────────────────────────
  console.log('1) prijava z e-pošto: 10 poskusov na 15 min po identiteti');
  const lazni = 'preizkus-' + nakljucni() + '@primer.si';
  const kode = [];
  for (let i = 1; i <= 12; i++) {
    const r = await zahteva('/api/auth/master-login', { email: lazni, password: 'napacno' + i });
    kode.push(r.koda);
    if (i === 10) trdi('10. poskus še dovoljen', r.koda, 401);
    if (i === 11) {
      trdi('11. poskus zavrnjen', r.koda, 429);
      trdi('glava Retry-After', !!r.glave['retry-after'], 'true');
    }
  }
  console.log('    kode: ' + kode.join(' '));

  console.log('\n2) omejitev je vezana na račun, ne na vse hkrati');
  const drug = await zahteva('/api/auth/master-login', { email: 'drug-' + nakljucni() + '@primer.si', password: 'x' });
  trdi('drug račun ni zaklenjen', drug.koda, 401);

  console.log('\n3) ponarejen x-forwarded-for ne obide omejitve');
  const spoof = await zahteva('/api/auth/master-login', { email: lazni, password: 'x' },
    { 'x-forwarded-for': '9.9.9.' + Math.floor(Math.random() * 250) });
  trdi('še vedno zavrnjeno', spoof.koda, 429);

  console.log('\n4) OTP: 5 zahtev na 15 min po telefonu');
  const tel = '38640' + Math.floor(100000 + Math.random() * 899999);
  const otp = [];
  for (let i = 1; i <= 7; i++) otp.push((await zahteva('/api/auth/start', { phone: tel })).koda);
  console.log('    kode: ' + otp.join(' '));
  trdi('6. zahteva zavrnjena', otp[5], 429);

  // ── 2. preklic seje ob odjavi ─────────────────────────────────────────────
  console.log('\n5) odjava prekliče žeton');
  if (!EMAIL || !GESLO) {
    console.log('    — preskočeno: manjkata FT_MASTER_EMAIL in FT_MASTER_PASS');
    preskoceno++;
  } else {
    const p = await zahteva('/api/auth/master-login', { email: EMAIL, password: GESLO });
    if (p.koda !== 200 || !p.telo.token) {
      console.log('    — preskočeno: prijava ni uspela (' + p.koda + ')');
      preskoceno++;
    } else {
      const zeton = p.telo.token;
      const g = { Authorization: 'Bearer ' + zeton };

      const pred = await zahteva('/salons', null, g);
      trdi('žeton pred odjavo deluje', pred.koda, 200);

      await zahteva('/api/auth/logout', {}, g);

      const po = await zahteva('/salons', null, g);
      if (po.koda === 200) {
        napak++;
        console.log('    !! žeton po odjavi še vedno deluje                 200');
        console.log('       Najverjetneje manjkata stolpca. Poženi v Supabase SQL editorju:');
        console.log('         alter table public.sb_salons        add column if not exists sessions_valid_from timestamptz;');
        console.log('         alter table public.sb_master_admins add column if not exists sessions_valid_from timestamptz;');
      } else {
        trdi('žeton po odjavi ne deluje več', po.koda, 401);
      }
    }
  }

  console.log('\nnapak: ' + napak + (preskoceno ? '   preskočeno: ' + preskoceno : ''));
  process.exit(napak ? 1 : 0);
})().catch(e => { console.error('✖ ' + e.message); process.exit(1); });
