/*
  Posnetek obračunskih stolpcev vseh lokalov — za primerjavo pred/po in za
  povrnitev testnega lokala v prvotno stanje.

    node tools/posnetek-narocnin.js shrani <pot.json>
    node tools/posnetek-narocnin.js primerjaj <pot.json>
    node tools/posnetek-narocnin.js povrni <pot.json> <salon_id>

  "povrni" zapiše nazaj SAMO obračunske stolpce in SAMO za en lokal.
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const axios = require('axios');

const BASE = process.env.SUPABASE_URL + '/rest/v1';
const HEADERS = {
  apikey: process.env.SUPABASE_KEY,
  Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
  'Content-Type': 'application/json'
};

const STOLPCI = [
  'subscription_status', 'subscription_plan', 'billing_status', 'billing_period',
  'signup_status', 'bot_active', 'valid_until', 'trial_ends_at', 'paid_at',
  'activated_at', 'invoice_no', 'proforma_no', 'proforma_amount', 'proforma_issued_at',
  'renewal_requested_plan', 'renewal_requested_at', 'renewal_reminded_at',
  'grace_notified_at', 'paused_notified_at',
  'stripe_customer_id', 'stripe_subscription_id', 'custom_price_id', 'ai_monthly_limit'
];

const [ukaz, pot, salonId] = process.argv.slice(2);

async function beri() {
  const r = await axios.get(`${BASE}/sb_salons?select=id,name,${STOLPCI.join(',')}&order=name`, { headers: HEADERS });
  return r.data;
}

(async () => {
  if (ukaz === 'shrani') {
    const d = await beri();
    fs.writeFileSync(pot, JSON.stringify(d, null, 2));
    console.log('shranjeno: ' + pot + '   lokalov: ' + d.length);
    for (const s of d) console.log('  ' + s.name.padEnd(20) + s.subscription_plan + ' / ' + s.subscription_status + ' / velja ' + String(s.valid_until).slice(0, 10));
    return;
  }

  if (ukaz === 'primerjaj') {
    const prej = JSON.parse(fs.readFileSync(pot, 'utf8'));
    const zdaj = await beri();
    let razlik = 0;
    for (const a of prej) {
      const b = zdaj.find(x => x.id === a.id);
      if (!b) { console.log('!! ' + a.name + ' — lokala ni več'); razlik++; continue; }
      const spr = STOLPCI.filter(k => String(a[k]) !== String(b[k]));
      if (!spr.length) { console.log('·  ' + a.name.padEnd(20) + 'nespremenjen'); continue; }
      razlik += spr.length;
      console.log('!! ' + a.name);
      for (const k of spr) console.log('     ' + k.padEnd(24) + String(a[k]) + '  →  ' + String(b[k]));
    }
    for (const b of zdaj) if (!prej.find(x => x.id === b.id)) { console.log('+  ' + b.name + ' — nov lokal'); razlik++; }
    console.log('\nrazlik: ' + razlik);
    process.exit(razlik ? 1 : 0);
  }

  if (ukaz === 'povrni') {
    if (!salonId) { console.error('✖ manjka salon_id'); process.exit(1); }
    const prej = JSON.parse(fs.readFileSync(pot, 'utf8'));
    const s = prej.find(x => x.id === salonId);
    if (!s) { console.error('✖ lokala ' + salonId + ' v posnetku ni'); process.exit(1); }
    const body = {};
    for (const k of STOLPCI) body[k] = s[k];
    await axios.patch(`${BASE}/sb_salons?id=eq.${salonId}`, body, { headers: { ...HEADERS, Prefer: 'return=minimal' } });
    console.log('povrnjeno: ' + s.name + '  (' + STOLPCI.length + ' stolpcev)');
    return;
  }

  console.error('Uporaba: node tools/posnetek-narocnin.js shrani|primerjaj|povrni <pot.json> [salon_id]');
  process.exit(1);
})().catch(e => { console.error('✖ ' + (e.response ? JSON.stringify(e.response.data) : e.message)); process.exit(1); });
