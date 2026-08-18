/*
  Ustvari (ali samo prikaže) produkte in cene FlowTiq na Stripu.

  Zgradba: 3 produkti, vsak z mesečno in letno ceno = 6 cen. Tako Stripe
  Customer Portal omogoča preklop mesečno<->letno znotraj istega produkta,
  brez odpovedi in nakupa na novo.

  Zneski in oznake pridejo iz src/plans.js — skripta jih ne pozna sama,
  da ne more zaiti od cenika na spletni strani.

  Uporaba:
    node tools/stripe-cene.js            # testni način (zahteva sk_test_ ključ)
    node tools/stripe-cene.js --live     # živi način (zahtevana izrecna potrditev)
    node tools/stripe-cene.js --force    # ob neujemanju zneska ustvari novo ceno

  Skripta je idempotentna: drugi zagon ničesar ne podvoji, samo izpiše, kar že
  obstaja. Cene na Stripu so nespremenljive — če se znesek ne ujema, skripta
  to javi in brez --force ne stori nič.
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const plans = require('../src/plans');

const ZIVO = process.argv.includes('--live');
const FORCE = process.argv.includes('--force');

const KEY = process.env.STRIPE_SECRET_KEY || '';
if (!KEY) {
  console.error('✖ STRIPE_SECRET_KEY ni nastavljen. Vpiši ga v .env (testni ključ se začne s sk_test_).');
  process.exit(1);
}

const jeZivi = KEY.startsWith('sk_live_');
if (jeZivi && !ZIVO) {
  console.error('✖ V .env je ŽIVI ključ (sk_live_), skripta pa je bila zagnana brez --live.');
  console.error('  Da ne nastanejo pravi produkti po nesreči, se ustavljam.');
  console.error('  Če to res želiš: node tools/stripe-cene.js --live');
  process.exit(1);
}
if (!jeZivi && ZIVO) {
  console.error('✖ Podan je --live, ključ v .env pa je testni (sk_test_). Preveri, kateri ključ je vpisan.');
  process.exit(1);
}

const stripe = require('stripe')(KEY);

const OBDOBJA = [
  { period: 'monthly', interval: 'month', kratko: 'mesečno', sufiks: '' },
  { period: 'yearly',  interval: 'year',  kratko: 'letno',   sufiks: '_YEAR' }
];

const eur = c => (c / 100).toLocaleString('sl-SI', { minimumFractionDigits: 2 }) + ' €';

// Produkt poiščemo po metadata.flowtiq_plan. Uporabljamo list (ne search),
// ker je search pri Stripu šele naknadno konsistenten in bi drugi zagon
// takoj po prvem lahko ustvaril dvojnik.
async function najdiAliUstvariProdukt(planKey) {
  const info = plans.planInfo(planKey);
  const seznam = await stripe.products.list({ limit: 100, active: true });
  const obstoj = seznam.data.find(p => p.metadata && p.metadata.flowtiq_plan === planKey);
  if (obstoj) return { produkt: obstoj, nov: false };

  const produkt = await stripe.products.create({
    name: 'FlowTiq ' + info.label,
    description: `WhatsApp asistent za naročila in termine — do ${info.limit.toLocaleString('sl-SI')} naročil na mesec.`,
    metadata: { flowtiq_plan: planKey }
  });
  return { produkt, nov: true };
}

/*
  Cene iščemo po lookup_key, ki je pri Stripu takoj konsistenten.
  Zneska obstoječe cene ni mogoče spremeniti (Stripe Price je nespremenljiv),
  zato ob neujemanju brez --force samo opozorimo.
*/
async function najdiAliUstvariCeno(planKey, produktId, obd) {
  // Isti ključ, po katerem strežnik ceno poišče (src/plans.js).
  const lookup = plans.lookupKey(planKey, obd.period);
  const centov = plans.priceCents(planKey, obd.period);

  const najdene = await stripe.prices.list({ lookup_keys: [lookup], limit: 10 });
  const obstoj = najdene.data.find(p => p.active);

  if (obstoj) {
    if (obstoj.unit_amount === centov && obstoj.currency === 'eur' && obstoj.recurring?.interval === obd.interval) {
      return { cena: obstoj, stanje: 'obstaja' };
    }
    if (!FORCE) {
      return { cena: obstoj, stanje: 'NEUJEMANJE', pricakovano: centov };
    }
    // Z --force ustvarimo novo ceno in nanjo prenesemo lookup_key.
    const nova = await ustvariCeno(planKey, produktId, obd, lookup, centov, true);
    return { cena: nova, stanje: 'zamenjano', staro: obstoj.unit_amount };
  }

  const nova = await ustvariCeno(planKey, produktId, obd, lookup, centov, false);
  return { cena: nova, stanje: 'ustvarjeno' };
}

function ustvariCeno(planKey, produktId, obd, lookup, centov, prenos) {
  return stripe.prices.create({
    product: produktId,
    currency: 'eur',
    unit_amount: centov,
    recurring: { interval: obd.interval },
    // Cena je končna: nismo zavezanci za DDV, zato brez Stripe Tax.
    tax_behavior: 'inclusive',
    nickname: plans.planLabel(planKey) + ' — ' + obd.kratko,
    lookup_key: lookup,
    ...(prenos ? { transfer_lookup_key: true } : {}),
    metadata: { flowtiq_plan: planKey, flowtiq_period: obd.period }
  });
}

(async () => {
  console.log('FlowTiq → Stripe   način: ' + (jeZivi ? '⚠  ŽIVI' : 'testni') + '\n');

  const vrstice = [];
  let neujemanj = 0;

  for (const planKey of plans.PLAN_KEYS) {
    const { produkt, nov } = await najdiAliUstvariProdukt(planKey);
    console.log((nov ? '＋ ustvarjen produkt  ' : '· produkt že obstaja  ') + produkt.name + '   ' + produkt.id);

    for (const obd of OBDOBJA) {
      const r = await najdiAliUstvariCeno(planKey, produkt.id, obd);
      const znesek = eur(plans.priceCents(planKey, obd.period));
      const oznaka = obd.period === 'yearly'
        ? znesek + '  (= ' + plans.monthlyEquivalent(planKey).toLocaleString('sl-SI', { minimumFractionDigits: 2 }) + ' €/mes, −' + Math.round(plans.yearlyDiscount(planKey) * 100) + ' %)'
        : znesek;

      if (r.stanje === 'NEUJEMANJE') {
        neujemanj++;
        console.log('   ✖ ' + obd.kratko.padEnd(8) + 'cena ' + r.cena.id + ' ima ' + eur(r.cena.unit_amount)
          + ', cenik pa ' + eur(r.pricakovano) + '. Stripe cene so nespremenljive.');
        console.log('     Zaženi z --force, da nastane nova cena in se lookup_key prenese nanjo.');
      } else {
        const znak = r.stanje === 'ustvarjeno' ? '＋' : (r.stanje === 'zamenjano' ? '↻' : '·');
        console.log('   ' + znak + ' ' + obd.kratko.padEnd(8) + oznaka.padEnd(42) + r.cena.id
          + (r.stanje === 'zamenjano' ? '   (prej ' + eur(r.staro) + ')' : ''));
      }

      vrstice.push('STRIPE_PRICE_' + plans.PLANS[planKey].env + obd.sufiks + '=' + r.cena.id);
    }
    console.log('');
  }

  console.log('─'.repeat(64));

  if (neujemanj) {
    console.log('⚠  ' + neujemanj + ' cen se ne ujema s cenikom v src/plans.js.');
    console.log('   Zaženi z --force, da nastanejo nove cene s pravimi zneski.');
    process.exit(2);
  }

  /*
    Price ID-jev ni treba nikamor prepisovati: strežnik cene poišče po
    lookup_key. Spodaj so izpisani samo za primer, ko bi kdaj potreboval
    ročno prevlado prek STRIPE_PRICE_* (npr. cena po meri za eno stranko).
  */
  console.log('Gotovo. Price ID-jev NI treba nikamor vpisovati —');
  console.log('strežnik jih poišče po lookup_key. Preveri z:  node tools/preveri-cene.js');
  console.log('');
  console.log('(za morebitno ročno prevlado prek okoljskih spremenljivk:)');
  for (const v of vrstice) console.log('  # ' + v);
  console.log('');
  console.log('Skripto lahko poženeš znova; ničesar ne podvoji.');
})().catch(e => {
  console.error('\n✖ Napaka: ' + (e && e.message ? e.message : e));
  if (e && e.type) console.error('  Stripe tip: ' + e.type);
  process.exit(1);
});
