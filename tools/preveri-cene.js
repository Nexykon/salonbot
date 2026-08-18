/*
  Preveri, da strežnik za vsak paket in obdobje najde pravo Stripe ceno —
  brez vpisanih price ID-jev, samo po lookup_key.

  Primerja tudi znesek na Stripu z zneskom v src/plans.js; če se razideta,
  bi stranka plačala nekaj drugega, kot piše v ceniku.

    node tools/preveri-cene.js
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const plans = require('../src/plans');

const KEY = process.env.STRIPE_SECRET_KEY || '';
if (!KEY) { console.error('✖ STRIPE_SECRET_KEY ni nastavljen.'); process.exit(1); }
console.log('način: ' + (KEY.startsWith('sk_live_') ? '⚠  ŽIVI' : 'testni') + '\n');

const stripe = require('stripe')(KEY);
const eur = c => ((c || 0) / 100).toLocaleString('sl-SI', { useGrouping: true, minimumFractionDigits: 2 }) + ' €';

(async () => {
  const r = await stripe.prices.list({ lookup_keys: plans.allLookupKeys(), limit: 100, active: true });
  const poKljucu = {};
  for (const p of r.data) if (p.lookup_key) poKljucu[p.lookup_key] = p;

  let napak = 0;
  for (const plan of plans.PLAN_KEYS) {
    for (const obd of ['monthly', 'yearly']) {
      const lk = plans.lookupKey(plan, obd);
      const cena = poKljucu[lk];
      const pricakovano = plans.priceCents(plan, obd);

      if (!cena) {
        napak++;
        console.log('  ✖ ' + lk.padEnd(16) + 'cene s tem lookup_key ni — poženi node tools/stripe-cene.js');
        continue;
      }
      const tezave = [];
      if (cena.unit_amount !== pricakovano) tezave.push('znesek ' + eur(cena.unit_amount) + ' ≠ cenik ' + eur(pricakovano));
      if (cena.currency !== 'eur') tezave.push('valuta ' + cena.currency);
      const priIntervalu = obd === 'yearly' ? 'year' : 'month';
      if (cena.recurring?.interval !== priIntervalu) tezave.push('interval ' + cena.recurring?.interval);
      if (cena.metadata?.flowtiq_plan !== plan) tezave.push('metadata.flowtiq_plan=' + (cena.metadata?.flowtiq_plan || '—'));
      if (cena.tax_behavior !== 'inclusive') tezave.push('tax_behavior=' + cena.tax_behavior);

      if (tezave.length) { napak++; console.log('  ✖ ' + lk.padEnd(16) + cena.id + '   ' + tezave.join(' · ')); }
      else console.log('  OK ' + lk.padEnd(16) + cena.id + '   ' + eur(cena.unit_amount) + ' / ' + priIntervalu);
    }
  }

  console.log('\nnapak: ' + napak);
  process.exit(napak ? 1 : 0);
})().catch(e => { console.error('\n✖ ' + e.message); process.exit(1); });
