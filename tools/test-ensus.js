/*
  Preizkus "en šus": stranka v enem sporočilu pove artikle, način prevzema in
  naslov, sistem pa gre naravnost na povzetek z gumboma za potrditev.

    node tools/test-ensus.js

  Model ni klican — askOrderAI je podtaknjen in vrača točno to, kar bi vrnil
  AI, ko pokliče add_to_cart + set_mode + set_address. Preizkuša se torej
  napeljava v handler.js: ali se povedano zabeleži, ali se povzetek pošlje
  takoj in ali se NE pošlje takrat, kadar ne bi smel.
*/
let POSLANO = [];
const podtakni = (rel, izvoz) => {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: izvoz };
};

const pravWa = require('../src/whatsapp');
podtakni('../src/whatsapp', Object.assign({}, pravWa, {
  send: async (phoneId, token, msg) => { POSLANO.push(msg); return { ok: true }; }
}));

const MENI = [
  { id: 'm1', name: 'Klasika', price: 12.3, category: 'Pizze', is_active: true, packaging_price: 0.6 },
  { id: 'm2', name: 'Tatarska omaka', price: 2.5, category: 'Dodatki', is_active: true, packaging_price: 0.4 }
];
let NAROCILA = [];
let ZNANA_STRANKA = { name: 'miran', lastAt: '2026-08-01' };
podtakni('../src/supabase', {
  getServices: async () => MENI,
  getBookedTimesForDate: async () => [],
  getMonthlyOrderCount: async () => 0,
  getLastCustomerByPhone: async () => ZNANA_STRANKA,
  loadAiSession: async () => null,
  saveAiSession: async () => {},
  clearAiSession: async () => {},
  logError: async () => {},
  logAiMiss: async () => {},
  createBooking: async (b) => { NAROCILA.push(b); return { id: 'narocilo-1', reference: 'ABC123' }; },
  createOrderItems: async () => {},
  getSalonById: async () => null
});
podtakni('../src/ai', { askAdminAI: async () => '', askCustomerAI: async () => '', transcribeAudio: async () => '' });
podtakni('../src/email', { send: async () => {}, sendMail: async () => {} });

// AI je podtaknjen: zneske in ostalo dela prava koda.
let ODGOVOR = null;   // kar bi vrnil model za naslednje sporočilo
const pravAi = require('../src/ai-order');
podtakni('../src/ai-order', Object.assign({}, pravAi, {
  aiConfigured: () => true,
  askOrderAI: async ({ cart, order }) => {
    const o = ODGOVOR || {};
    return {
      reply: o.reply !== undefined ? o.reply : 'V redu.',
      cart: o.cart || cart,
      order: { mode: o.mode || order.mode || null, name: order.name || null, address: o.address || order.address || null },
      added: o.added || [],
      note: '', action: null, checkoutStarted: !!o.checkout
    };
  }
}));

const session = require('../src/session');
const { handleMessage } = require('../src/handler');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  if (JSON.stringify(dobil) === JSON.stringify(pricakoval)) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil: ' + JSON.stringify(dobil) + '  pričakoval: ' + JSON.stringify(pricakoval)); }
}

const LOKAL = {
  id: 'lokal-1', name: 'Preizkusna picerija', business_type: 'restaurant', booking_mode: 'delivery',
  bot_active: true, subscription_plan: 'ai', admin_phone: '38640000000',
  whatsapp_phone_number_id: '1', whatsapp_access_token: 'x',
  allow_delivery: true, allow_pickup: true, pickup_address: 'Lahovče 11',
  packaging_price: null, delivery_fee: 0, min_order: 0,
  delivery_zones: [{ kraj: 'Suhadole', cena: 3 }, { kraj: 'Vodice', cena: 2 }],
  working_hours: (() => { const u = {}; for (let d = 0; d <= 6; d++) u[d] = { od: '00:00', do: '23:59' }; return u; })()
};
const STRANKA = '38641111111';
const skey = LOKAL.id + ':' + STRANKA;

const KOSARICA = [
  { id: 'm1', name: 'Klasika', qty: 1, price: 12.3 },
  { id: 'm2', name: 'Tatarska omaka', qty: 1, price: 2.5 }
];

async function poslji(besedilo, odgovorAi, salon = LOKAL) {
  ODGOVOR = odgovorAi || null;
  POSLANO = [];
  try { await handleMessage({ from: STRANKA, type: 'text', text: { body: besedilo } }, salon); }
  catch (e) { POSLANO.push({ napaka: e.message + ' @ ' + (e.stack.split('\n')[1] || '').trim() }); }
  return POSLANO;
}
const vse = (p) => p.map(m => (m.text && m.text.body) || (m.interactive && m.interactive.body && m.interactive.body.text) || (m.napaka ? 'NAPAKA: ' + m.napaka : '')).join('\n');
const gumbi = (p) => {
  const m = p.filter(x => x && x.interactive && x.interactive.type === 'button').pop();
  return m ? m.interactive.action.buttons.map(b => b.reply.id) : null;
};

(async () => {
  console.log('\n── 1) Cel stavek v enem sporočilu, znana stranka ──────────');
  session.clear(skey);
  let p = await poslji('narocil bi eno klasiko pico in tatarsko, dostava v suhadole 59b',
    { cart: KOSARICA, mode: 'dostava', address: 'Suhadole 59b', reply: 'Dodal sem.' });
  je('takoj pride povzetek z gumboma', gumbi(p), ['aiok_potrdi', 'aiok_popravi']);
  je('ne vpraša več po načinu', /prevzeti naročilo|Dostava ali osebni/.test(vse(p)), false);
  je('ne vpraša po naslovu', /napišite naslov/i.test(vse(p)), false);
  je('ne vpraša po imenu (stranko poznamo)', /ime in priimek/i.test(vse(p)), false);
  je('povzetek pokaže naslov', /Suhadole 59b/.test(vse(p)), true);
  je('povzetek pokaže ime iz zadnjega naročila', /Ime: miran/.test(vse(p)), true);
  je('artikli 14,80 €', /Artikli: 14,80 €/.test(vse(p)), true);
  je('embalaža 1,00 €', /Embalaža: 1,00 €/.test(vse(p)), true);
  je('dostava 3,00 € za Suhadole', /Dostava: 3,00 € \(Suhadole\)/.test(vse(p)), true);
  je('skupaj 18,80 €', /SKUPAJ: 18,80 €/.test(vse(p)), true);
  je('dobrodošlica z urnikom je prišla', /Delovni čas/.test(vse(p)), true);

  console.log('\n── 2) Potrditev odda naročilo ─────────────────────────────');
  NAROCILA = [];
  p = await poslji('', null);           // brez sporočila ne naredimo nič
  POSLANO = [];
  try {
    await handleMessage({ from: STRANKA, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'aiok_potrdi', title: 'x' } } }, LOKAL);
  } catch (e) { POSLANO.push({ napaka: e.message }); }
  je('pri dostavi še vpraša za plačilo', gumbi(POSLANO), ['pay_gotovina', 'pay_kartica']);
  POSLANO = [];
  await handleMessage({ from: STRANKA, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'pay_gotovina', title: 'x' } } }, LOKAL);
  je('naročilo je oddano', NAROCILA.length, 1);
  je('kraj je zabeležen', /Kraj: Suhadole/.test((NAROCILA[0] || {}).notes || ''), true);
  je('naslov je zabeležen', /Suhadole 59b/.test((NAROCILA[0] || {}).notes || ''), true);

  console.log('\n── 3) Osebni prevzem v enem sporočilu ─────────────────────');
  session.clear(skey);
  p = await poslji('eno klasiko, pridem sam po njo', { cart: [KOSARICA[0]], mode: 'prevzem', reply: 'Dodal sem.' });
  je('takoj povzetek', gumbi(p), ['aiok_potrdi', 'aiok_popravi']);
  je('ne vpraša po naslovu', /napišite naslov/i.test(vse(p)), false);
  je('pokaže naslov prevzema', /Lahovče 11/.test(vse(p)), true);

  console.log('\n── 4) Naslov brez načina pomeni dostavo ───────────────────');
  session.clear(skey);
  p = await poslji('eno klasiko na Vodice 3', { cart: [KOSARICA[0]], address: 'Vodice 3', reply: 'Dodal sem.' });
  je('takoj povzetek', gumbi(p), ['aiok_potrdi', 'aiok_popravi']);
  je('obračuna dostavo za Vodice', /Dostava: 2,00 € \(Vodice\)/.test(vse(p)), true);

  console.log('\n── 5) Nova stranka dobi eno vprašanje — ime ───────────────');
  ZNANA_STRANKA = null;
  session.clear(skey);
  p = await poslji('eno klasiko, dostava Suhadole 59b',
    { cart: [KOSARICA[0]], mode: 'dostava', address: 'Suhadole 59b', reply: 'Dodal sem.' });
  je('vpraša za ime', /ime in priimek/i.test(vse(p)), true);
  je('povzetka še ni', gumbi(p), null);
  p = await poslji('Janez Novak', null);
  je('po imenu pride povzetek', gumbi(p), ['aiok_potrdi', 'aiok_popravi']);
  ZNANA_STRANKA = { name: 'miran', lastAt: '2026-08-01' };

  console.log('\n── 6) Samo artikli: potek se ne prehiteva ─────────────────');
  session.clear(skey);
  p = await poslji('eno klasiko', { cart: [KOSARICA[0]], reply: 'Dodal sem Klasiko. Želite še kaj?' });
  je('povzetka ni', gumbi(p), null);
  je('pride AI odgovor', /Želite še kaj/.test(vse(p)), true);

  console.log('\n── 7) Kasnejše vprašanje ne sproži novega povzetka ────────');
  session.clear(skey);
  await poslji('eno klasiko, dostava Suhadole 59b',
    { cart: [KOSARICA[0]], mode: 'dostava', address: 'Suhadole 59b', reply: 'Dodal sem.' });
  // Stranka pritisne Popravi in nato vpraša po ceni — odgovor mora biti odgovor,
  // ne ponoven povzetek, sicer bi vprašanje ostalo brez odgovora.
  POSLANO = [];
  await handleMessage({ from: STRANKA, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'aiok_popravi', title: 'x' } } }, LOKAL);
  p = await poslji('koliko je skupaj?', { cart: [KOSARICA[0]], reply: 'Artikli so 12,30 €.' });
  je('stranka dobi odgovor', /Artikli so 12,30 €/.test(vse(p)), true);
  je('brez novega povzetka', gumbi(p), null);

  console.log('\n── 8) Neznan kraj gre skozi, ceno določi lokal ────────────');
  session.clear(skey);
  p = await poslji('eno klasiko, dostava Ljubljana Bežigrad 5',
    { cart: [KOSARICA[0]], mode: 'dostava', address: 'Ljubljana Bežigrad 5', reply: 'Dodal sem.' });
  je('povzetek vseeno pride', gumbi(p), ['aiok_potrdi', 'aiok_popravi']);
  je('pove, da ceno sporočijo ob potrditvi', /sporočimo ob potrditvi/.test(vse(p)), true);
  je('skupaj ima pripis "+ dostava"', /\+ dostava/.test(vse(p)), true);

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
