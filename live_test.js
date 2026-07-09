// LIVE TEST za AI natakarja (Gemini) — poženi na svojem računalniku.
//
// Uporaba (v mapi salonbot_fresh):
//   1) npm install          (če še nisi)
//   2) node live_test.js
//
// Prebere GEMINI_API_KEY iz .env in naredi PRAVE klice na Gemini.
// Preveri, da: (a) reasoning_effort:'none' ne vrne 400, (b) odgovori niso prazni
// (thinking ne poje max_tokens), (c) naročilo doda v košarico ali naravno vpraša.

require('dotenv').config();
process.env.AI_PROVIDER = 'gemini';
process.env.AI_ORDER_MODEL = process.env.AI_ORDER_MODEL || 'gemini-2.5-flash';

const db = require('./src/supabase');
db.getLastOrderItemsByPhone = async () => []; // brez baze
const { askOrderAI } = require('./src/ai-order');

const salon = {
  id: 's1', name: 'Pizzerija Test', allow_delivery: true, allow_pickup: true,
  packaging_price: 0.5, delivery_fee: 2, pickup_packaging: true, pickup_address: 'Glavna 1'
};
const services = [
  { id: '1', name: 'Margerita',   category: 'Pice',    price: 7.5 },
  { id: '2', name: 'Capricciosa', category: 'Pice',    price: 9 },
  { id: '3', name: 'Coca-Cola',   category: 'Pijače',  price: 2.5 },
];

(async () => {
  console.log('model =', process.env.AI_ORDER_MODEL,
              '| key =', process.env.GEMINI_API_KEY ? 'OK' : 'MANJKA!');
  let pass = 0, fail = 0;
  const ok = (l, c, extra) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + l + (extra ? '  | ' + extra : '')); c ? pass++ : fail++; };

  // 1) Pozdrav — odgovor NE sme biti prazen (dokaz, da thinking ne poje max_tokens)
  let r = await askOrderAI({ message: 'Živjo', salon, services, cart: [], history: [],
    phone: '386', order: { mode: null, name: null, address: null }, note: '' });
  ok('pozdrav ni prazen', !!r.reply && r.reply.length > 2, JSON.stringify(r.reply).slice(0, 140));

  // 2) Naročilo — doda v košarico ALI naravno vpraša po količini
  r = await askOrderAI({ message: 'želim eno margarito', salon, services, cart: [],
    history: [{ role: 'user', content: 'Živjo' }, { role: 'assistant', content: r.reply }],
    phone: '386', order: { mode: null, name: null, address: null }, note: '' });
  const addedOrAsked = (r.added && r.added.length) || /koliko|kolik|margerit/i.test(r.reply || '');
  ok('naročilo: doda ali vpraša po količini', !!addedOrAsked,
     'added=' + JSON.stringify(r.added) + ' reply=' + JSON.stringify((r.reply || '').slice(0, 140)));

  // 3) Če je prišlo do tu brez izjeme -> Gemini je sprejel reasoning_effort:'none'
  ok('Gemini sprejme reasoning_effort:none (brez 400)', true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nLIVE NAPAKA:', e.message,
    e.response ? '\nOdgovor Gemini: ' + JSON.stringify(e.response.data).slice(0, 400) : '');
  process.exit(2);
});
