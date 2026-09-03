/*
  Preizkus kartičnega plačila v TESTNEM načinu Stripa, konec do konca.

  Preveri tisto, česar tools/test-sinhronizacija.js ne more, ker tam Stripa
  podtaknemo: da so price ID-ji pravi, da checkout seja res nastane s pravim
  zneskom in da gre salon_id v metapodatke.

    set FT_MASTER_EMAIL=...&& set FT_MASTER_PASS=...
    node tools/test-checkout.js <salon_id> [--placaj]

  --placaj po ustvarjeni seji še ustvari naročnino s testno kartico in požene
  uskladitev, da se preveri celotna pot do zapisa v bazo. Brez tega samo
  preveri sejo in ničesar ne zapiše.

  Skripta se ustavi, če ključ v .env ni sk_test_ — da ne more sprožiti
  pravega plačila.
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const plans = require('../src/plans');
const db = require('../src/supabase');

const KEY = process.env.STRIPE_SECRET_KEY || '';
if (!KEY.startsWith('sk_test_')) {
  console.error('✖ V .env ni testnega ključa (sk_test_). Ustavljam se, da ne sprožim pravega plačila.');
  process.exit(1);
}

const SALON_ID = process.argv.slice(2).find(a => !a.startsWith('--'));
const PLACAJ = process.argv.includes('--placaj');
const EMAIL = process.env.FT_MASTER_EMAIL;
const GESLO = process.env.FT_MASTER_PASS;
const VRATA = parseInt(process.env.PORT) || 3010;

if (!SALON_ID) { console.error('✖ Manjka salon_id.'); process.exit(1); }
if (!EMAIL || !GESLO) {
  console.error('✖ Manjkata FT_MASTER_EMAIL in FT_MASTER_PASS v okolju.');
  console.error('  Gesla namenoma ne beremo iz datoteke v repozitoriju.');
  process.exit(1);
}

const stripe = require('stripe')(KEY);

function zahteva(pot, telo, zeton) {
  const body = telo ? JSON.stringify(telo) : null;
  return new Promise((res, rej) => {
    const r = http.request({
      host: '127.0.0.1', port: VRATA, path: pot, method: telo ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(zeton ? { Authorization: 'Bearer ' + zeton } : {})
      }
    }, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => { try { res({ koda: x.statusCode, telo: JSON.parse(d || '{}') }); } catch { res({ koda: x.statusCode, telo: d }); } });
    });
    r.on('error', e => rej(new Error('strežnik na :' + VRATA + ' ne odgovarja — ' + e.message)));
    if (body) r.write(body);
    r.end();
  });
}

let napak = 0;
const trdi = (opis, a, b) => {
  const ok = String(a) === String(b);
  if (!ok) napak++;
  console.log('    ' + (ok ? 'OK ' : '!! ') + opis.padEnd(28) + String(a).padEnd(34) + (ok ? '' : '(pričakovano ' + b + ')'));
};
const dan = v => (v ? String(v).slice(0, 10) : String(v));

async function priceId(paket, obdobje) {
  const r = await stripe.prices.list({ lookup_keys: [plans.lookupKey(paket, obdobje)], limit: 1 });
  return r.data[0]?.id;
}

(async () => {
  console.log('način: testni   lokal: ' + SALON_ID + '\n');

  console.log('1) prijava kot master');
  const p = await zahteva('/api/auth/master-login', { email: EMAIL, password: GESLO });
  if (p.koda !== 200 || !p.telo.token) {
    console.error('   ✖ prijava ni uspela: ' + p.koda + ' ' + JSON.stringify(p.telo)); process.exit(1);
  }
  const zeton = p.telo.token;
  console.log('    OK  žeton pridobljen');

  for (const [paket, obdobje] of [['ai', 'monthly'], ['premium', 'yearly']]) {
    console.log('\n2) checkout seja: ' + paket + ' / ' + obdobje);
    const c = await zahteva('/api/billing/checkout', { salonId: SALON_ID, plan: paket, billing_period: obdobje }, zeton);
    if (c.koda !== 200 || !c.telo.url) { napak++; console.log('    !! HTTP ' + c.koda + ' ' + JSON.stringify(c.telo)); continue; }

    const id = (String(c.telo.url).match(/\/(cs_[A-Za-z0-9_]+)/) || [])[1];
    const seja = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] });

    trdi('način', seja.mode, 'subscription');
    trdi('valuta', seja.currency, 'eur');
    trdi('znesek (centov)', seja.amount_total, plans.priceCents(paket, obdobje));
    trdi('salon_id v metadata', seja.metadata?.salon_id, SALON_ID);
    trdi('paket v metadata', seja.metadata?.plan, paket);
    const li = seja.line_items?.data?.[0];
    trdi('price ID', li?.price?.id, await priceId(paket, obdobje));
    trdi('interval', li?.price?.recurring?.interval, obdobje === 'yearly' ? 'year' : 'month');
  }

  if (!PLACAJ) {
    console.log('\n' + '─'.repeat(72));
    console.log(napak ? '✖ napak: ' + napak : '✔ seje so pravilne (brez plačila; za celotno pot dodaj --placaj)');
    process.exit(napak ? 1 : 0);
  }

  /*
    Dokončanje plačila. Checkout seje prek API-ja ni mogoče "klikniti", zato
    ustvarimo enako naročnino, kot bi nastala po plačilu: kupec s testno
    kartico + naročnina na isto ceno, s salon_id v metapodatkih.
  */
  console.log('\n3) plačilo s testno kartico 4242 4242 4242 4242');
  const salon = await db.getSalonById(SALON_ID);
  const pm = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' }        // uradni testni žeton za 4242…
  });
  const kupec = await stripe.customers.create({
    email: salon.owner_email || 'test@flowtek.si',
    name: salon.name,
    payment_method: pm.id,
    invoice_settings: { default_payment_method: pm.id },
    metadata: { flowtek_test: 'da', salon_id: SALON_ID }
  });
  const narocnina = await stripe.subscriptions.create({
    customer: kupec.id,
    items: [{ price: await priceId('ai', 'monthly') }],
    metadata: { salon_id: SALON_ID, plan: 'ai' },
    expand: ['items.data.price']
  });
  console.log('    kupec ' + kupec.id + '   naročnina ' + narocnina.id + '   status ' + narocnina.status);
  trdi('naročnina aktivna', narocnina.status, 'active');

  console.log('\n4) uskladitev prebere stanje iz Stripa');
  const sync = require('../src/stripe-sync');
  const r = await sync.sinhronizirajVse();
  trdi('naših lokalov', r.nasih, 1);

  const s = await db.getSalonById(SALON_ID);
  trdi('subscription_status', s.subscription_status, 'active');
  trdi('billing_status', s.billing_status, 'paid');
  trdi('subscription_plan', s.subscription_plan, 'ai');
  trdi('billing_period', s.billing_period, 'monthly');
  trdi('stripe_customer_id', s.stripe_customer_id, kupec.id);
  trdi('stripe_subscription_id', s.stripe_subscription_id, narocnina.id);
  const konec = new Date(narocnina.current_period_end * 1000 || narocnina.items.data[0].current_period_end * 1000);
  trdi('valid_until', dan(s.valid_until), dan(konec.toISOString()));

  console.log('\n5) odpoved in ponovna uskladitev');
  await stripe.subscriptions.cancel(narocnina.id);
  await sync.sinhronizirajVse();
  const s2 = await db.getSalonById(SALON_ID);
  trdi('subscription_status', s2.subscription_status, 'inactive');

  console.log('\n6) pospravljanje testnega kupca');
  await stripe.customers.del(kupec.id);
  console.log('    kupec ' + kupec.id + ' izbrisan');

  console.log('\n' + '─'.repeat(72));
  console.log(napak ? '✖ napak: ' + napak : '✔ vse preverbe uspešne');
  console.log('Lokal je v testnem stanju — povrni ga s tools/posnetek-narocnin.js.');
  process.exit(napak ? 1 : 0);
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });
