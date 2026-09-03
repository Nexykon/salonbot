/*
  Preizkus uskladitve naročnin brez klicanja Stripa.

  Stripe odjemalca podtaknemo (require cache), zato skripta ne potrebuje
  API ključa in ne more sprožiti pravega plačila. Preizkusi se prava koda
  iz src/stripe-sync.js: kako iz naročnine določi paket, obdobje in
  veljavnost, kdaj vklopi bota in kdaj naročnino spusti kot tujo.

    node tools/test-sinhronizacija.js <salon_id>

  Uporabi TESTNI lokal, nikoli pravega — skripta piše v bazo.
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const plans = require('../src/plans');
const db = require('../src/supabase');

const SALON_ID = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!SALON_ID) {
  console.error('✖ Manjka salon_id.\n  node tools/test-sinhronizacija.js <salon_id>');
  process.exit(1);
}

/* ── podtaknjen Stripe ─────────────────────────────────────────────────── */
let NAROCNINE = [];
const lazniStripe = () => ({
  subscriptions: {
    list: async () => ({ data: NAROCNINE, has_more: false }),
    retrieve: async id => {
      const s = NAROCNINE.find(x => x.id === id);
      if (!s) { const e = new Error('No such subscription: ' + id); e.type = 'invalid_request_error'; throw e; }
      return s;
    }
  },
  customers: { list: async () => ({ data: [] }) },
  prices: { list: async () => ({ data: [] }) }
});
// stripe-sync kliče require('stripe')(kljuc) -> podtaknemo modul pred nalaganjem
require.cache[require.resolve('stripe')] = { id: 'stripe', filename: 'stripe', loaded: true, exports: () => lazniStripe() };
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_lazni';

const sync = require('../src/stripe-sync');

/* ── gradniki ──────────────────────────────────────────────────────────── */
let n = 0;
const cezDni = d => Math.floor((Date.now() + d * 86400000) / 1000);

function narocnina({ status, plan, period, konecDni, subId, custId, salonId, brezOznak, ustvarjena }) {
  const cena = {
    id: 'price_' + plans.lookupKey(plan, period) + '_test',
    currency: 'eur',
    unit_amount: plans.priceCents(plan, period),
    recurring: { interval: period === 'yearly' ? 'year' : 'month' }
  };
  if (!brezOznak) {
    cena.lookup_key = plans.lookupKey(plan, period);
    cena.metadata = { flowtek_plan: plan, flowtek_period: period };
  }
  return {
    id: subId || ('sub_test' + (++n)), object: 'subscription', status,
    customer: custId || 'cus_test1', created: ustvarjena || Math.floor(Date.now() / 1000),
    current_period_end: cezDni(konecDni),
    metadata: { salon_id: salonId },
    items: { data: [{ current_period_end: cezDni(konecDni), price: cena }] }
  };
}

let napak = 0;
function trdi(opis, dobljeno, pricakovano) {
  const ok = String(dobljeno) === String(pricakovano);
  if (!ok) napak++;
  console.log('    ' + (ok ? 'OK ' : '!! ') + opis.padEnd(34) + String(dobljeno).padEnd(24)
    + (ok ? '' : '(pričakovano ' + pricakovano + ')'));
}
const dan = v => (v ? String(v).slice(0, 10) : String(v));
const stanje = async () => {
  const s = await db.getSalonById(SALON_ID);
  if (!s) throw new Error('lokala ' + SALON_ID + ' ni v bazi');
  return s;
};

/* ── potek ─────────────────────────────────────────────────────────────── */
(async () => {
  const zac = await stanje();
  const priklopljen = !!(zac.whatsapp_phone_number_id && (zac.whatsapp_access_token || process.env.WA_TOKEN));
  console.log('lokal: ' + zac.name + '   (' + SALON_ID + ')');
  console.log('WhatsApp priklopljen: ' + (priklopljen ? 'DA' : 'ne')
    + '  →  plačilo ' + (priklopljen ? 'BO' : 'NE bo') + ' samodejno vklopilo bota');
  console.log('izhodišče: plan=' + zac.subscription_plan + ' status=' + zac.subscription_status
    + ' bot=' + zac.bot_active + ' velja=' + dan(zac.valid_until) + '\n');

  const subId = 'sub_test_glavna';
  const custId = 'cus_test_glavni';

  console.log('1) mesečna naročnina postane aktivna');
  NAROCNINE = [narocnina({ status: 'active', plan: 'ai', period: 'monthly', konecDni: 30, subId, custId, salonId: SALON_ID })];
  let r = await sync.sinhronizirajVse();
  trdi('naših lokalov', r.nasih, 1);
  let s = await stanje();
  trdi('subscription_status', s.subscription_status, 'active');
  trdi('billing_status', s.billing_status, 'paid');
  trdi('subscription_plan', s.subscription_plan, 'ai');
  trdi('billing_period', s.billing_period, 'monthly');
  trdi('stripe_subscription_id', s.stripe_subscription_id, subId);
  trdi('velja do (+30 dni)', dan(s.valid_until), dan(new Date(cezDni(30) * 1000).toISOString()));
  trdi('bot_active', s.bot_active, priklopljen ? 'true' : String(zac.bot_active));
  trdi('opomniki ponastavljeni', String(s.renewal_reminded_at) + '/' + String(s.grace_notified_at), 'null/null');

  console.log('\n2) ponovna uskladitev brez sprememb (idempotenca)');
  const prej = s.valid_until;
  r = await sync.sinhronizirajVse();
  trdi('spremenjenih', r.spremenjenih, 0);
  s = await stanje();
  trdi('valid_until nespremenjen', dan(s.valid_until), dan(prej));

  console.log('\n3) prehod na letno naročnino');
  NAROCNINE = [narocnina({ status: 'active', plan: 'premium', period: 'yearly', konecDni: 365, subId, custId, salonId: SALON_ID })];
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('billing_period', s.billing_period, 'yearly');
  trdi('subscription_plan', s.subscription_plan, 'premium');
  trdi('velja do (+365 dni)', dan(s.valid_until), dan(new Date(cezDni(365) * 1000).toISOString()));

  console.log('\n4) paket določi cena, ne metadata');
  NAROCNINE = [narocnina({ status: 'active', plan: 'ai_start', period: 'monthly', konecDni: 30, subId, custId, salonId: SALON_ID })];
  NAROCNINE[0].metadata.plan = 'premium';
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('paket iz cene', s.subscription_plan, 'ai_start');

  console.log('\n5) cena brez oznak → rezerva je metadata.plan');
  NAROCNINE = [narocnina({ status: 'active', plan: 'premium', period: 'yearly', konecDni: 365, subId, custId, salonId: SALON_ID, brezOznak: true })];
  NAROCNINE[0].metadata.plan = 'premium';
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('paket iz metadata.plan', s.subscription_plan, 'premium');

  console.log('\n6) past_due — Stripe še poskuša, status se ne sme spremeniti');
  const prejStatus = s.subscription_status, prejVelja = s.valid_until;
  NAROCNINE = [narocnina({ status: 'past_due', plan: 'premium', period: 'yearly', konecDni: 365, subId, custId, salonId: SALON_ID })];
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('subscription_status ostane', s.subscription_status, prejStatus);
  trdi('valid_until ostane', dan(s.valid_until), dan(prejVelja));

  console.log('\n7) tuja naročnina iz istega Stripe računa');
  NAROCNINE = [{
    id: 'sub_tuja', object: 'subscription', status: 'canceled', customer: 'cus_tuja',
    created: Math.floor(Date.now() / 1000), current_period_end: cezDni(9), metadata: {},
    items: { data: [{ price: { id: 'price_tuja', currency: 'eur', unit_amount: 3600, recurring: { interval: 'year' } } }] }
  }];
  r = await sync.sinhronizirajVse();
  trdi('naših lokalov', r.nasih, 0);
  trdi('spremenjenih', r.spremenjenih, 0);
  s = await stanje();
  trdi('naš lokal nedotaknjen', s.subscription_status, prejStatus);

  console.log('\n8) več naročnin istega lokala — velja najnovejša');
  NAROCNINE = [
    narocnina({ status: 'canceled', plan: 'ai_start', period: 'monthly', konecDni: -10, subId: 'sub_stara', custId, salonId: SALON_ID, ustvarjena: Math.floor(Date.now() / 1000) - 99999 }),
    narocnina({ status: 'active', plan: 'ai', period: 'monthly', konecDni: 30, subId: 'sub_nova', custId, salonId: SALON_ID, ustvarjena: Math.floor(Date.now() / 1000) })
  ];
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('obvelja novejša naročnina', s.stripe_subscription_id, 'sub_nova');
  trdi('status', s.subscription_status, 'active');

  /*
    Odpoved ne sme ugasniti bota takoj: pogoji uporabe obljubljajo, da
    plačano obdobje teče do konca.
  */
  console.log('\n9) odpoved, plačano obdobje še teče → status se ne spremeni');
  NAROCNINE = [narocnina({ status: 'canceled', plan: 'ai', period: 'monthly', konecDni: 30, subId: 'sub_nova', custId, salonId: SALON_ID })];
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('subscription_status ostane', s.subscription_status, 'active');
  trdi('velja do ostane', dan(s.valid_until), dan(new Date(cezDni(30) * 1000).toISOString()));

  /*
    Odloča valid_until na lokalu, ne obdobje naročnine — zato ga tu
    postavimo v preteklost, kot bi ga pustil iztečen mesec.
  */
  console.log('\n10) odpoved, plačano obdobje je poteklo → inactive');
  await db.updateSalonSettings(SALON_ID, { valid_until: new Date(cezDni(-5) * 1000).toISOString() });
  NAROCNINE = [narocnina({ status: 'canceled', plan: 'ai', period: 'monthly', konecDni: -5, subId: 'sub_nova', custId, salonId: SALON_ID })];
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('subscription_status', s.subscription_status, 'inactive');

  /*
    Ključna preverba: mrtva naročnina ne sme povoziti ročne aktivacije.
    Scenarij — stranka odpove kartico, pozneje plača po predračunu, admin
    klikne "Označi plačano". Naslednja uskladitev je ne sme ugasniti.
  */
  console.log('\n11) mrtva naročnina ne povozi ročne aktivacije po predračunu');
  await db.updateSalonSettings(SALON_ID, {
    subscription_status: 'active', billing_status: 'paid',
    valid_until: new Date(cezDni(28) * 1000).toISOString(),
    stripe_subscription_id: null
  });
  await sync.sinhronizirajVse();
  s = await stanje();
  trdi('subscription_status ostane', s.subscription_status, 'active');
  trdi('velja do ostane', dan(s.valid_until), dan(new Date(cezDni(28) * 1000).toISOString()));

  console.log('\n' + '─'.repeat(72));
  console.log(napak ? '✖ napak: ' + napak : '✔ vse preverbe uspešne');
  console.log('\nKončno stanje: plan=' + s.subscription_plan + ' status=' + s.subscription_status
    + ' bot=' + s.bot_active + ' velja=' + dan(s.valid_until));
  console.log('Lokal je v testnem stanju — povrni ga s tools/posnetek-narocnin.js.');
  process.exit(napak ? 1 : 0);
})().catch(e => { console.error('\n✖ ' + e.message); process.exit(1); });
