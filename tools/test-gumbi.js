/*
  Preizkus: gumbi namesto tipkanja v AI toku (količina, način prevzema, potrditev).

  WhatsApp, baza in e-pošta so podtaknjeni (require cache), zato skripta ne
  pošlje nobenega sporočila in ne piše v bazo. Seja je prava (src/session),
  ker je zaporedje korakov bistvo tega preizkusa. Odigra se cel pogovor skozi
  pravo kodo iz src/handler.js.

    node tools/test-gumbi.js

  Preverja tudi Metine omejitve (največ 3 gumbi, naslov 20 znakov, telo 1024)
  in to, da vpisano besedilo še naprej deluje — gumbi so bližnjica, ne prisila.
*/
const path = require('path');

/* ── podtaknjeni moduli ────────────────────────────────────────────────── */
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
  { id: 'm1', name: 'Kmečka', price: 9.5,  category: 'Pice', active: true, packaging_price: 0.6 },
  { id: 'm2', name: 'Margerita', price: 8, category: 'Pice', active: true, packaging_price: 0.6 },
  { id: 'm3', name: 'Coca-Cola', price: 2.5, category: 'Pijača', active: true, packaging_price: 0 }
];
let NAROCILA = [];
podtakni('../src/supabase', {
  getServices: async () => MENI,
  getBookedTimesForDate: async () => [],
  getMonthlyOrderCount: async () => 0,
  getLastCustomerByPhone: async () => null,
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

// ai-order pustimo pravi (zneski!), izklopimo le klic modela.
const pravAi = require('../src/ai-order');
podtakni('../src/ai-order', Object.assign({}, pravAi, {
  aiConfigured: () => false,
  askOrderAI: async () => ({ reply: '(AI se v tem preizkusu ne kliče)' })
}));

const session = require('../src/session');
const { handleMessage } = require('../src/handler');

/* ── gradniki ──────────────────────────────────────────────────────────── */
let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const enako = JSON.stringify(dobil) === JSON.stringify(pricakoval);
  if (enako) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil: ' + JSON.stringify(dobil) + '  pričakoval: ' + JSON.stringify(pricakoval)); }
}

const LOKAL = {
  id: 'lokal-1',
  name: 'Preizkusna picerija',
  business_type: 'restaurant',
  booking_mode: 'delivery',
  bot_active: true,
  subscription_plan: 'ai',
  admin_phone: '38640000000',
  whatsapp_phone_number_id: '1',
  whatsapp_access_token: 'x',
  allow_delivery: true,
  allow_pickup: true,
  packaging_price: null,
  delivery_fee: 0,
  min_order: 0,
  working_hours: (() => { const u = {}; for (let d = 0; d <= 6; d++) u[d] = { od: '00:00', do: '23:59' }; return u; })()
};
const STRANKA = '38641111111';

const besedilo = (b) => ({ from: STRANKA, type: 'text', text: { body: b } });
const klik = (id) => ({ from: STRANKA, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });
const klikSeznam = (id) => ({ from: STRANKA, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: id } } });

async function poslji(msg, salon = LOKAL) {
  POSLANO = [];
  try { await handleMessage(msg, salon); } catch (e) { POSLANO.push({ napaka: e.message + '\n' + e.stack.split('\n')[1] }); }
  return POSLANO;
}
// Zadnje sporočilo z gumbi
const gumbiIz = (poslano) => {
  const m = poslano.filter(x => x && x.interactive && x.interactive.type === 'button').pop();
  return m ? m.interactive.action.buttons.map(b => b.reply) : null;
};
const teloIz = (poslano) => {
  const m = poslano.filter(x => x && x.interactive && x.interactive.type === 'button').pop();
  return m ? m.interactive.body.text : null;
};
const besediloIz = (poslano) => poslano.map(m => (m.text && m.text.body) || (m.interactive && m.interactive.body && m.interactive.body.text) || (m.napaka ? 'NAPAKA: ' + m.napaka : '')).join('\n');

/* ── Metine omejitve ───────────────────────────────────────────────────── */
function preveriOmejitve(poslano, kje) {
  for (const m of poslano) {
    if (!m || !m.interactive || m.interactive.type !== 'button') continue;
    const g = m.interactive.action.buttons;
    if (g.length > 3) { ni++; console.log('  ✖ ' + kje + ': več kot 3 gumbi (' + g.length + ')'); }
    for (const b of g) {
      if ([...b.reply.title].length > 20) { ni++; console.log('  ✖ ' + kje + ': naslov > 20 znakov: "' + b.reply.title + '"'); }
      if (!b.reply.id) { ni++; console.log('  ✖ ' + kje + ': gumb brez id'); }
    }
    if (m.interactive.body.text.length > 1024) { ni++; console.log('  ✖ ' + kje + ': telo > 1024 znakov'); }
  }
}

(async () => {
  console.log('\n── 1) Količina: gumbi 1 2 3 ─────────────────────────');
  session.clear(LOKAL.id + ':' + STRANKA);
  let p = await poslji(klikSeznam('menu_m1'));
  preveriOmejitve(p, 'količina');
  let g = gumbiIz(p);
  je('po izbiri z menija pridejo gumbi', g && g.map(x => x.id), ['aiqty_1', 'aiqty_2', 'aiqty_3']);
  je('naslovi so 1 2 3', g && g.map(x => x.title), ['1', '2', '3']);
  je('vprašanje imenuje jed', /Koliko \*Kmečka\* želite\?/.test(teloIz(p) || ''), true);
  je('še vedno povabi k prilagoditvi', /brez gob/.test(teloIz(p) || ''), true);

  p = await poslji(klik('aiqty_2'));
  je('klik na 2 doda dva kosa', /\*Kmečka\* x2 je v košarici/.test(besediloIz(p)), true);
  je('košarica pokaže znesek 19,00 €', /19,00/.test(besediloIz(p)), true);

  console.log('\n── 2) Vpisano besedilo dela naprej ────────────────────');
  await poslji(klikSeznam('menu_m2'));
  p = await poslji(besedilo('3'));
  je('vpisano število še vedno deluje', /\*Margerita\* x3 je v košarici/.test(besediloIz(p)), true);
  await poslji(klikSeznam('menu_m3'));
  p = await poslji(besedilo('ena brez ledu'));
  je('prilagoditev ne pade na deterministično pot (gre v AI)', /x1 je v košarici/.test(besediloIz(p)), false);

  console.log('\n── 3) Način prevzema: gumba ────────────────────────');
  session.clear(LOKAL.id + ':' + STRANKA);
  await poslji(klikSeznam('menu_m1'));
  await poslji(klik('aiqty_1'));
  p = await poslji(besedilo('zaključi'));
  preveriOmejitve(p, 'način');
  g = gumbiIz(p);
  je('pri zaključku pridejo gumbi za način', g && g.map(x => x.id), ['aimode_dostava', 'aimode_prevzem']);
  je('naslova sta razumljiva', g && g.map(x => x.title), ['🚗 Dostava', '🏃 Osebni prevzem']);

  p = await poslji(klik('aimode_prevzem'));
  je('klik na prevzem vodi naprej na ime', /napišite vaše ime/i.test(besediloIz(p)), true);
  je('klik na prevzem ne pade v klasični tok (opomba)', /opomb/i.test(besediloIz(p)), false);

  console.log('\n── 4) Potrditev: gumba ─────────────────────────────');
  p = await poslji(besedilo('Janez Novak'));
  preveriOmejitve(p, 'potrditev');
  g = gumbiIz(p);
  je('povzetek ima gumba', g && g.map(x => x.id), ['aiok_potrdi', 'aiok_popravi']);
  je('naslova sta kratka', g && g.map(x => x.title), ['✅ Potrdi', '✏️ Popravi']);
  je('povzetek ne piše več "(da / ne)"', /\(da \/ ne\)/.test(besediloIz(p)), false);
  je('povzetek pokaže ime', /Janez Novak/.test(besediloIz(p)), true);

  console.log('\n── 5) Popravi vrne v košarico ──────────────────────');
  NAROCILA = [];
  p = await poslji(klik('aiok_popravi'));
  je('Popravi ne odda naročila', NAROCILA.length, 0);
  je('Popravi pove, kaj je mogoče spremeniti', /kaj želite spremeniti/i.test(besediloIz(p)), true);

  console.log('\n── 6) Potrdi odda naročilo ────────────────────────');
  p = await poslji(besedilo('zaključi'));
  g = gumbiIz(p);
  je('po popravku NE sprašuje spet po načinu in imenu', g && g.map(x => x.id), ['aiok_potrdi', 'aiok_popravi']);
  p = await poslji(klik('aiok_potrdi'));
  je('naročilo je oddano', NAROCILA.length, 1);
  je('shranjen je osebni prevzem', /PREVZEM/.test((NAROCILA[0] || {}).notes || ''), true);
  je('pri prevzemu ne vpraša za način plačila', /plačali/.test(besediloIz(p)), false);
  je('stranka dobi referenco', /Ref/.test(besediloIz(p)), true);

  console.log('\n── 7) Dvojni klik ne odda dvakrat ───────────────────');
  p = await poslji(klik('aiok_potrdi'));
  je('drugi klik ne naredi novega naročila', NAROCILA.length, 1);
  je('drugi klik pojasni, da je zaključeno', /že zaključeno/.test(besediloIz(p)), true);

  console.log('\n── 8) Dostava: gumb + neznan kraj ───────────────────');
  const zLokal = Object.assign({}, LOKAL, { delivery_zones: [{ kraj: 'Vodice', cena: 2 }] });
  session.clear(LOKAL.id + ':' + STRANKA);
  NAROCILA = [];
  await poslji(klikSeznam('menu_m1'), zLokal);
  await poslji(klik('aiqty_2'), zLokal);
  await poslji(besedilo('zaključi'), zLokal);
  p = await poslji(klik('aimode_dostava'), zLokal);
  je('po izbiri dostave vpraša za ime', /ime/i.test(besediloIz(p)), true);
  await poslji(besedilo('Ana Kos'), zLokal);
  p = await poslji(besedilo('Kopitarjeva 5, Vodice'), zLokal);
  preveriOmejitve(p, 'dostava');
  je('povzetek zaračuna dostavo za Vodice', /Dostava: 2,00 €/.test(besediloIz(p)), true);
  je('povzetek pokaže embalažo', /Embalaža/.test(besediloIz(p)), true);
  je('SKUPAJ = 19,00 + 1,20 + 2,00', /SKUPAJ: 22,20 €/.test(besediloIz(p)), true);
  p = await poslji(klik('aiok_potrdi'), zLokal);
  preveriOmejitve(p, 'plačilo');
  g = gumbiIz(p);
  je('pri dostavi vpraša za način plačila z gumbi', g && g.map(x => x.id), ['pay_gotovina', 'pay_kartica']);
  je('naslova plačila sta jasna', g && g.map(x => x.title), ['💶 Gotovina', '💳 Kartica']);
  je('naročilo še ni oddano, dokler plačilo ni izbrano', NAROCILA.length, 0);
  p = await poslji(klik('pay_kartica'), zLokal);
  je('naročilo z dostavo je oddano', NAROCILA.length, 1);
  je('zabeležena je kartica', /Plačilo: Kartica/.test((NAROCILA[0] || {}).notes || ''), true);
  je('kraj dostave je zabeležen', /Vodice/.test((NAROCILA[0] || {}).notes || ''), true);

  console.log('\n── 8b) Vpisano besedilo za plačilo dela naprej ─────────');
  session.clear(LOKAL.id + ':' + STRANKA);
  NAROCILA = [];
  await poslji(klikSeznam('menu_m1'), zLokal);
  await poslji(klik('aiqty_1'), zLokal);
  await poslji(besedilo('zaključi'), zLokal);
  await poslji(klik('aimode_dostava'), zLokal);
  await poslji(besedilo('Ana Kos'), zLokal);
  await poslji(besedilo('Kopitarjeva 5, Vodice'), zLokal);
  await poslji(klik('aiok_potrdi'), zLokal);
  p = await poslji(besedilo('z banko'), zLokal);
  je('"z banko" se prepozna kot kartica', /Plačilo: Kartica/.test((NAROCILA[0] || {}).notes || ''), true);

  console.log('\n── 9) Predolg povzetek: gumbi ne odrežejo zneskov ──────');
  const dolgMeni = [];
  for (let i = 0; i < 20; i++) dolgMeni.push({ id: 'd' + i, name: 'Goveji trakci s šampinjoni, špinačo in gorgonzolo ' + i, price: 19.9, category: 'Pice', active: true });
  const db = require('../src/supabase');
  const prejsnji = db.getServices;
  db.getServices = async () => dolgMeni;
  session.clear(LOKAL.id + ':' + STRANKA);
  for (let i = 0; i < 20; i++) { await poslji(klikSeznam('menu_d' + i)); await poslji(klik('aiqty_3')); }
  await poslji(besedilo('zaključi'));
  await poslji(klik('aimode_prevzem'));
  p = await poslji(besedilo('Marko Dolgi'));
  preveriOmejitve(p, 'dolg povzetek');
  je('povzetek je šel kot besedilo', p.some(m => m.text), true);
  je('gumbi so prišli v ločenem sporočilu', gumbiIz(p) && gumbiIz(p).map(x => x.id), ['aiok_potrdi', 'aiok_popravi']);
  je('znesek SKUPAJ je viden v celoti', /SKUPAJ: [\d.,]+ €/.test(besediloIz(p)), true);
  db.getServices = prejsnji;

  console.log('\n── 9b) Star gumb iz prejšnjega pogovora ────────────────');
  session.clear(LOKAL.id + ':' + STRANKA);
  p = await poslji(klik('aiqty_2'));
  je('klik brez seje dobi odgovor (ne molka)', /starejšega pogovora/.test(besediloIz(p)), true);
  session.clear(LOKAL.id + ':' + STRANKA);
  p = await poslji(klik('dqty_2'), Object.assign({}, LOKAL, { subscription_plan: 'start' }));
  je('enako velja za klasični gumb', /starejšega pogovora/.test(besediloIz(p)), true);

  console.log('\n── 10) Klasični tok (paket brez AI) je nedotaknjen ─────');
  const klasicni = Object.assign({}, LOKAL, { subscription_plan: 'start' });
  session.clear(LOKAL.id + ':' + STRANKA);
  p = await poslji(klikSeznam('menu_m1'), klasicni);
  g = gumbiIz(p);
  je('še vedno dqty_ gumbi', g && g.map(x => x.id), ['dqty_1', 'dqty_2', 'dqty_3']);
  je('še vedno "1 kos / 2 kosa / 3 kosi"', g && g.map(x => x.title), ['1 kos', '2 kosa', '3 kosi']);
  await poslji(klik('dqty_1'), klasicni);
  p = await poslji(klik('delivery_checkout'), klasicni);
  g = gumbiIz(p);
  je('klasični način prevzema ostane dmode_', g && g.map(x => x.id), ['dmode_dostava', 'dmode_prevzem']);

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
