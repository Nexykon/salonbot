/*
  Preizkus: kdaj bot pove "imamo zaprto" in kdaj ne.

  WhatsApp, baza in seja so podtaknjeni (require cache), zato skripta ne
  pošlje nobenega sporočila, ne bere in ne piše v bazo. Preizkuša se prava
  koda iz src/handler.js — zapora, ki jo je dodal urnik po dnevih.

    node tools/test-zaprto.js

  Ura se ne ponareja: urnik za vsak primer sestavimo glede na trenutni dan
  in uro, zato je izid enak, kadar koli skripto poženeš.
*/
const path = require('path');
const t = require('../src/time');
const urnik = require('../src/urnik');

/* ── podtaknjeni moduli ────────────────────────────────────────────────── */
let POSLANO = [];
const podtakni = (rel, izvoz) => {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: izvoz };
};

const pravWa = require('../src/whatsapp');
podtakni('../src/whatsapp', Object.assign({}, pravWa, {
  send: async (phoneId, token, msg) => {
    const besedilo = msg && msg.text ? msg.text.body : (msg && msg.type) || '(drugo)';
    POSLANO.push(String(besedilo));
    return { ok: true };
  }
}));

podtakni('../src/supabase', {
  getServices: async () => [],
  getBookedTimesForDate: async () => [],
  getMonthlyOrderCount: async () => 0,
  getLastCustomerByPhone: async () => null,
  logError: async () => {},
  createBooking: async () => ({ id: 'x', reference: 'TEST' }),
  createOrderItems: async () => {},
  getSalonById: async () => null
});

podtakni('../src/session', {
  get: () => ({}),
  set: () => {},
  getOrRestore: async () => ({}),
  clear: () => {}
});

podtakni('../src/ai', {
  askAdminAI: async () => '', askCustomerAI: async () => '', transcribeAudio: async () => ''
});
podtakni('../src/ai-order', {
  askOrderAI: async () => ({ reply: 'AI ODGOVOR' }),
  computeTotals: () => ({ grand: 0, packFee: 0, delFee: 0 }),
  aiConfigured: () => false,
  findService: () => null
});
podtakni('../src/email', { send: async () => {}, sendMail: async () => {} });

const { handleMessage } = require('../src/handler');

/* ── gradniki ──────────────────────────────────────────────────────────── */
let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  if (dobil === pricakoval) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil: ' + dobil + '  pričakoval: ' + pricakoval); }
}

const DOW = t.todayDow();
const URA = t.nowTimeStr();

// Urnik, pri katerem je ZDAJ zaprto: danes zaprto, ostali dnevi odprti
function urnikZaprtoZdaj() {
  const u = {};
  for (let d = 0; d <= 6; d++) u[d] = (d === DOW) ? null : { od: '09:00', do: '17:00' };
  return u;
}
// Urnik, pri katerem je ZDAJ odprto: danes od polnoči do 23:59
function urnikOdprtoZdaj() {
  const u = {};
  for (let d = 0; d <= 6; d++) u[d] = { od: '00:00', do: '23:59' };
  return u;
}

const lokal = (dodatno) => Object.assign({
  id: 'test-lokal',
  name: 'Preizkus',
  business_type: 'restaurant',
  booking_mode: 'delivery',
  bot_active: true,
  subscription_plan: 'ai',
  admin_phone: '38640000000',
  whatsapp_phone_number_id: '1',
  whatsapp_access_token: 'x',
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString()
}, dodatno);

const sporocilo = (from = '38641111111') => ({
  from, type: 'text', text: { body: 'eno pico prosim' }
});

async function poskus(opis, salon, msg) {
  POSLANO = [];
  try { await handleMessage(msg, salon); } catch (e) { POSLANO.push('[napaka: ' + e.message + ']'); }
  const prvo = POSLANO[0] || '';
  const jeZaprto = /imamo zaprto/i.test(prvo);
  console.log('\n' + opis + '\n      prvi odgovor: ' + (prvo.split('\n')[0] || '(nič)').slice(0, 70));
  return jeZaprto;
}

(async () => {
  console.log('Danes je dan ' + DOW + ', ura ' + URA + ' (' + t.TZ + ')');

  console.log('\n── 1) Restavracija (dostava) ────────────────────────────────');
  je('ko je zaprto, pove da je zaprto',
    await poskus('  zaprto zdaj', lokal({ working_hours: urnikZaprtoZdaj() }), sporocilo()), true);
  je('ko je odprto, ne pove da je zaprto',
    await poskus('  odprto zdaj', lokal({ working_hours: urnikOdprtoZdaj() }), sporocilo()), false);

  console.log('\n── 2) POS naročanje ─────────────────────────────────────────');
  je('tudi POS tok je zaprt',
    await poskus('  zaprto zdaj', lokal({ booking_mode: 'pos_order', working_hours: urnikZaprtoZdaj() }), sporocilo()), true);

  console.log('\n── 3) Rezervacijski tok (frizer) se NE zapira ───────────────');
  je('frizer izven delovnega časa ni zaprt (stranka rezervira za jutri)',
    await poskus('  zaprto zdaj', lokal({ business_type: 'hair', booking_mode: 'exact_time', working_hours: urnikZaprtoZdaj() }), sporocilo()), false);
  je('tudi povpraševalni tok ni zaprt',
    await poskus('  zaprto zdaj', lokal({ business_type: 'tattoo', booking_mode: 'inquiry', working_hours: urnikZaprtoZdaj() }), sporocilo()), false);

  console.log('\n── 4) Lastnik dela naprej ───────────────────────────────────');
  je('lastniku zapora ne velja',
    await poskus('  zaprto zdaj, piše lastnik', lokal({ working_hours: urnikZaprtoZdaj() }), sporocilo('38640000000')), false);

  console.log('\n── 5) Vsebina sporočila ─────────────────────────────────────');
  POSLANO = [];
  const s = lokal({ working_hours: urnikZaprtoZdaj() });
  try { await handleMessage(sporocilo(), s); } catch (e) {}
  const txt = POSLANO[0] || '';
  console.log(txt.split('\n').map(v => '      ' + v).join('\n'));
  je('vsebuje urnik', txt.includes(urnik.besedilo(s)), true);
  je('pove, kdaj spet odprejo', /po \d{2}:\d{2}/.test(txt), true);
  je('ne vsebuje nezamenjanih oznak', /\{urnik\}|\{odprtje\}/.test(txt), false);

  console.log('\n── 6) Bot izklopljen ima prednost pred urnikom ───────────────');
  POSLANO = [];
  try { await handleMessage(sporocilo(), lokal({ bot_active: false, working_hours: urnikZaprtoZdaj() })); } catch (e) {}
  je('izklopljen bot pošlje svoje sporočilo, ne urnika',
    /ne sprejemamo naročil/i.test(POSLANO[0] || ''), true);

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
