/*
  Edini vir resnice o paketih FlowTek.

  Prej je bil cenik prepisan na osmih mestih (server.js, presets.js, proforma.js,
  admin.html, salon.html, delivery.html). Ob uvedbi letnega popusta je to postalo
  nevarno: predračun je letno naročnino zaračunal kot mesečno × 12, Stripe pa
  −30 % — ista stranka bi dobila dva različna zneska, odvisno od načina plačila.

  Vse cene so KONČNE: nismo zavezanci za DDV (1. odst. 94. člena ZDDV-1),
  zato ga ne obračunavamo. Na Stripu temu ustreza tax_behavior: 'inclusive'.
*/

// Letni popust ob enkratnem plačilu za celo leto.
const YEARLY_DISCOUNT = 0.30;

/*
  `year` ni izračunan iz `month`, ampak zapisan — zaokrožen tako, da je mesečni
  ekvivalent lepa številka (62,30 / 111,99 / 209,30 €). Preverjanje pod
  PRICE_CHECK spodaj skrbi, da ostane blizu 30 %.

  `env` je pripona Stripe spremenljivk: STRIPE_PRICE_<env> in _<env>_YEAR.
*/
const PLANS = {
  ai_start: { label: 'AI Start', month: 89,     year: 747.60,  limit: 500,   ai: true, env: 'AISTART' },
  ai:       { label: 'AI Pro',   month: 159.99, year: 1343.88, limit: 1500,  ai: true, env: 'AI' },
  premium:  { label: 'Premium',  month: 299,    year: 2511.60, limit: 10000, ai: true, env: 'PREMIUM' }
};

// Paket, ki velja, kadar je zapis v bazi neznan ali prazen. Stara vrstica
// (npr. opuščena 'starter'/'pro') tako ne more sesuti strežnika.
const DEFAULT_PLAN = 'ai';
const PLAN_KEYS = Object.keys(PLANS);

const round2 = n => Math.round(Number(n) * 100) / 100;

function isPlan(plan) { return Object.prototype.hasOwnProperty.call(PLANS, plan); }
function planKey(plan) { return isPlan(plan) ? plan : DEFAULT_PLAN; }
function isYearly(period) { return period === 'yearly' || period === 'year'; }

// Vedno vrne veljaven paket. Poleg month/year izpostavi še `price` (mesečna),
// da starejši klici (info.price, info.ai, info.limit) delujejo nespremenjeno.
function planInfo(plan) {
  const p = PLANS[planKey(plan)];
  return { key: planKey(plan), ...p, price: p.month };
}

function planLabel(plan) { return planInfo(plan).label; }

// Znesek za eno obračunsko obdobje: mesečno = mesečna cena, letno = celoletni znesek.
function planPrice(plan, period) {
  const p = planInfo(plan);
  return isYearly(period) ? p.year : p.month;
}

// Koliko stane mesec, če plačaš celo leto naprej (za prikaz na ceniku).
function monthlyEquivalent(plan) { return round2(planInfo(plan).year / 12); }

// Prihranek v evrih na leto.
function yearlySaving(plan) {
  const p = planInfo(plan);
  return round2(p.month * 12 - p.year);
}

// Dejanski popust letne cene (npr. 0.3 = 30 %) — za prikaz in za preverjanje.
function yearlyDiscount(plan) {
  const p = planInfo(plan);
  return round2(1 - p.year / (p.month * 12));
}

/*
  Mesečna meja naročil (fair-use). Ohranja obnašanje prejšnjega
  presets.planLimit(): neznan paket pade na AI_FAIR_USE_LIMIT, sicer 1500.
  Per-lokal override (sb_salons.ai_monthly_limit) ima prednost in se
  upošteva na klicnem mestu, ne tukaj.
*/
function planLimit(plan) {
  if (isPlan(plan)) return PLANS[plan].limit;
  return parseInt(process.env.AI_FAIR_USE_LIMIT) || 1500;
}

// Znesek v centih — Stripe dela izključno s celimi enotami.
function priceCents(plan, period) { return Math.round(planPrice(plan, period) * 100); }

/*
  lookup_key cene na Stripu, npr. 'ai_year' ali 'aistart_month'.

  Po tem ključu strežnik ceno poišče, namesto da bi hranil price ID-je.
  Ker Stripe ključ išče znotraj načina, ki mu pripada API ključ, se testne
  in žive cene razrešijo same — ni dveh nizov spremenljivk in ni nevarnosti,
  da bi v testu pomotoma uporabili živo ceno.
*/
function lookupKey(plan, period) {
  return PLANS[planKey(plan)].env.toLowerCase() + '_' + (isYearly(period) ? 'year' : 'month');
}

// Vsi lookup ključi (za enkratno poizvedbo, ki napolni predpomnilnik).
function allLookupKeys() {
  const out = [];
  for (const k of PLAN_KEYS) { out.push(lookupKey(k, 'monthly')); out.push(lookupKey(k, 'yearly')); }
  return out;
}

// Katalog za odjemalce (GET /api/plans): brez internih polj, s že izračunanimi
// vrednostmi, da jih vmesnik ne računa sam in ne more zaokrožiti drugače.
function catalog() {
  return PLAN_KEYS.map(key => {
    const p = PLANS[key];
    return {
      id: key,
      label: p.label,
      month: p.month,
      year: p.year,
      monthly_equivalent: monthlyEquivalent(key),
      saving: yearlySaving(key),
      discount_pct: Math.round(yearlyDiscount(key) * 100),
      limit: p.limit,
      ai: p.ai
    };
  });
}

/*
  Varovalka pri zagonu: če kdo popravi ceno in pozabi na drugo, mora to
  odkriti takoj, ne šele ko stranka dobi napačen račun. Dovolimo 1 odstotno
  točko odstopanja od YEARLY_DISCOUNT (posledica lepšega zaokroževanja).
*/
for (const key of PLAN_KEYS) {
  const odstopanje = Math.abs(yearlyDiscount(key) - YEARLY_DISCOUNT);
  if (odstopanje > 0.01) {
    throw new Error(
      `[plans] Letna cena paketa "${key}" ne ustreza ${Math.round(YEARLY_DISCOUNT * 100)} % popustu: ` +
      `${PLANS[key].month} €/mes × 12 = ${round2(PLANS[key].month * 12)} €, letno ${PLANS[key].year} € ` +
      `(popust ${Math.round(yearlyDiscount(key) * 100)} %).`
    );
  }
}

module.exports = {
  PLANS, PLAN_KEYS, DEFAULT_PLAN, YEARLY_DISCOUNT,
  isPlan, planKey, isYearly,
  planInfo, planLabel, planPrice, planLimit,
  monthlyEquivalent, yearlySaving, yearlyDiscount,
  priceCents, lookupKey, allLookupKeys, catalog
};
