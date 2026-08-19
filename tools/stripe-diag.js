/*
  Kaj o Stripu vidi NAŠ STREŽNIK — lokalni ali produkcijski.

  Razlika od tools/stripe-stanje.js: tisti gleda Stripe neposredno s ključem
  iz .env, ta pa vpraša strežnik, kako je pri njem. Za razhroščevanje okolja
  (Railway spremenljivke) je pomemben ta drugi pogled — trikrat smo stanje
  sklepali iz vedenja endpointov in se enkrat zmotili.

  Izpiše obliko ključa (nikoli ključa samega), način in ali se cene razrešijo
  po lookup_key — po isti poti, kot jih najde checkout.

    set FT_MASTER_EMAIL=...&& set FT_MASTER_PASS=...
    node tools/stripe-diag.js                  # lokalni strežnik
    node tools/stripe-diag.js --host=flowtiq.si
*/
const http = require('http');
const https = require('https');

const HOST = (process.argv.find(a => a.startsWith('--host=')) || '').split('=')[1];
const EMAIL = process.env.FT_MASTER_EMAIL;
const GESLO = process.env.FT_MASTER_PASS;
const VRATA = parseInt(process.env.PORT) || 3010;

if (!EMAIL || !GESLO) {
  console.error('✖ Manjkata FT_MASTER_EMAIL in FT_MASTER_PASS v okolju.');
  process.exit(1);
}

function zahteva(pot, telo, zeton) {
  const b = telo ? JSON.stringify(telo) : null;
  const mod = HOST ? https : http;
  const opt = {
    path: pot, method: telo ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {}),
      ...(zeton ? { Authorization: 'Bearer ' + zeton } : {})
    }
  };
  if (HOST) opt.host = HOST; else { opt.host = '127.0.0.1'; opt.port = VRATA; }
  return new Promise((res, rej) => {
    const q = mod.request(opt, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => { try { res({ koda: x.statusCode, telo: JSON.parse(d || '{}') }); } catch { res({ koda: x.statusCode, telo: d.slice(0, 200) }); } });
    });
    q.on('error', rej);
    if (b) q.write(b);
    q.end();
  });
}

(async () => {
  const cilj = HOST ? 'https://' + HOST : 'http://localhost:' + VRATA;
  console.log('strežnik: ' + cilj + '\n');

  const p = await zahteva('/api/auth/master-login', { email: EMAIL, password: GESLO });
  if (p.koda !== 200 || !p.telo.token) {
    console.error('✖ prijava ni uspela: ' + p.koda + ' ' + JSON.stringify(p.telo)
      + (p.koda === 429 ? '\n  (omejitev poskusov — počakaj nekaj minut)' : ''));
    process.exit(1);
  }

  const s = await zahteva('/api/admin/stripe-stanje', null, p.telo.token);
  if (s.koda !== 200) {
    console.error('✖ diagnostika ni dosegljiva: ' + s.koda + ' ' + JSON.stringify(s.telo)
      + '\n  (če je 404, strežnik še teče na stari različici)');
    process.exit(1);
  }

  const k = s.telo.kljuc || {};
  console.log('ključ:  ' + (k.opis === 'ni nastavljen' ? '✖ NI NASTAVLJEN'
    : (k.ok ? 'OK ' : '✖ ') + (k.zivi ? '⚠ ŽIVI' : 'testni') + ', ' + k.dolzina + ' znakov — ' + k.opis));

  console.log('\ncene po lookup_key:');
  let napak = 0;
  for (const [lk, v] of Object.entries(s.telo.cene || {})) {
    const ok = String(v).startsWith('price_');
    if (!ok) napak++;
    console.log('  ' + (ok ? 'OK ' : '✖ ') + lk.padEnd(16) + v);
  }

  if (s.telo.napaka) {
    console.log('\nnapaka pri klicu v Stripe:\n  ' + s.telo.napaka);
    napak++;
  }

  console.log('\n' + (napak ? '✖ težav: ' + napak : '✔ vse v redu'));
  process.exit(napak ? 1 : 0);
})().catch(e => { console.error('✖ ' + e.message); process.exit(1); });
