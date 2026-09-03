/*
  Pregled stanja na Stripu — samo branje, nič ne ustvari in ne spremeni.

  Pove, na kateri račun je vezan ključ v .env, ali so plačila že omogočena
  in kateri produkti, cene ter naročnine v njem že obstajajo. Uporabno pred
  zagonom tools/stripe-cene.js in za razhroščevanje, ko se price ID ne ujema.

    node tools/stripe-stanje.js
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const KEY = process.env.STRIPE_SECRET_KEY || '';
if (!KEY) {
  console.error('✖ STRIPE_SECRET_KEY ni nastavljen v .env.');
  process.exit(1);
}
const jeZivi = KEY.startsWith('sk_live_');
console.log('ključ: ' + KEY.slice(0, 8) + '…' + KEY.slice(-4) + '   način: ' + (jeZivi ? '⚠  ŽIVI' : 'testni'));

const stripe = require('stripe')(KEY);
const eur = c => ((c || 0) / 100).toLocaleString('sl-SI', { minimumFractionDigits: 2 });

(async () => {
  const a = await stripe.accounts.retrieve();
  console.log('\nračun: ' + a.id);
  console.log('  ime:      ' + (a.settings?.dashboard?.display_name || a.business_profile?.name || '—'));
  console.log('  država:   ' + a.country + '   privzeta valuta: ' + String(a.default_currency || '—').toUpperCase());
  console.log('  plačila:  ' + (a.charges_enabled ? 'omogočena' : 'ŠE NE omogočena')
    + '   izplačila: ' + (a.payouts_enabled ? 'omogočena' : 'ŠE NE omogočena'));

  const p = await stripe.products.list({ limit: 100 });
  console.log('\nprodukti: ' + p.data.length);
  for (const x of p.data) {
    console.log('  ' + (x.active ? 'aktiven  ' : 'arhiviran') + '  ' + x.id + '  ' + x.name
      + (x.metadata?.flowtek_plan ? '   [flowtek_plan=' + x.metadata.flowtek_plan + ']' : ''));
  }

  const c = await stripe.prices.list({ limit: 100 });
  console.log('\ncene: ' + c.data.length);
  for (const x of c.data) {
    console.log('  ' + (x.active ? 'aktivna   ' : 'arhivirana') + '  ' + x.id
      + '  ' + eur(x.unit_amount) + ' ' + x.currency.toUpperCase()
      + '  ' + (x.recurring ? '/' + x.recurring.interval : 'enkratna')
      + (x.lookup_key ? '   lookup=' + x.lookup_key : '')
      + (x.tax_behavior && x.tax_behavior !== 'unspecified' ? '   davek=' + x.tax_behavior : ''));
  }

  const subs = await stripe.subscriptions.list({ limit: 20, status: 'all' });
  console.log('\nnaročnine: ' + subs.data.length + (subs.has_more ? '+' : ''));
  for (const s of subs.data) {
    console.log('  ' + s.id + '  ' + s.status.padEnd(10)
      + '  salon_id=' + (s.metadata?.salon_id || '—')
      + '  cena=' + (s.items?.data?.[0]?.price?.id || '—'));
  }

  const wh = await stripe.webhookEndpoints.list({ limit: 10 });
  console.log('\nwebhook endpointi: ' + wh.data.length);
  for (const w of wh.data) {
    console.log('  ' + (w.status === 'enabled' ? 'vklopljen ' : w.status.padEnd(10)) + '  ' + w.url
      + '   dogodkov: ' + (w.enabled_events || []).length);
  }
})().catch(e => {
  console.error('\n✖ ' + (e && e.message ? e.message : e) + (e && e.type ? '  (' + e.type + ')' : ''));
  process.exit(1);
});
