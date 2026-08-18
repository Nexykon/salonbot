/*
  ─── Stripe: iskanje cen in usklajevanje naročnin ────────────────────────────

  Stanje naročnin beremo iz Stripa (pull), ne čakamo, da nam ga Stripe pošlje
  (webhook). Razlogi:

    • Stripe račun je skupen z drugimi dejavnostmi iste firme (Steady Stream,
      Webacus PRO — z živimi naročninami). Webhook endpoint bi dobival tudi
      njihove dogodke; pri branju tuje naročnine preprosto ni med našimi lokali.
    • Ni javnega endpointa in ni podpisnega ključa za vzdrževati.
    • Samopopravljivo: vsak zagon uskladi stanje, zato ni dogodka, ki bi se
      lahko "izgubil". Pri webhooku bi bila neuspela dostava tiha napaka.

  Uskladitev teče na treh mestih:
    1. ob vrnitvi stranke s plačila (takojšen učinek zanjo),
    2. ob vrnitvi iz Stripe portala (odpoved, menjava kartice),
    3. vsako uro iz urnika — to pokrije obnovitve in odpovedi, pri katerih
       stranke ni. Brez tega bi lokal, ki plačuje s kartico in nadzorne
       plošče mesec dni ne odpre, po prvem obdobju obmolknil.

  Zapis je ena sama funkcija (applyStripeSubscription), da kartica in
  nakazilo pustita bazo v enakem stanju.
*/
const db = require('./supabase');
const mail = require('./email');
const plans = require('./plans');

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

/* ── Iskanje cen ───────────────────────────────────────────────────────────
   Price ID-jev ne hranimo. Cene poiščemo po lookup_key (aistart_month,
   ai_year …), ki ga vsaki ceni nastavi tools/stripe-cene.js. Ker Stripe išče
   znotraj načina, ki mu pripada API ključ, se testne in žive cene razrešijo
   same — ni dveh nizov spremenljivk in ni nevarnosti, da bi v testu
   pomotoma uporabili živo ceno.
   STRIPE_PRICE_* ostajajo kot neobvezna ročna prevlada.                     */

let _cene = null;
let _ceneOb = 0;
const CENE_TTL_MS = 10 * 60 * 1000;

function stripePriceEnv(plan, period) {
  const suffix = plans.PLANS[plans.planKey(plan)].env;
  return process.env['STRIPE_PRICE_' + suffix + (plans.isYearly(period) ? '_YEAR' : '')] || '';
}

async function stripeCene() {
  if (_cene && Date.now() - _ceneOb < CENE_TTL_MS) return _cene;
  const stripe = stripeClient();
  if (!stripe) return {};
  const r = await stripe.prices.list({ lookup_keys: plans.allLookupKeys(), limit: 100, active: true });
  const out = {};
  for (const p of r.data) if (p.lookup_key) out[p.lookup_key] = p.id;
  _cene = out;
  _ceneOb = Date.now();
  return out;
}

// Vrstni red: cena po meri za lokal -> ročna prevlada iz okolja -> lookup_key.
async function stripePriceId(plan, period, customPriceId) {
  if (customPriceId && plans.isPlan(plan)) return customPriceId;
  const izOkolja = stripePriceEnv(plan, period);
  if (izOkolja) return izOkolja;
  const cene = await stripeCene().catch(e => { console.error('[stripe] branje cen:', e.message); return {}; });
  return cene[plans.lookupKey(plan, period)] || '';
}

/*
  Iz Stripove cene ugotovi paket: najprej metadata.flowtiq_plan (zapiše ga
  skripta ob ustvarjanju), nato lookup_key, nazadnje ročna prevlada iz okolja.
  Sprejme cel objekt cene ali samo ID.
*/
function planFromPrice(cena) {
  if (!cena) return null;
  const izOsnove = osnova => plans.PLAN_KEYS.find(k => plans.PLANS[k].env.toLowerCase() === osnova);

  if (typeof cena === 'object') {
    if (plans.isPlan(cena.metadata?.flowtiq_plan)) return cena.metadata.flowtiq_plan;
    if (cena.lookup_key) {
      const z = izOsnove(String(cena.lookup_key).replace(/_(month|year)$/, ''));
      if (z) return z;
    }
  }
  const id = typeof cena === 'string' ? cena : cena.id;
  if (!id) return null;
  for (const k of plans.PLAN_KEYS) {
    for (const obd of ['monthly', 'yearly']) if (stripePriceEnv(k, obd) === id) return k;
  }
  if (_cene) {
    for (const [lk, pid] of Object.entries(_cene)) {
      if (pid !== id) continue;
      const z = izOsnove(lk.replace(/_(month|year)$/, ''));
      if (z) return z;
    }
  }
  return null;
}

/* ── Zapis stanja ──────────────────────────────────────────────────────── */

/*
  Stripe status -> subscription_status.

  Namenoma NI preslikave za past_due/unpaid/incomplete: Stripe takrat sam
  ponavlja poskuse plačila, valid_until pa se ne premakne, zato bota po
  3 dneh odloga vljudno ustavi obstoječi mehanizem (handler.js:191) —
  namesto trdega molka, ki bi ga sprožil status 'inactive'.

  Tudi končnih stanj (canceled, incomplete_expired) NE prevedemo takoj:
  glej KONCNA_STANJA in razlago pod njimi.
*/
const STRIPE_STATUS = {
  active: 'active',
  trialing: 'trial'
};

/*
  Končna stanja naročnine. Obravnavamo jih posebej iz dveh razlogov:

  1. Pogoji uporabe obljubljajo, da odpoved začne veljati ob koncu že
     plačanega obdobja. Če bi ob odpovedi takoj zapisali 'inactive', bi
     stranki vzeli mesec, ki ga je plačala.

  2. Preklicana naročnina ostane v Stripu za vedno. Če bi jo vsaka
     uskladitev znova prevedla v 'inactive', bi povozila ročno aktivacijo:
     stranka odpove kartico, pozneje plača po predračunu, admin klikne
     Označi plačano — in naslednja ura bi ji ugasnila bota.

  Zato: dokler valid_until še ni potekel, se statusa ne dotaknemo. Ko poteče,
  ga postavimo na 'inactive' in takrat pošljemo obvestilo (to je tudi trenutek,
  ko je treba umakniti WhatsApp številko iz Mete).
*/
const KONCNA_STANJA = ['canceled', 'incomplete_expired'];

/*
  Ali je lokal dejansko sposoben pošiljati na WhatsApp.
  Posnema, kako se žeton razreši povsod drugod v kodi
  (`salon.whatsapp_access_token || process.env.WA_TOKEN`): večina lokalov ima
  svojo številko, žeton pa jemlje iz skupne okoljske spremenljivke. Pogoj, ki
  bi zahteval lasten žeton, bi samodejni vklop onemogočil trem od petih
  obstoječih lokalov.
*/
function waPriklopljen(salon) {
  if (!salon || !salon.whatsapp_phone_number_id) return false;
  return !!(salon.whatsapp_access_token || process.env.WA_TOKEN);
}

// Konec obračunskega obdobja; v novejših API verzijah je polje na postavki.
function subPeriodEnd(sub) {
  const ts = sub?.current_period_end || sub?.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

// Strogo iskanje lokala: metadata -> subscription ID -> customer ID.
// Vrne null, kadar naročnina ne pripada FlowTiqu (tuja dejavnost v računu).
async function salonForSubscription(sub) {
  const izMeta = sub?.metadata?.salon_id;
  if (izMeta) {
    const s = await db.getSalonById(izMeta).catch(() => null);
    if (s) return s;
  }
  if (sub?.id) {
    const s = await db.getSalonByStripeSubId(sub.id).catch(() => null);
    if (s) return s;
  }
  const cust = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
  return await db.getSalonByStripeCustomerId(cust).catch(() => null);
}

/*
  Zapiše stanje naročnine na lokal. Vzor je /api/admin/mark-paid, ki je
  kanonična "plačilo prejeto" mutacija.

  valid_until vedno PREBEREMO iz Stripa (current_period_end), nikoli ne
  prištevamo meseca — zato je ponovljena uskladitev neškodljiva in ura
  usklajevanja ne premika veljavnosti naprej.
*/
async function applyStripeSubscription(sub, vir, salonZnan) {
  const salon = salonZnan || await salonForSubscription(sub);
  if (!salon) return null;

  const koncna = KONCNA_STANJA.includes(sub.status);
  const naseJe = salon.stripe_subscription_id === sub.id;

  /*
    Končana naročnina, ki na lokal ni vezana, ni naša skrb: lokal je vmes
    dobil drugo naročnino ali pa plačuje po predračunu. Ne pišemo ničesar,
    da ne povozimo veljavnega stanja s podatkom iz mrtve naročnine.
  */
  if (koncna && !naseJe) {
    console.log(`[stripe] ${vir}: ${salon.name} — naročnina ${sub.id} je ${sub.status} in ni vezana na lokal, spuščeno`);
    return { salon, status: null, spremenjeno: false };
  }

  /*
    Končana naročnina, ki JE naša: stranka je odpovedala. Plačano obdobje
    ji pustimo do konca (tako pišejo pogoji uporabe). Status spremenimo šele,
    ko veljavnost poteče.
  */
  const veljaSe = salon.valid_until && new Date(salon.valid_until).getTime() > Date.now();
  if (koncna && veljaSe) {
    console.log(`[stripe] ${vir}: ${salon.name} — odpovedano, a plačano obdobje teče do `
      + String(salon.valid_until).slice(0, 10) + ' (statusa ne spreminjamo)');
    return { salon, status: null, spremenjeno: false };
  }

  const status = koncna ? 'inactive' : STRIPE_STATUS[sub.status];
  const cena = sub.items?.data?.[0]?.price;
  /*
    Paket določi cena — to je Stripova resnica. Kadar cene ni mogoče
    prevesti nazaj (cena po meri ali cena brez oznak), se opremo na
    metadata.plan s checkouta, nazadnje na obstoječi paket.
  */
  const paket = planFromPrice(cena)
    || (plans.isPlan(sub.metadata?.plan) ? sub.metadata.plan : null)
    || salon.subscription_plan;
  const obdobje = cena?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
  const konec = subPeriodEnd(sub);

  /*
    Najprej samo vsebinska polja. Časovnih žigov (paid_at, activated_at) tu
    namenoma NI: če bi jih pisali ob vsaki uskladitvi, bi se stanje "spremenilo"
    vsako uro — vsako uro zapis v bazo in vsako uro e-pošta o čakanju na priklop.
  */
  const vsebina = {
    stripe_customer_id: (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id) || salon.stripe_customer_id,
    stripe_subscription_id: sub.id,
    subscription_plan: paket,
    billing_period: obdobje
  };
  if (status) vsebina.subscription_status = status;
  if (konec) vsebina.valid_until = konec.toISOString();

  let vklopljen = false;
  if (status === 'active') {
    vsebina.billing_status = 'paid';
    // Opomniki se nanašajo na prejšnje obdobje — po plačilu jih ponastavimo.
    vsebina.renewal_reminded_at = null;
    vsebina.grace_notified_at = null;
    vsebina.paused_notified_at = null;
    vsebina.renewal_requested_plan = null;
    vsebina.renewal_requested_at = null;

    /*
      Bot ne more delovati brez WhatsApp številke, ki se priklopi ročno v Meti.
      Če je že priklopljena, plačilo bota zažene samo; sicer samo označimo
      plačilo in pokličemo človeka. Ročni "🔌 Priklopi" ostaja nespremenjen.
    */
    if (waPriklopljen(salon)) {
      vsebina.bot_active = true;
      vsebina.signup_status = 'active';
      vklopljen = true;
    }
  }

  // Primerjava datumov mora biti po vrednosti, ne po zapisu: Postgres vrne
  // '2026-09-17T00:00:00+00:00', mi pa pošljemo '2026-09-17T00:00:00.000Z'.
  const enako = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    const da = Date.parse(a), dbb = Date.parse(b);
    if (!Number.isNaN(da) && !Number.isNaN(dbb)) return da === dbb;
    return String(a) === String(b);
  };

  const spremembe = Object.keys(vsebina).filter(k => !enako(salon[k], vsebina[k]));
  if (!spremembe.length) return { salon, status, paket, obdobje, konec, vklopljen, spremenjeno: false };

  // Šele zdaj, ko vemo, da se je res kaj premaknilo, dodamo žige.
  const updates = { ...vsebina };
  if (status === 'active') {
    updates.paid_at = new Date().toISOString();
    if (!salon.activated_at && vklopljen) updates.activated_at = new Date().toISOString();
  }

  await db.updateSalonSettings(salon.id, updates);
  console.log(`[stripe] ${vir}: ${salon.name} → ${status || sub.status} · ${paket} · ${obdobje}`
    + (konec ? ' · velja do ' + konec.toISOString().slice(0, 10) : '')
    + (status === 'active' ? (vklopljen ? ' · bot VKLOPLJEN' : ' · čaka priklop WhatsAppa') : ''));

  return { salon, status, paket, obdobje, konec, vklopljen, spremenjeno: true, spremembe };
}

/* ── Obvestila lastniku FlowTiqa ───────────────────────────────────────── */

async function obvestiOPriklopu(r) {
  const komu = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtiq.si';
  const s = r.salon;
  await mail.sendEmail(komu, `💳 Plačano — čaka priklop: ${s.name}`, [
    'Plačilo s kartico je prišlo, bota pa ni bilo mogoče vklopiti samodejno,',
    'ker lokal še ni priklopljen na WhatsApp številko.', '',
    `Lokal: ${s.name}${s.company_name ? ' (' + s.company_name + ')' : ''}`,
    `Kontakt: ${s.contact_person || s.owner_name || '-'} · ${s.owner_email || '-'} · ${s.admin_phone || '-'}`,
    `Paket: ${plans.planLabel(r.paket)} · ${r.obdobje === 'yearly' ? 'letno' : 'mesečno'} · ${plans.planPrice(r.paket, r.obdobje)} €`,
    `Velja do: ${r.konec ? r.konec.toLocaleDateString('sl-SI') : '-'}`,
    '', `Salon ID: ${s.id}`,
    'UKREPAJ: v Meta Business Managerju priklopi WhatsApp številko, nato v master',
    'dashboardu klikni 🔌 Priklopi. Plačilo je že zabeleženo (billing_status=paid).'
  ].join('\n'));
}

async function obvestiOOdpovedi(salon) {
  const komu = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtiq.si';
  const waId = salon.whatsapp_phone_number_id || 'ni nastavljen';
  await mail.sendEmail(komu, `⚠️ Odpoved naročnine — ${salon.name}`, [
    'Naročnina je odpovedana ali dokončno neplačana.', '',
    `Lokal: ${salon.name}`,
    `Email: ${salon.owner_email || '-'}`,
    `WhatsApp Phone Number ID: ${waId}`,
    `Admin telefon: ${salon.admin_phone || '-'}`,
    `Stripe Sub ID: ${salon.stripe_subscription_id || '-'}`,
    '',
    `UKREPAJ: Odstrani WhatsApp številko (Phone Number ID: ${waId}) iz Meta Business Manager.`
  ].join('\n'));
}

/* ── Uskladitev ────────────────────────────────────────────────────────── */

async function poObdelavi(r) {
  if (!r || !r.spremenjeno) return;
  try {
    if (r.status === 'active' && !r.vklopljen) await obvestiOPriklopu(r);
    if (r.status === 'inactive') await obvestiOOdpovedi(r.salon);
  } catch (e) { console.error('[stripe] obvestilo:', e.message); }
}

/*
  Uskladi en lokal. Kliče se ob vrnitvi s plačila ali iz portala, da stranka
  učinek vidi takoj in ji ni treba čakati na urno uskladitev.
*/
async function sinhronizirajLokal(salon) {
  const stripe = stripeClient();
  if (!stripe || !salon) return null;

  let sub = null;
  if (salon.stripe_subscription_id) {
    sub = await stripe.subscriptions.retrieve(salon.stripe_subscription_id, { expand: ['items.data.price'] })
      .catch(() => null);
  }
  // Prvo plačilo: naročnine še ne poznamo, poiščemo jo po kupcu ali e-pošti.
  if (!sub) {
    let custId = salon.stripe_customer_id;
    if (!custId && salon.owner_email) {
      const k = await stripe.customers.list({ email: salon.owner_email, limit: 1 }).catch(() => null);
      custId = k?.data?.[0]?.id;
    }
    if (!custId) return null;
    const seznam = await stripe.subscriptions.list({
      customer: custId, status: 'all', limit: 10, expand: ['data.items.data.price']
    }).catch(() => null);
    sub = izberiNajnovejso(seznam?.data || []);
  }
  if (!sub) return null;

  const r = await applyStripeSubscription(sub, 'sync:lokal', salon);
  await poObdelavi(r);
  return r;
}

// Če ima lokal več naročnin (odpovedal in se vrnil), velja najnovejša.
function izberiNajnovejso(seznam) {
  if (!seznam.length) return null;
  const zive = seznam.filter(s => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due');
  const izbor = zive.length ? zive : seznam;
  return izbor.slice().sort((a, b) => (a.created || 0) - (b.created || 0)).pop();
}

/*
  Uskladi vse. En sam sprehod čez naročnine v računu — tuje (Steady Stream,
  Webacus) nimajo ujemajočega lokala in tiho odpadejo.
  Naročnine obdelamo od najstarejše k najnovejši, da pri lokalu z več
  naročninami obvelja najnovejša.
*/
async function sinhronizirajVse() {
  const stripe = stripeClient();
  if (!stripe) { console.log('[stripe-sync] ni API ključa — preskočeno'); return { pregledanih: 0, nasih: 0, spremenjenih: 0 }; }

  const vse = [];
  let starting_after;
  for (let stran = 0; stran < 20; stran++) {          // varovalka proti neskončni zanki
    const r = await stripe.subscriptions.list({
      status: 'all', limit: 100, expand: ['data.items.data.price'],
      ...(starting_after ? { starting_after } : {})
    });
    vse.push(...r.data);
    if (!r.has_more) break;
    starting_after = r.data[r.data.length - 1].id;
  }

  /*
    Naročnine najprej razvrstimo po lokalih in za vsakega uporabimo samo eno.
    Če bi obdelali vse zapored, bi lokal, ki je odpovedal in se vrnil, dobil
    najprej zapis "inactive" iz stare naročnine in šele nato "active" iz nove —
    dva zapisa v bazo in odvečno e-pošto o odpovedi.
  */
  const poLokalih = new Map();
  for (const sub of vse) {
    const salon = await salonForSubscription(sub);
    if (!salon) continue;                              // tuja dejavnost v istem računu
    const vnos = poLokalih.get(salon.id);
    if (vnos) vnos.subs.push(sub);
    else poLokalih.set(salon.id, { salon, subs: [sub] });
  }

  let spremenjenih = 0;
  for (const { salon, subs } of poLokalih.values()) {
    const sub = izberiNajnovejso(subs);
    const r = await applyStripeSubscription(sub, 'sync:urnik', salon);
    if (r?.spremenjeno) { spremenjenih++; await poObdelavi(r); }
    if (sub.status === 'past_due' || sub.status === 'unpaid') {
      console.log(`[stripe-sync] ${salon.name}: plačilo ne uspe (${sub.status}) — Stripe poskuša znova, veljavnost se ne premakne`);
    }
  }

  const nasih = poLokalih.size;
  console.log(`[stripe-sync] pregledanih ${vse.length}, naših lokalov ${nasih}, spremenjenih ${spremenjenih}`);
  return { pregledanih: vse.length, nasih, spremenjenih };
}

/*
  Urnik uskladitve.

  Namenoma ločen od src/scheduler.js: tisti se v tem projektu nikoli ne zažene
  (startScheduler() je uvožen, a nikjer klican), poleg tega pa vsebuje opravila,
  ki pošiljajo pošto strankam. Uskladitev naročnin ne sme biti odvisna od
  odločitve, ali se tista opravila vklopijo ali ne.
*/
function zacniUskladitev() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('[stripe-sync] STRIPE_SECRET_KEY ni nastavljen — uskladitev naročnin ne teče');
    return;
  }
  const cron = require('node-cron');

  // Ob :20, da se ne prekriva z drugimi urnimi opravili ob polni uri.
  cron.schedule('20 * * * *', () => {
    sinhronizirajVse().catch(e => console.error('[stripe-sync] Error:', e.message));
  }, { timezone: 'Europe/Ljubljana' });

  // Enkrat ob zagonu, z zamikom — po deployu je stanje takoj sveže,
  // zamik pa pusti strežniku, da najprej normalno vstane.
  setTimeout(() => {
    sinhronizirajVse().catch(e => console.error('[stripe-sync] Error:', e.message));
  }, 30000);

  console.log('[stripe-sync] uskladitev naročnin: vsako uro ob :20 (in 30 s po zagonu)');
}

module.exports = {
  stripeClient, stripePriceId, planFromPrice, waPriklopljen,
  applyStripeSubscription, salonForSubscription,
  sinhronizirajLokal, sinhronizirajVse, zacniUskladitev
};
