/*
  Preizkus: opomnik dan pred terminom z odgovorom DA / NE.

  WhatsApp, baza in seja so podtaknjeni (require cache), zato skripta ne
  pošlje nobenega sporočila, ne bere in ne piše v bazo. Preizkuša se prava
  koda iz src/scheduler.js (opomnik) in src/handler.js (odgovor nanj).

    node tools/test-opomnik.js
*/
const t = require('../src/time');

/* ── podtaknjeni moduli ────────────────────────────────────────────────── */
let POSLANO = [];      // { to, besedilo, gumbi }
let STATUS = {};       // id → nov status
let PODSOBA = {};      // id → posodobljena polja
let TERMINI = [];      // kar vrne getRemindedBookings
let SEJA = {};
const podtakni = (rel, izvoz) => {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: izvoz };
};

const pravWa = require('../src/whatsapp');
podtakni('../src/whatsapp', Object.assign({}, pravWa, {
  send: async (phoneId, token, msg) => {
    /*
      Opomnik gre kot predloga (zunaj 24-urnega okna drugače ne gre skozi),
      zato se tu bere tudi tip 'template': ime, parametri telesa in tovor
      gumbov za hiter odgovor.
    */
    const besedilo = msg.text ? msg.text.body : msg.interactive ? msg.interactive.body.text : '(drugo)';
    const gumbi = msg.interactive && msg.interactive.action.buttons ? msg.interactive.action.buttons.map(b => b.reply.id) : [];
    const zapis = { to: msg.to, besedilo: String(besedilo), gumbi, tip: msg.type };
    if (msg.type === 'template') {
      const deli = msg.template.components || [];
      zapis.predloga = msg.template.name;
      zapis.jezik = msg.template.language && msg.template.language.code;
      zapis.telo = (deli.find(d => d.type === 'body') || { parameters: [] }).parameters.map(p => p.text);
      zapis.gumbi = deli.filter(d => d.type === 'button').map(d => d.parameters[0].payload);
    }
    POSLANO.push(zapis);
    return { ok: true };
  }
}));

const JUTRI = t.dateOffsetStr(t.todayStr(), 1);
const termin = (dodatno) => Object.assign({
  id: 'b-111', salon_id: 'test-salon', customer_phone: '38641111111', customer_name: 'Ana Novak',
  booking_date: JUTRI, booking_time: '15:00:00', status: 'confirmed', reminder_sent: true
}, dodatno);

podtakni('../src/supabase', {
  getServices: async () => [],
  getBookedTimesForDate: async () => [],
  getLastCustomerByPhone: async () => null,
  getMonthlyOrderCount: async () => 0,
  logError: async () => {},
  getSalonById: async () => null,
  getRemindedBookings: async (salonId, phone, dates) => TERMINI.filter(b => b.customer_phone === phone && dates.includes(b.booking_date)),
  updateBookingStatus: async (id, status) => { STATUS[id] = status; return {}; },
  updateBookingFields: async (id, f) => { PODSOBA[id] = f; },
  getAllSalons: async () => [salon()],
  getBookingsForReminder: async () => [termin({ reminder_sent: false })]
});
podtakni('../src/session', {
  get: () => SEJA, set: () => {}, getOrRestore: async () => SEJA, clear: () => {}
});
podtakni('../src/ai', { askAdminAI: async () => '', askCustomerAI: async () => 'AI ODGOVOR', transcribeAudio: async () => '' });
podtakni('../src/ai-order', { askOrderAI: async () => ({ reply: '' }), computeTotals: () => ({}), aiConfigured: () => false, findService: () => null });
podtakni('../src/email', { send: async () => {}, sendMail: async () => {}, sendEmail: async () => {} });

const { handleMessage } = require('../src/handler');
const { sendReminders } = require('../src/scheduler');
const opomnik = require('../src/opomnik');

/* ── gradniki ──────────────────────────────────────────────────────────── */
let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  if (dobil === pricakoval) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil: ' + dobil + '  pričakoval: ' + pricakoval); }
}
function salon() {
  return {
    id: 'test-salon', name: 'Demo Salon', business_type: 'hair', booking_mode: 'exact_time', bot_active: true,
    admin_phone: '38640000000', whatsapp_phone_number_id: '1', whatsapp_access_token: 'x',
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString()
  };
}
const besedilo = (body) => ({ from: '38641111111', type: 'text', text: { body } });
const gumb = (id) => ({ from: '38641111111', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
async function poslji(msg) {
  POSLANO = []; STATUS = {};
  try { await handleMessage(msg, salon()); } catch (e) { POSLANO.push({ to: '?', besedilo: '[napaka: ' + e.message + ']', gumbi: [] }); }
  return POSLANO;
}
const stranki = () => POSLANO.filter(p => p.to === '38641111111').map(p => p.besedilo).join(' | ');
const lastniku = () => POSLANO.filter(p => p.to === '38640000000').map(p => p.besedilo).join(' | ');

(async () => {
  console.log('── 1) Razbiranje odgovora ───────────────────────────────────');
  je('"DA" je da', opomnik.razberi('', 'DA')?.odgovor, 'da');
  je('"ja, pridem" ni čisti da (gre naprej v pogovor)', opomnik.razberi('', 'ja, pridem jutri malo kasneje'), null);
  je('"Ne" je ne', opomnik.razberi('', 'Ne')?.odgovor, 'ne');
  je('"ne morem" je ne', opomnik.razberi('', 'ne morem!')?.odgovor, 'ne');
  je('"nedelja ob 10?" ni ne', opomnik.razberi('', 'nedelja ob 10?'), null);
  je('gumb NE nosi id termina', opomnik.razberi('opomnik_ne_b-111', '')?.bookingId, 'b-111');

  console.log('\n── 2) Opomnik gre kot predloga z gumboma DA / NE ─────────────');
  POSLANO = []; PODSOBA = {};
  await sendReminders();
  const op = POSLANO[0] || { gumbi: [], telo: [] };
  je('poslan stranki', op.to, '38641111111');
  /*
    Predloga in ne interaktivno sporočilo: prejemnik je rezerviral vsaj dva
    dni prej in je zato skoraj zagotovo zunaj 24-urnega okna, kjer gre skozi
    samo odobrena predloga.
  */
  je('tip je template', op.tip, 'template');
  je('ime predloge', op.predloga, 'salon_opomnik');
  je('jezik je slovenščina', op.jezik, 'sl');
  je('v telesu sta datum in ura', (op.telo || []).slice(1, 2).join(), '15:00');
  je('v telesu je ime lokala', (op.telo || [])[2], 'Demo Salon');
  je('gumb DA', op.gumbi[0], 'opomnik_da_b-111');
  je('gumb NE', op.gumbi[1], 'opomnik_ne_b-111');
  je('reminder_sent se zapiše', PODSOBA['b-111']?.reminder_sent, true);

  console.log('\n── 2b) Če pošiljanje pade, opomnik ni označen za poslanega ───');
  {
    const pravSend = require('../src/whatsapp').send;
    require('../src/whatsapp').send = async () => { throw new Error('WA #131047: zunaj 24h okna'); };
    POSLANO = []; PODSOBA = {};
    await sendReminders();
    je('reminder_sent ostane nepostavljen', PODSOBA['b-111'], undefined);
    require('../src/whatsapp').send = pravSend;
  }

  console.log('\n── 3) Gumb NE odpove termin in ga sprosti ────────────────────');
  TERMINI = [termin()]; SEJA = {};
  await poslji(gumb('opomnik_ne_b-111'));
  je('termin je odpovedan (status cancelled → spet prost)', STATUS['b-111'], 'cancelled');
  je('stranka dobi potrditev odpovedi', /odpovedan/i.test(stranki()), true);
  je('lastnik dobi obvestilo, da je termin prost', /spet prost/i.test(lastniku()), true);

  console.log('\n── 4) Besedilo "ne" deluje enako ─────────────────────────────');
  await poslji(besedilo('ne'));
  je('termin je odpovedan', STATUS['b-111'], 'cancelled');

  console.log('\n── 5) DA potrdi, termin ostane ───────────────────────────────');
  await poslji(besedilo('Da'));
  je('status se ne spremeni', STATUS['b-111'], undefined);
  je('stranka dobi zahvalo z uro', /Vidimo se jutri ob 15:00/.test(stranki()), true);

  console.log('\n── 6) Brez opomnika "da" ni odgovor na opomnik ───────────────');
  TERMINI = [];
  await poslji(besedilo('da'));
  je('nič se ne odpove', STATUS['b-111'], undefined);
  je('ni zahvale za potrditev', /Hvala za potrditev/.test(stranki()), false);

  console.log('\n── 7) Sredi drugega pogovora "ne" ne odpove termina ──────────');
  TERMINI = [termin()]; SEJA = { step: 4 };
  await poslji(besedilo('ne'));
  je('termin ostane', STATUS['b-111'], undefined);
  SEJA = {};

  console.log('\n── 8) Gumb starega opomnika ──────────────────────────────────');
  TERMINI = [];
  await poslji(gumb('opomnik_ne_b-999'));
  je('nič se ne odpove', Object.keys(STATUS).length, 0);
  je('stranka izve, da termina ni več', /ni več med prihajajočimi/.test(stranki()), true);

  /*
    Tapnjen gumb na PREDLOGI ne pride kot interactive, ampak kot sporočilo
    tipa 'button' s tovorom. To je prava pot v produkciji — gumbi, preizkušeni
    zgoraj, veljajo le znotraj 24-urnega okna.
  */
  console.log('\n── 9) Gumb na predlogi (tip button, tovor) ───────────────────');
  TERMINI = [termin()]; SEJA = {};
  await poslji({ from: '38641111111', type: 'button', button: { payload: 'opomnik_ne_b-111', text: 'NE' } });
  je('termin je odpovedan', STATUS['b-111'], 'cancelled');
  je('stranka dobi potrditev odpovedi', /odpovedan/i.test(stranki()), true);

  console.log('\n── 10) Meja "rezervirano pred današnjim dnem" ────────────────');
  /*
    created_at je v bazi UTC, meja pa mora biti konec dneva po slovenskem
    času. Poleti sta to dve uri: rezervacija ob 1:30 ponoči je v UTC še
    prejšnji dan in bi ob naivni primerjavi veljala za staro.
  */
  const t2 = require('../src/time');
  je('poletje: konec dneva je 21:59:59Z', t2.konecDnevaUtc('2026-07-15'), '2026-07-15T21:59:59.000Z');
  je('zima: konec dneva je 22:59:59Z', t2.konecDnevaUtc('2026-01-15'), '2026-01-15T22:59:59.000Z');
  je('dan prehoda na poletni čas', t2.konecDnevaUtc('2026-03-29'), '2026-03-29T21:59:59.000Z');
  je('dan prehoda na zimski čas', t2.konecDnevaUtc('2026-10-25'), '2026-10-25T22:59:59.000Z');

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
