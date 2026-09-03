require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const { handleMessage } = require('./src/handler');
const { getAdapter } = require('./src/pos-adapters');
const db = require('./src/supabase');
const wa = require('./src/whatsapp');
const mail = require('./src/email');
const { startScheduler } = require('./src/scheduler');
const ownerAuth = require('./src/auth');
const { getPreset, listBusinessTypes, normalizeBusinessType, slugify, planLimit } = require('./src/presets');
const plans = require('./src/plans');
// Stanje naročnin beremo iz Stripa (pull), ne prek webhooka — glej opombo v modulu.
const stripeSync = require('./src/stripe-sync');
const { stripeClient, stripePriceId } = stripeSync;
const t = require('./src/time');
const urnik = require('./src/urnik');
const dostava = require('./src/dostava');
const { botMsg, DEFAULTS: BOT_MSG_DEFAULTS, KEYS: BOT_MSG_KEYS } = require('./src/botmsg');

const app = express();

app.use(express.json({ limit: '22mb' }));

/*
  ─── Stara domena → nova (301) ─────────────────────────────────────────────
  Izdelek se je preimenoval iz FlowTiq v FlowTek; poti se preslikajo 1 : 1,
  vključno z /restavracije in /panoga/*. Stara domena naj ostane priklopljena
  vsaj 12 mesecev, da se prenese avtoriteta in da stari zaznamki delujejo.

  Dve namerni izjemi, brez katerih bi preusmeritev podrla delovanje:
    - samo GET in HEAD. Meta ob POST na /webhook preusmeritve ne sledi, zato
      bi 301 pomenil izgubljena sporočila strank.
    - /webhook in /api/ nikoli. Tudi če Meta ali kak odjemalec še kaže na
      staro domeno, mora klic dobiti odgovor, ne preusmeritve.
*/
/*
  PREUSMERITEV JE PRIVZETO IZKLOPLJENA.

  Dokler flowtek.si ne obstaja, bi 301 pomenil, da vsak obiskovalec
  flowtiq.si pristane na domeni brez odziva — stran bi bila za vse
  nedosegljiva. To ni tveganje, ampak gotovost.

  Ko bo nova domena priklopljena, se preusmeritev vklopi z okoljsko
  spremenljivko na gostovanju (brez posega v kodo in brez ponovne objave):

      PREUSMERI_NA_NOVO_DOMENO = 1

  Preveri: https://flowtiq.si/cenik.html mora vrniti 301 na
  https://flowtek.si/cenik.html.
*/
const NOVA_DOMENA = process.env.NOVA_DOMENA || 'https://flowtek.si';
const STARE_DOMENE = ['flowtiq.si', 'www.flowtiq.si'];
const PREUSMERI = process.env.PREUSMERI_NA_NOVO_DOMENO === '1';
app.use((req, res, next) => {
  if (!PREUSMERI) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const gostitelj = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!STARE_DOMENE.includes(gostitelj)) return next();
  if (req.path === '/webhook' || req.path.startsWith('/api/')) return next();
  res.redirect(301, NOVA_DOMENA + req.originalUrl);
});

// ─── Static files (dashboard) ─────────────────────────────
// Preusmeritve po preimenovanju strani (stari zaznamki/emaili ostanejo veljavni)
app.get('/dashboard.html', (req, res) => { const qs = req.originalUrl.split('?')[1]; res.redirect(302, '/admin.html' + (qs ? '?' + qs : '')); });
app.get('/settings.html', (req, res) => { const qs = req.originalUrl.split('?')[1]; res.redirect(302, '/salon.html' + (qs ? '?' + qs : '')); });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/restavracije', (req, res) => res.sendFile(path.join(__dirname, 'public', 'restavracije.html')));
app.get('/voznik', (req, res) => res.sendFile(path.join(__dirname, 'public', 'voznik.html')));
// Ponastavitev pozabljenega gesla — ena stran za zahtevo in za novo geslo.
app.get('/geslo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'geslo.html')));
// Čista naslova za prijavo in registracijo.
app.get('/prijava', (req, res) => res.sendFile(path.join(__dirname, 'public', 'prijava.html')));
/*
  Samostrežne registracije ni — priklop ni avtomatiziran, zato je edina pot do
  računa obrazec na /kontakt.html. Stara naslova se preusmerita tja, da nobena
  že poslana povezava ne obvisi v zraku.
*/
app.get('/registracija', (req, res) => res.redirect(302, '/kontakt.html'));
app.get('/registracija.html', (req, res) => res.redirect(302, '/kontakt.html'));

function cleanPhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function masterAdminPhones() {
  return new Set([
    process.env.MASTER_ADMIN_PHONES,
    process.env.ADMIN_PHONE
  ].filter(Boolean).join(',')
    .split(',')
    .map(cleanPhone)
    .filter(Boolean));
}

function isMasterAdminPhone(phone) {
  return masterAdminPhones().has(cleanPhone(phone));
}

/*
  ─── Omejevanje zahtev ────────────────────────────────────────────────────────

  Dve stvari, ki sta bili prej narobe in bi omejevanje prijav naredili
  brezpredmetno:

  1. IP se je bral kot PRVI vnos v x-forwarded-for. Tega pošlje odjemalec,
     posrednik ga le dopolni — napadalec je torej lahko ob vsaki zahtevi
     napisal drug IP in se omejitvi izognil. Zdaj vzamemo ZADNJI vnos, ki ga
     doda najbližji posrednik in ga odjemalec ne more ponarediti.

  2. Ob 10.000 vnosih se je celotna mapa izpraznila, s čimer je napadalec z
     zahtevami na naključne poti pobrisal števce vsem. Zdaj počistimo samo
     iztečene vnose.

  Pri prijavah omejujemo predvsem po IDENTITETI (e-pošta, telefon), ker je ta
  neponaredljiva; IP je le groba dodatna zavora.
*/
const rateBuckets = new Map();

function odjemalecIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.ip || 'unknown');
}

function pocistiIztecene(now) {
  for (const [k, b] of rateBuckets) if (now - b.start > b.window) rateBuckets.delete(k);
}

/*
  maxReq zahtev v windowMs. `kljucIz` neobvezno vrne dodaten del ključa
  (npr. e-pošto); če vrne null, se ta omejitev za to zahtevo preskoči.
*/
function rateLimit(maxReq, windowMs, kljucIz) {
  return (req, res, next) => {
    const dodatek = kljucIz ? kljucIz(req) : odjemalecIp(req);
    if (dodatek == null) return next();
    const key = req.path + '|' + dodatek;
    const now = Date.now();

    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0, window: windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;

    if (rateBuckets.size > 10000) pocistiIztecene(now);
    if (bucket.count > maxReq) {
      const cezSekund = Math.ceil((bucket.start + windowMs - now) / 1000);
      res.set('Retry-After', String(Math.max(1, cezSekund)));
      return res.status(429).json({ error: 'Preveč poskusov. Poskusite čez nekaj minut.' });
    }
    next();
  };
}

// Prijave: omejitev po identiteti IN po IP. Prva ustavi napad na en račun z
// več naslovov, druga pa preizkušanje mnogih računov z enega naslova.
const poEposti = polje => req => {
  const v = String(req.body?.[polje] || '').trim().toLowerCase();
  return v ? 'e:' + v : null;
};
const poTelefonu = polje => req => {
  const v = String(req.body?.[polje] || '').replace(/\D/g, '');
  return v ? 't:' + v : null;
};
const poIp = () => req => 'ip:' + odjemalecIp(req);

// 10 poskusov na 15 minut na identiteto, 30 na 15 minut na IP.
const omejiPrijavo = polje => [
  rateLimit(10, 15 * 60 * 1000, poEposti(polje)),
  rateLimit(30, 15 * 60 * 1000, poIp())
];

function defaultFormFields(salon) {
  const type = salon?.business_type || 'custom';
  const fields = {
    tattoo: [
      { id: 'idea',      label: 'Opiši svojo tattoo idejo',          type: 'textarea', required: true },
      { id: 'placement', label: 'Mesto na telesu (npr. podlaket)',    type: 'text',     required: true },
      { id: 'size',      label: 'Približna velikost (npr. 10×10 cm)', type: 'text',     required: false },
      { id: 'reference', label: 'Imaš referenčno sliko? (da / ne)',   type: 'text',     required: false }
    ],
    photography: [
      { id: 'shoot_type', label: 'Vrsta fotografiranja (portret / družina / poslovni / event)', type: 'text',     required: true },
      { id: 'location',   label: 'Željeno mesto snemanja',                                      type: 'text',     required: false },
      { id: 'people',     label: 'Število oseb',                                                type: 'text',     required: false },
      { id: 'date_wish',  label: 'Željeni datum ali obdobje',                                   type: 'text',     required: false }
    ],
    veterinary: [
      { id: 'pet_name',  label: 'Ime živali',                          type: 'text', required: true },
      { id: 'pet_type',  label: 'Vrsta živali (pes / mačka / ...)',    type: 'text', required: true },
      { id: 'complaint', label: 'Kratko opiši težavo (opcijsko)',      type: 'text', required: false }
    ],
    physiotherapy: [
      { id: 'complaint', label: 'Opiši težavo ali poškodbo',           type: 'textarea', required: true },
      { id: 'since',     label: 'Kdaj se je začelo? (opcijsko)',       type: 'text',     required: false },
      { id: 'prev',      label: 'Ste bili že pri fizioterapevtu? (da/ne)', type: 'text', required: false }
    ],
    dentist: [
      { id: 'complaint',  label: 'Kratko opiši težavo (opcijsko)',      type: 'text', required: false },
      { id: 'is_patient', label: 'Ste naš pacient? (da / ne)',          type: 'text', required: false }
    ],
    massage: [
      { id: 'health',    label: 'Zdravstvene omejitve ali alergije na olja? (opcijsko)', type: 'text', required: false }
    ],
    fitness: [
      { id: 'goal',      label: 'Vaš cilj (izguba teže / moč / kondicija / ...)',        type: 'text', required: false },
      { id: 'level',     label: 'Izkušnje s treningom (začetnik / srednji / napredni)',  type: 'text', required: false }
    ],
    wellness: [
      { id: 'people',    label: 'Število oseb',                                           type: 'text', required: false },
      { id: 'wishes',    label: 'Posebne želje ali prehranske omejitve (opcijsko)',        type: 'text', required: false }
    ]
  };
  return fields[type] || [];
}

function defaultBookingMode(type) {
  if (['restaurant', 'pizzeria', 'burger', 'kebab'].includes(type)) return 'delivery';
  if (type === 'tattoo' || type === 'photography') return 'inquiry';
  return 'exact_time';
}

function safeFormFields(value, salon) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return defaultFormFields(salon);
}

function normalizeBookingMode(mode) {
  return ['exact_time', 'date_only', 'inquiry', 'month_only', 'sales', 'delivery', 'pos_order'].includes(mode) ? mode : 'exact_time';
}

function publicSalon(salon) {
  return {
    id: salon.id,
    name: salon.name,
    owner_email: salon.owner_email || '',
    business_type: salon.business_type || 'hair',
    business_label: salon.business_label || getPreset(salon.business_type || 'hair').label,
    business_slug: salon.business_slug,
    bot_phone_display: salon.bot_phone_display || '',
    greeting_message: salon.greeting_message || getPreset(salon.business_type || 'hair').greeting,
    working_days: salon.working_days || '1,2,3,4,5,6',
    working_hours_start: salon.working_hours_start,
    working_hours_end: salon.working_hours_end,
    urnik: urnik.zaVmesnik(salon),
    booking_interval_minutes: salon.booking_interval_minutes || 30,
    break_between_minutes: salon.break_between_minutes || 0,
    max_advance_days: salon.max_advance_days || 30,
    booking_mode: normalizeBookingMode(salon.booking_mode),
    datetime_position: salon.datetime_position === 'last' ? 'last' : 'first',
    notify_whatsapp: salon.notify_whatsapp !== false,
    auto_confirm: salon.auto_confirm === true,
    notify_email: salon.notify_email !== false,
    review_link: salon.review_link || '',
    form_fields: safeFormFields(salon.form_fields, salon),
    inquiry_confirmation_message: salon.inquiry_confirmation_message || 'Hvala! Vaše povpraševanje je poslano. Kontaktirali vas bomo za potrditev.',
    booking_confirmation_message: salon.booking_confirmation_message || ''
  };
}

async function resolveBookSalon(req) {
  const ref = req.query.b || req.query.salon || req.body?.business_slug || req.body?.salonId;
  const salon = await db.resolveSalon(ref);
  if (!salon || salon.subscription_status === 'inactive' || salon.is_active === false) return null;
  return salon;
}

/*
  ─── Preklic sej master adminov ───────────────────────────────────────────────

  isMasterRequest() je sinhron in ga kliče ~40 mest, zato ob vsaki zahtevi ne
  moremo brati baze. Namesto tega imamo majhen predpomnilnik
  (e-pošta -> sessions_valid_from) za dve vrstici v sb_master_admins:
  osvežimo ga ob zagonu, vsakih 60 s in takoj ob odjavi.

  S tem odjava velja tudi po ponovnem zagonu strežnika — pomnilniški seznam
  preklicanih žetonov bi se ob deployu izgubil in bi odjava tiho nehala veljati.
*/
const masterValidFrom = new Map();

async function osveziMasterValidFrom() {
  try {
    const seznam = await db.getMasterAdmins();
    masterValidFrom.clear();
    for (const a of seznam) {
      if (a.email) masterValidFrom.set(String(a.email).toLowerCase(), a.sessions_valid_from || null);
    }
  } catch (e) {
    // Ob napaki obdržimo staro vsebino: raje malo zastarelo kot nič.
    console.error('[auth] osvežitev master sej:', e.message);
  }
}

// Časovno varna primerjava, da dolžina ujemanja ne uhaja skozi čas odziva.
function enakaSkrivnost(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isMasterRequest(req) {
  const configuredApiKey = process.env.ADMIN_API_KEY;
  if (configuredApiKey && enakaSkrivnost(req.headers['x-api-key'], configuredApiKey)) return true;

  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  if (session?.role !== 'master') return false;

  const email = String(session.email || '').toLowerCase();
  if (ownerAuth.jeSejaPreklicana(session, masterValidFrom.get(email))) return false;
  return true;
}

function adminAuth(req, res, next) {
  if (!isMasterRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    if (typeof next === 'function') return;
    return false;
  }
  if (typeof next === 'function') next();
  return true;
}

async function salonAuth(req, res) {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  if (session && session.role !== 'driver') {
    const salon = await db.getSalonById(session.salonId);
    // Lokal je tu itak že prebran, zato preklic seje ne stane dodatne poizvedbe.
    if (salon && !ownerAuth.jeSejaPreklicana(session, salon.sessions_valid_from)) return salon;
  }
  const token = req.headers['x-salon-token'] || req.query.token;
  if (token) {
    const salon = await db.getSalonByToken(token);
    if (salon) return salon;
  }
  res.status(401).json({ error: 'Neveljavna prijava' });
  return null;
}

async function settingsSalonAuth(req, res) {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  if (session?.role === 'master') {
    const salonId = req.query.salonId || req.body?.salonId;
    if (!salonId) {
      res.status(400).json({ error: 'Manjka salonId za master pogled' });
      return null;
    }
    const salon = await db.getSalonById(salonId);
    if (salon) return salon;
    res.status(404).json({ error: 'Salon not found' });
    return null;
  }
  return salonAuth(req, res);
}

// Avtentikacija voznika (vloga 'driver', vezan na svojo picerijo)
async function driverAuth(req, res) {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  if (!session || session.role !== 'driver' || !session.salonId) {
    res.status(401).json({ error: 'Neveljavna prijava voznika' });
    return null;
  }
  const salon = await db.getSalonById(session.salonId);
  if (!salon) { res.status(404).json({ error: 'Lokal ni najden' }); return null; }
  return { salon, driverName: session.driverName || 'Voznik' };
}

function parseDrivers(salon) {
  let list = salon && salon.drivers;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  return Array.isArray(list) ? list : [];
}

async function notifyBookingAdmin(salon, customerName, phone, date, time, ref6, sourceLabel, formAnswers = {}) {
  const to = cleanPhone(salon.admin_phone);
  if (!to) {
    const sent = await mail.sendBookingNotification(salon, customerName, phone, date, time, ref6, sourceLabel, formAnswers);
    if (!sent) console.warn('No admin phone and email provider not configured for booking notification:', salon.id);
    return;
  }
  const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
  const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
  const answersText = Object.keys(formAnswers || {}).length
    ? `\n\n📋 Odgovori strank:\n${Object.entries(formAnswers).map(([k,v]) => `• ${k}: ${v}`).join('\n')}`
    : '';
  try {
    await wa.send(phoneId, token, wa.adminBookingNotif(to, customerName, phone, date, time, ref6));
    // Send form answers as separate text message if any
    if (answersText) {
      try { await wa.send(phoneId, token, wa.textMsg(to, `📋 Odgovori za rezervacijo ${ref6}:${answersText}`)); } catch(e){}
    }
  } catch (e) {
    try {
      await wa.send(phoneId, token, wa.adminBookingNotifSession(to, customerName, phone, date, time, ref6));
      if (answersText) {
        try { await wa.send(phoneId, token, wa.textMsg(to, `📋 Odgovori za rezervacijo ${ref6}:${answersText}`)); } catch(e){}
      }
    } catch (e2) {
      await wa.send(phoneId, token, wa.textMsg(to,
        `Nova ${sourceLabel || 'rezervacija'}\n\n${customerName}\n+${phone}\n${date} ob ${time}\nRef: ${ref6}` + answersText
      ));
    }
  }
}

// ─── Webhook verification (Meta GET request) ──────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Incoming WhatsApp messages ───────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Always respond 200 immediately

  let salon = null;
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages?.length) return;

    const msgObj = entry.messages[0];
    const phoneNumberId = entry.metadata?.phone_number_id;

    // Multi-salon: najdi pravi salon po WhatsApp phone number ID
    salon = phoneNumberId
      ? await db.getSalonByPhoneId(phoneNumberId)
      : await db.getSalon();

    if (!salon) {
      console.error('Salon not found for phone_number_id:', phoneNumberId);
      return;
    }

    // Preveri subscription status
    if (salon.subscription_status === 'inactive') {
      console.log(`Salon ${salon.id} has inactive subscription — ignoring message`);
      return;
    }

    await handleMessage(msgObj, salon);
  } catch (err) {
    console.error('Handler error:', err.message);
    try {
      const waBody = (err.waPayload ? 'PAYLOAD: ' + err.waPayload + '\n' : '')
        + (err.response?.data ? JSON.stringify(err.response.data) : (err.stack || ''));
      await db.logError(salon?.id, 'handler', err.message, waBody);
    } catch(_) {}
    // Varnostna mreža: stranka nikoli ne sme dobiti tišine
    try {
      const entryErr = req.body?.entry?.[0]?.changes?.[0]?.value;
      const fromErr = entryErr?.messages?.[0]?.from;
      if (salon && fromErr) {
        const phoneIdErr = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
        const tokenErr = salon.whatsapp_access_token || process.env.WA_TOKEN;
        await wa.send(phoneIdErr, tokenErr, wa.textMsg(fromErr,
          'Ojoj, prišlo je do kratke tehnične težave. Prosim, pošljite sporočilo še enkrat.'
        ));
      }
    } catch (_) {}
  }
});

// ─── Stripe Webhook ───────────────────────────────────────────

// ─── POS INTEGRATION ENDPOINTS ────────────────────────────────────────────────

// GET /api/pos/menu/:salonId — fetch menu from connected POS
app.get('/api/pos/menu/:salonId', adminAuth, async (req, res) => {
  try {
    const salon = await db.getSalonById(req.params.salonId);
    if (!salon) return res.status(404).json({ error: 'Salon ni najden' });
    if (!salon.pos_type || !salon.pos_token) {
      return res.status(400).json({ error: 'POS ni konfiguriran za ta salon' });
    }
    const adapter = getAdapter(salon.pos_type);
    const menu = await adapter.getMenu(salon.pos_token, salon.pos_account || '');
    res.json({ ok: true, pos_type: salon.pos_type, count: menu.length, menu });
  } catch (e) {
    console.error('POS menu error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/pos/test-connection/:salonId — test POS credentials
app.post('/api/pos/test-connection/:salonId', adminAuth, async (req, res) => {
  try {
    const salon = await db.getSalonById(req.params.salonId);
    if (!salon) return res.status(404).json({ error: 'Salon ni najden' });
    const posType   = req.body.pos_type   || salon.pos_type;
    const posToken  = req.body.pos_token  || salon.pos_token;
    const posAccount = req.body.pos_account || salon.pos_account || '';
    if (!posType || !posToken) {
      return res.status(400).json({ ok: false, msg: 'Manjka pos_type ali pos_token' });
    }
    const adapter = getAdapter(posType);
    const result = await adapter.testConnection(posToken, posAccount);
    res.json(result);
  } catch (e) {
    res.json({ ok: false, msg: e.message });
  }
});

// POST /api/pos/create-order/:salonId — manually create a POS order (for testing)
app.post('/api/pos/create-order/:salonId', adminAuth, async (req, res) => {
  try {
    const salon = await db.getSalonById(req.params.salonId);
    if (!salon) return res.status(404).json({ error: 'Salon ni najden' });
    if (!salon.pos_type || !salon.pos_token) {
      return res.status(400).json({ error: 'POS ni konfiguriran' });
    }
    const { cart, options } = req.body;
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'Manjka cart' });
    }
    const adapter = getAdapter(salon.pos_type);
    const result = await adapter.createOrder(
      salon.pos_token,
      salon.pos_account || '',
      cart,
      { spot_id: salon.pos_spot_id || 1, ...options }
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});


// POST /api/pos/confirm-order/:salonId/:bookingId
// Dashboard: točajka potrdi naročilo → pošlje v POS + obvesti stranko
app.post('/api/pos/confirm-order/:salonId/:bookingId', adminAuth, async (req, res) => {
  try {
    const { salonId, bookingId } = req.params;
    const { minutes } = req.body;

    const salon = await db.getSalonById(salonId);
    if (!salon) return res.status(404).json({ error: 'Salon ni najden' });

    // Fetch booking directly
    const BASE_SB = process.env.SUPABASE_URL + '/rest/v1';
    const SB_HDR  = {
      apikey: process.env.SUPABASE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
      'Content-Type': 'application/json'
    };
    const bRes = await axios.get(`${BASE_SB}/sb_bookings?id=eq.${bookingId}&salon_id=eq.${salonId}&limit=1`, { headers: SB_HDR });
    const b = bRes.data[0];
    if (!b) return res.status(404).json({ error: 'Naročilo ni najdeno' });

    // Parse cart from form_answers
    let posCart = null;
    let posComment = '';
    try {
      const fa = typeof b.form_answers === 'string' ? JSON.parse(b.form_answers) : b.form_answers;
      posCart    = fa?.pos_cart ? JSON.parse(fa.pos_cart) : null;
      posComment = fa?.opomba || '';
    } catch (_) {}

    let posResult = null;
    // Send to POS if configured and cart available
    if (salon.pos_type && salon.pos_token && posCart && posCart.length) {
      const adapter = getAdapter(salon.pos_type);
      posResult = await adapter.createOrder(
        salon.pos_token,
        salon.pos_account || '',
        posCart,
        { spot_id: salon.pos_spot_id || 1, comment: posComment }
      );
    }

    // Update booking status
    await axios.patch(`${BASE_SB}/sb_bookings?id=eq.${bookingId}`,
      { status: 'confirmed' }, { headers: SB_HDR }
    );

    // Notify customer via WhatsApp if phone available
    const custPhone = b.customer_phone;
    const mins = parseInt(minutes) || 0;
    if (custPhone && custPhone !== 'manual' && mins > 0) {
      const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
      const waToken = salon.whatsapp_access_token || process.env.WA_TOKEN;
      if (phoneId && waToken) {
        const { send, textMsg } = require('./src/whatsapp');
        send(phoneId, waToken, textMsg(custPhone,
          `🍽️ Naročilo potrjeno!\n\n⏱️ Pripravljeno v pribl. *${mins} minutah*\n\nHvala za naročilo! 😊`
        )).catch(e => console.error('[confirm-order] WA notify err:', e.message));
      }
    }

    res.json({
      success: true,
      pos: posResult,
      message: posResult?.success
        ? `Naročilo v kuhinji! POS ID: ${posResult.orderId}`
        : (posResult ? `POS napaka: ${posResult.message}` : 'Potrjeno (brez POS)')
    });
  } catch (e) {
    console.error('[confirm-order] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Onboarding API — registracija novega salona ──────────────
app.get('/api/business-types', (req, res) => {
  res.json(listBusinessTypes());
});

// GET /api/public/restaurants — javni seznam lokalov za stran /restavracije
app.get('/api/public/restaurants', async (req, res) => {
  try {
    const list = await db.getPublicRestaurants();
    res.json(list.map(s => ({
      name: s.name || '',
      logo_url: s.logo_url || '',
      address: s.address || '',
      delivery_area: s.delivery_area || '',
      pickup_address: s.pickup_address || '',
      // Značka na kartici pove današnje stanje, podrobno okno pa cel teden.
      odprto: urnik.jeOdprto(s).odprto,
      danes: (() => {
        const d = urnik.zaDan(s, t.todayDow());
        return d ? 'Danes ' + d.od + '–' + d.do : 'Danes zaprto';
      })(),
      urnik_besedilo: urnik.besedilo(s),
      phone: s.bot_phone_display || '',
      business_type: s.business_type || '',
      slug: s.business_slug || '',
      allow_delivery: s.allow_delivery !== false,
      allow_pickup: s.allow_pickup !== false
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/onboard', async (req, res) => {
  if (!adminAuth(req, res)) return;

  const { name, owner_name, owner_email, owner_password, admin_phone, whatsapp_phone_number_id, plan, business_type, business_slug, bot_phone_display } = req.body;
  if (!name || !owner_email) {
    return res.status(400).json({ error: 'name in owner_email sta obvezna' });
  }

  try {
    const type = normalizeBusinessType(business_type || 'hair');
    const preset = getPreset(type);
    const slugBase = slugify(business_slug || name);
    let slug = slugBase;
    let n = 2;
    while (await db.getSalonBySlug(slug)) slug = `${slugBase}-${n++}`;

    const salonData = {
      name,
      owner_name: owner_name || '',
      email: String(owner_email).trim().toLowerCase(),
      owner_email: String(owner_email).trim().toLowerCase(),
      admin_phone: cleanPhone(admin_phone),
      whatsapp_phone_number_id: whatsapp_phone_number_id || process.env.WA_PHONE_ID,
      bot_phone_display: bot_phone_display || '',
      business_type: type,
      business_label: preset.label,
      business_slug: slug,
      greeting_message: preset.greeting,
      booking_mode: defaultBookingMode(type),
      form_fields: defaultFormFields({ business_type: type }),
      subscription_status: 'trial',
      subscription_plan: plan || 'ai',
      working_days: '1,2,3,4,5,6',
      working_hours_start: '08:00',
      working_hours_end: '19:00'
    };

    // Če admin poda geslo, ga takoj nastavi — sicer lastnik dobi email z linkom
    if (owner_password) {
      salonData.owner_password_hash = ownerAuth.hashPassword(owner_password);
      salonData.owner_password_set_at = new Date().toISOString();
    }

    const salon = await db.createSalon(salonData);
    await db.createServicesFromPreset(salon.id, preset.services);

    // Pošlji welcome email z linkom za nastavitev gesla
    const baseUrl = process.env.BASE_URL || 'https://flowtek.si';
    const setupUrl = `${baseUrl}/setup.html?token=${salon.salon_token}`;
    let emailSent = false;
    try {
      emailSent = await mail.sendWelcomeEmail(salon, setupUrl);
    } catch (emailErr) {
      console.warn('Welcome email failed:', emailErr.message);
    }

    console.log('New salon onboarded:', salon.id, name, emailSent ? '(email sent)' : '(email failed)');
    res.json({
      success: true,
      salon_id: salon.id,
      business_slug: slug,
      email_sent: emailSent,
      setup_url: setupUrl,
      message: `Podjetje "${name}" ustvarjeno.${emailSent ? ' Welcome email poslan.' : ' Email ni bil poslan.'}`
    });
  } catch (err) {
    console.error('Onboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─── Katalog paketov ───────────────────────────────────────────
// Cene, meje in oznake so v src/plans.js — edini vir resnice (glej opombo tam).
// planInfo() vedno vrne veljaven paket; neznan zapis pade na DEFAULT_PLAN.
const { planInfo, planPrice } = plans;

// GET /api/plans — cenik za nadzorne plošče, da ga ne prepisujejo v HTML-u.
app.get('/api/plans', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ plans: plans.catalog(), yearly_discount_pct: Math.round(plans.YEARLY_DISCOUNT * 100) });
});

// ─── Javna samopostrežna registracija ──────────────────────────
// Ustvari salon v statusu "čaka na priklop" (bot ugasnjen). AI paketi nimajo
// brezplačnega testa -> billing_status='awaiting' (plačilo predračuna pred priklopom).
/*
  UGASNJENO. Samostrežna registracija je bila edini odjemalec te poti, stran pa
  je odstranjena, ker priklop ni avtomatiziran. Pot je bila nepooblaščena in je
  ustvarjala lokale v bazi, pošiljala e-pošto in odpirala Stripe seje — brez
  strani za njo bi to ostala odprta vrata brez namena.

  Koda spodaj je ohranjena. Za vrnitev samopostrežbe je treba odstraniti ta
  odgovor in vrniti stran.
*/
app.post('/api/signup', (req, res) => res.status(410).json({
  error: 'Samostrežna registracija ni v uporabi. Račun odpremo na podlagi obrazca na /kontakt.html.'
}));

app.post('/api/signup-neuporabljeno', rateLimit(5, 10 * 60 * 1000), async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ success: true }); // honeypot (boti izpolnijo skrito polje)

    const name    = String(b.company_name || b.name || '').trim();
    const email   = String(b.owner_email || b.email || '').trim().toLowerCase();
    const contact = String(b.contact_person || '').trim();
    const vat     = String(b.vat_id || '').trim();
    const address = String(b.address || '').trim();
    const phone   = cleanPhone(b.phone);
    const plan    = plans.planKey(b.plan);
    const payMethod = b.payment_method === 'proforma' ? 'proforma' : 'card';
    const type    = normalizeBusinessType(b.business_type || 'custom');

    if (!name || !email || !contact) {
      return res.status(400).json({ error: 'Naziv firme, kontaktna oseba in email so obvezni.' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Neveljaven email naslov.' });
    }
    const password = String(b.password || '');
    if (password.length < 8) {
      return res.status(400).json({ error: 'Geslo mora imeti vsaj 8 znakov.' });
    }

    const preset = getPreset(type);
    const slugBase = slugify(b.business_slug || name);
    let slug = slugBase, n = 2;
    while (await db.getSalonBySlug(slug)) slug = `${slugBase}-${n++}`;

    const info = planInfo(plan);
    const bookingMode = ['ai_start', 'ai', 'premium'].includes(plan) ? 'delivery' : defaultBookingMode(type);

    const salonData = {
      name,
      company_name: name,
      owner_name: contact,
      contact_person: contact,
      email,
      owner_email: email,
      admin_phone: phone,
      phone,
      vat_id: vat,
      address,
      business_type: type,
      business_label: preset.label,
      business_slug: slug,
      greeting_message: preset.greeting,
      booking_mode: bookingMode,
      form_fields: defaultFormFields({ business_type: type }),
      subscription_plan: plan,
      subscription_status: info.ai ? 'pending_payment' : 'trial',
      signup_status: 'pending',
      billing_status: info.ai ? 'awaiting' : 'none',
      billing_period: b.billing_period === 'yearly' ? 'yearly' : 'monthly',
      owner_password_hash: ownerAuth.hashPassword(password),
      owner_password_set_at: new Date().toISOString(),
      bot_active: false,          // bot ostane ugasnjen do priklopa
      trial_ends_at: null,        // trial za osnovna paketa začne ob priklopu (+30 dni)
      working_days: '1,2,3,4,5,6',
      working_hours_start: '08:00',
      working_hours_end: '19:00'
      // NAMENOMA brez whatsapp_phone_number_id — priklop opravi admin
    };

    const salon = await db.createSalon(salonData);
    // Nove registracije dobijo PRAZEN meni — lastnik (ali admin) ga napolni sam.
    // (Prej se je meni napolnil z demo artikli iz preseta.)

    const baseUrl = process.env.BASE_URL || 'https://flowtek.si';
    const setupUrl = `${baseUrl}/setup.html?token=${salon.salon_token}`;

    // 1) stranki: welcome + link za nastavitev gesla (dostop do dashboarda takoj)
    let custEmail = false;
    try { custEmail = await mail.sendWelcomeEmail(salon, setupUrl); }
    catch (e) { console.warn('Signup welcome email failed:', e.message); }

    // 2) tebi: obvestilo za priklop
    const ownerEmail = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtek.si';
    try {
      await mail.sendEmail(ownerEmail, `Nova registracija — ${name} (${info.label})`, [
        'Nova registracija za priklop:', '',
        `Firma: ${name}`,
        `Kontaktna oseba: ${contact}`,
        `Email: ${email}`,
        `Telefon: ${phone || '-'}`,
        `DDV / davčna: ${vat || '-'}`,
        `Naslov: ${address || '-'}`,
        `Dejavnost: ${preset.label}`,
        `Paket: ${info.label} (${planPrice(plan, salonData.billing_period)} €${info.ai ? ' — vsebuje AI, plačilo predračuna PRED priklopom' : ' — 30 dni brezplačno od priklopa'})`,
        `Obračun: ${salonData.billing_period === 'yearly' ? 'letno' : 'mesečno'}`,
        '', `Salon ID: ${salon.id}`,
        'Priklop opraviš v master dashboardu.'
      ].join('\n'));
    } catch (e) { console.warn('Owner notify email failed:', e.message); }

    console.log('New self-signup:', salon.id, name, info.label, custEmail ? '(cust email sent)' : '(cust email failed)', '·', payMethod);

    // ── Kartično plačilo: ustvari Stripe Checkout in vrni URL za preusmeritev ──
    let checkoutUrl = null;
    if (payMethod === 'card') {
      const stripe = stripeClient();
      const rCena = await stripePriceId(plan, salonData.billing_period, null).catch(e => ({ napaka: 'stripe', podrobno: e.message }));
      if (rCena.napaka) console.warn('[signup] Stripe cena: ' + rCena.podrobno + ' — ponujen bo predračun');
      const priceId = rCena.priceId;
      if (stripe && priceId) {
        try {
          const baseUrl = process.env.BASE_URL || 'https://flowtek.si';
          const returnPage = bookingMode === 'delivery' ? 'delivery.html' : 'salon.html';
          const cs = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            customer_email: email || undefined,
            subscription_data: { metadata: { salon_id: salon.id, plan } },
            metadata: { salon_id: salon.id, plan },
            allow_promotion_codes: true,
            success_url: `${baseUrl}/${returnPage}?billing=success`,
            cancel_url: `${baseUrl}/kontakt.html?billing=cancel`
          });
          checkoutUrl = cs.url;
        } catch (e) {
          console.warn('Signup Stripe checkout failed, fallback na predračun:', e.message);
        }
      }
    }

    res.json({
      success: true,
      salon_id: salon.id,
      ai: info.ai,
      email_sent: custEmail,
      checkout_url: checkoutUrl,
      login_url: '/prijava.html',
      message: checkoutUrl
        ? 'Preusmerjamo vas na varno plačilo s kartico…'
        : (info.ai
          ? 'Registracija uspešna! Za aktivacijo prejmete predračun — po plačilu vas priklopimo in pošljemo račun.'
          : 'Registracija uspešna! Kontaktirali vas bomo za priklop (aktivacijo). Preverite email za dostop do nadzorne plošče.')
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Napaka pri registraciji. Poskusite znova ali nas kontaktirajte.' });
  }
});


// ─── Priklop (aktivacija) salona — master ──────────────────────
// Za AI pakete zahteva plačan predračun (razen ?force). Trial osnovnih paketov
// začne ob priklopu (+30 dni). Bot se prižge (bot_active=true).
app.post('/api/admin/activate/:id', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon ne obstaja' });
    const info = planInfo(salon.subscription_plan);
    if (info.ai && salon.billing_status !== 'paid' && req.body?.force !== true) {
      return res.status(400).json({ error: 'AI paket ni plačan. Najprej označi predračun kot plačan (ali pošlji force:true).' });
    }
    const updates = {
      signup_status: 'active',
      bot_active: true,
      subscription_status: info.ai ? 'active' : 'trial',
      activated_at: new Date().toISOString()
    };
    if (req.body?.whatsapp_phone_number_id) updates.whatsapp_phone_number_id = String(req.body.whatsapp_phone_number_id).trim();
    if (req.body?.whatsapp_access_token)   updates.whatsapp_access_token   = String(req.body.whatsapp_access_token).trim();
    const addPeriod = (from) => { const d = new Date(from); salon.billing_period === 'yearly' ? d.setFullYear(d.getFullYear() + 1) : d.setMonth(d.getMonth() + 1); return d.toISOString(); };
    if (info.ai) {
      updates.valid_until = addPeriod(Date.now());              // plačano obdobje
    } else {
      const t30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 dni brezplačno od priklopa
      updates.trial_ends_at = t30;
      updates.valid_until = t30;
    }
    const updated = await db.updateSalonSettings(salon.id, updates);
    console.log('Salon activated (priklop):', salon.id, salon.name);
    res.json({ success: true, salon: updated || null });
  } catch (err) { console.error('Activate error:', err.message); res.status(500).json({ error: err.message }); }
});

// ─── Označi predračun kot plačan — master ──────────────────────
app.post('/api/admin/mark-paid/:id', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon ne obstaja' });
    // Podaljšaj veljavnost od maksimuma (obstoječi valid_until ali danes) za obračunsko obdobje
    const base = (salon.valid_until && new Date(salon.valid_until) > new Date()) ? new Date(salon.valid_until) : new Date();
    salon.billing_period === 'yearly' ? base.setFullYear(base.getFullYear() + 1) : base.setMonth(base.getMonth() + 1);
    const updates = { billing_status: 'paid', paid_at: new Date().toISOString(), subscription_status: 'active', valid_until: base.toISOString(), renewal_reminded_at: null, grace_notified_at: null, paused_notified_at: null };
    if (req.body?.invoice_no) updates.invoice_no = String(req.body.invoice_no).trim();
    // Če je stranka zahtevala nadgradnjo/podaljšanje na drug paket — ga uveljavi in počisti zahtevo
    if (salon.renewal_requested_plan) {
      updates.subscription_plan = salon.renewal_requested_plan;
      updates.renewal_requested_plan = null;
      updates.renewal_requested_at = null;
    }
    const updated = await db.updateSalonSettings(salon.id, updates);
    console.log('Salon marked paid:', salon.id, salon.name);
    res.json({ success: true, salon: updated || null });
  } catch (err) { console.error('Mark-paid error:', err.message); res.status(500).json({ error: err.message }); }
});


/*
  POST /api/admin/salons/:id/podaljsaj
  Ročno podaljšanje naročnine: administrator lokalu doda N mesecev izbranega
  paketa, brez predračuna in brez Stripa. Za primere, ko se plača drugače
  (nakazilo, dogovor, dobropis) ali ko naročnina poteče prej, kot pride plačilo.

  Telo: { mesecev: 1–24, plan?: 'ai_start'|'ai'|'premium' }

  Podaljša od MAKSIMUMA obstoječe veljavnosti in današnjega dneva, zato
  podaljšanje pred iztekom ne izgubi preostalih dni.
*/
app.post('/api/admin/salons/:id/podaljsaj', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const mesecev = parseInt(req.body?.mesecev, 10);
  if (!Number.isInteger(mesecev) || mesecev < 1 || mesecev > 24) {
    return res.status(400).json({ error: 'Število mesecev mora biti med 1 in 24' });
  }
  const zeljenPaket = req.body?.plan;
  if (zeljenPaket !== undefined && zeljenPaket !== null && zeljenPaket !== '' && !plans.isPlan(zeljenPaket)) {
    return res.status(400).json({ error: 'Neveljaven paket' });
  }
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Lokal ne obstaja' });

    const zdaj = new Date();
    const veljaSe = salon.valid_until && new Date(salon.valid_until) > zdaj;
    const osnova = veljaSe ? new Date(salon.valid_until) : new Date(zdaj);
    osnova.setMonth(osnova.getMonth() + mesecev);

    const paket = plans.isPlan(zeljenPaket) ? zeljenPaket : salon.subscription_plan;
    const updates = {
      subscription_plan: paket,
      subscription_status: 'active',
      billing_status: 'paid',
      paid_at: zdaj.toISOString(),
      valid_until: osnova.toISOString(),
      renewal_reminded_at: null,
      grace_notified_at: null,
      paused_notified_at: null,
      renewal_requested_plan: null,
      renewal_requested_at: null
    };
    // Bota vklopimo samo, kadar je WhatsApp res priklopljen — enako, kot
    // presoja plačilo prek Stripa. Sicer bi obljubili delujočega bota.
    const waDela = stripeSync.waPriklopljen(salon);
    if (waDela) {
      updates.bot_active = true;
      updates.signup_status = 'active';
      if (!salon.activated_at) updates.activated_at = zdaj.toISOString();
    }

    await db.updateSalonSettings(salon.id, updates);

    // Opozoril je lahko več in so neodvisna — zato seznam in ne eno polje.
    const opozorila = [];
    if (!!salon.stripe_subscription_id && salon.subscription_status === 'active') {
      opozorila.push('Lokal ima aktivno Stripe naročnino — urna uskladitev bo veljavnost vzela iz Stripa in to podaljšanje povozila.');
    }
    if (!waDela) {
      opozorila.push('WhatsApp ni priklopljen, zato bot ni vklopljen. Naročnina je podaljšana.');
    }

    console.log('[podaljsaj]', salon.name, paket, '+' + mesecev + ' mes →', updates.valid_until);
    res.json({
      success: true,
      paket,
      mesecev,
      valid_until: updates.valid_until,
      podaljsano_od: veljaSe ? 'obstoječe veljavnosti' : 'danes',
      bot_vklopljen: waDela,
      opozorila
    });
  } catch (err) {
    console.error('[podaljsaj]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Zahteva lastnika za podaljšanje/nadgradnjo naročnine ──────
app.post('/api/settings/request-renewal', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const desiredPlan = plans.isPlan(req.body?.plan) ? req.body.plan : salon.subscription_plan;
    const cur = planInfo(salon.subscription_plan);
    const want = planInfo(desiredPlan);
    const owner = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtek.si';
    await mail.sendEmail(owner, `Zahteva za podaljšanje/nadgradnjo — ${salon.name}`, [
      'Stranka želi podaljšati ali nadgraditi naročnino:', '',
      `Lokal: ${salon.name}${salon.company_name ? ' (' + salon.company_name + ')' : ''}`,
      `Kontakt: ${salon.contact_person || salon.owner_name || '-'} · ${salon.owner_email || '-'} · ${salon.admin_phone || '-'}`,
      `Trenutni paket: ${cur.label}`,
      `Želeni paket: ${want.label} (${planPrice(desiredPlan, salon.billing_period)} €)`,
      `Obračun: ${salon.billing_period === 'yearly' ? 'letno' : 'mesečno'}`,
      `Velja do: ${salon.valid_until ? new Date(salon.valid_until).toLocaleDateString('sl-SI') : '-'}`,
      '', `Salon ID: ${salon.id}`,
      'Izdaj predračun in po plačilu klikni "Označi plačano" (podaljša veljavnost).'
    ].join('\n'));
    await db.updateSalonSettings(salon.id, { renewal_requested_plan: desiredPlan, renewal_requested_at: new Date().toISOString() }).catch(() => {});
    res.json({ success: true, message: 'Zahteva je poslana. Kmalu vas kontaktiramo s predračunom.' });
  } catch (err) { console.error('Renewal request error:', err.message); res.status(500).json({ error: err.message }); }
});

// ─── Pošlji predračun na email stranke (HTML + PDF priponka) — master ───
app.post('/api/admin/send-proforma/:id', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon ne obstaja' });
    if (!salon.owner_email) return res.status(400).json({ error: 'Salon nima emaila stranke.' });
    const plan = plans.isPlan(req.body?.plan) ? req.body.plan : (salon.renewal_requested_plan || salon.subscription_plan);
    const proforma = require('./src/proforma');
    const c = proforma.computeProforma(salon, plan);
    const html = proforma.proformaHtml(salon, plan);
    let attachments = [];
    try {
      const pdf = await proforma.proformaPdf(salon, plan);
      attachments = [{ filename: `Predracun-${c.no}.pdf`, content: pdf.toString('base64') }];
    } catch (e) { console.warn('Proforma PDF ni uspel, pošiljam samo HTML:', e.message); }
    const sent = await mail.sendEmail(salon.owner_email, `Predračun ${c.no} — FlowTek`, html, attachments);
    if (!sent) return res.status(500).json({ error: 'Email ni bil poslan (preveri Resend).' });
    const updated = await db.updateSalonSettings(salon.id, {
      billing_status: 'awaiting', proforma_no: c.no, proforma_amount: c.amount, proforma_issued_at: new Date().toISOString()
    });
    res.json({ success: true, pdf: attachments.length > 0, message: `Predračun ${c.no} poslan na ${salon.owner_email}${attachments.length ? ' (s PDF)' : ' (brez PDF)'}.`, salon: updated || null });
  } catch (err) { console.error('send-proforma error:', err.message); res.status(500).json({ error: err.message }); }
});


// ─── Delete salon (master admin only) ──────────────────────────
app.delete('/api/admin/salons/:id', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    await db.deleteSalon(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Owner password setup (via email link) ───────────────────
app.get('/api/owner/setup-check', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token manjka' });
  try {
    const salon = await db.getSalonByToken(token);
    if (!salon) return res.status(404).json({ error: 'Neveljaven ali potekel link' });
    res.json({ valid: true, salon_name: salon.name, owner_name: salon.owner_name || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/owner/setup-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token in geslo sta obvezna' });
  if (password.length < 8) return res.status(400).json({ error: 'Geslo mora imeti vsaj 8 znakov' });
  try {
    const salon = await db.getSalonByToken(token);
    if (!salon) return res.status(404).json({ error: 'Neveljaven ali potekel link' });
    await db.updateSalonSettings(salon.id, {
      owner_password_hash: ownerAuth.hashPassword(password),
      owner_password_set_at: new Date().toISOString()
    });
    const sessionToken = ownerAuth.createSession(salon.id, 'owner', { email: salon.owner_email });
    res.json({ success: true, token: sessionToken, message: 'Geslo nastavljeno. Preusmerjam...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Resend welcome email (admin) ────────────────────────────
app.post('/api/admin/resend-welcome', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { salon_id } = req.body;
  if (!salon_id) return res.status(400).json({ error: 'salon_id je obvezen' });
  try {
    const salon = await db.getSalonById(salon_id);
    if (!salon) return res.status(404).json({ error: 'Salon ne obstaja' });
    if (!salon.owner_email) return res.status(400).json({ error: 'Salon nima owner_email' });
    const baseUrl = process.env.BASE_URL || 'https://flowtek.si';
    const setupUrl = `${baseUrl}/setup.html?token=${salon.salon_token}`;
    const sent = await mail.sendWelcomeEmail(salon, setupUrl);
    if (!sent) return res.status(500).json({ error: 'Email ni bil poslan (Resend ni konfiguriran)' });
    res.json({ success: true, message: `Email poslan na ${salon.owner_email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Salons list (admin) ──────────────────────────────────────
app.get('/salons', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salons = await db.getAllSalons();
    res.json(salons.map(s => ({
      id: s.id,
      name: s.name,
      business_type: s.business_type || 'hair',
      booking_mode: s.booking_mode || 'exact_time',
      business_label: s.business_label || getPreset(s.business_type || 'hair').label,
      business_slug: s.business_slug || '',
      bot_phone_display: s.bot_phone_display || '',
      whatsapp_phone_number_id: s.whatsapp_phone_number_id || '',
      has_wa_token: !!s.whatsapp_access_token,
      owner_name: s.owner_name,
      owner_email: s.owner_email,
      owner_password_configured: !!s.owner_password_hash,
      subscription_status: s.subscription_status,
      subscription_plan: s.subscription_plan,
      signup_status: s.signup_status || 'active',
      billing_status: s.billing_status || 'none',
      billing_period: s.billing_period || 'monthly',
      valid_until: s.valid_until || null,
      company_name: s.company_name || '',
      vat_id: s.vat_id || '',
      contact_person: s.contact_person || '',
      address: s.address || '',
      renewal_requested_plan: s.renewal_requested_plan || null,
      renewal_requested_at: s.renewal_requested_at || null,
      admin_phone: s.admin_phone,
      // Za značko 💳 Stripe: brez teh dveh je admin ni mogel prikazati.
      stripe_customer_id: s.stripe_customer_id || null,
      stripe_subscription_id: s.stripe_subscription_id || null,
      // Za značko "javen brez številke": lokal v imeniku brez bot_phone_display
      // obiskovalec vidi, naročiti pa ne more.
      listed_public: s.listed_public === true,
      created_at: s.created_at
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update salon status (admin dashboard) ───────────────────
app.patch('/api/salons/:id/status', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { id } = req.params;
  const { status } = req.body;
  if (!['active', 'inactive', 'trial'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const axios = require('axios');
    const BASE = process.env.SUPABASE_URL + '/rest/v1';
    const HEADERS = {
      apikey: process.env.SUPABASE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    };
    await axios.patch(`${BASE}/sb_salons?id=eq.${id}`, { subscription_status: status }, { headers: HEADERS });
    console.log(`Salon ${id} status → ${status}`);
    res.json({ success: true, status });
  } catch (err) {
    console.error('Status update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Send welcome EMAIL to salon owner ────────────────────────
app.post('/api/salons/:id/welcome', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { id } = req.params;
  try {
    const salon = (await db.getAllSalons()).find(s => s.id === id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });

    const to = salon.owner_email;
    if (!to) return res.status(400).json({ error: 'Salon nima nastavljenega emaila (owner_email).' });

    const salonName = salon.name || 'vaše podjetje';
    const contact = salon.contact_person || salon.owner_name || '';
    const baseUrl = process.env.BASE_URL || 'https://flowtek.si';
    // Ena prijava za vse — stran sama odpre pravo ploščo. Stara naslova
    // (salon.html, delivery.html) ostaneta delujoča zaradi že poslanih e-pošt.
    const loginUrl = `${baseUrl}/prijava.html`;

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#f6f9f8;padding:0">
        <div style="background:linear-gradient(135deg,#0e7a5f,#0aa06e);padding:28px 24px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#fff">FlowTek</div>
        </div>
        <div style="padding:28px 24px;color:#1e293b;line-height:1.7">
          <h2 style="margin:0 0 8px;color:#0e7a5f">Dobrodošli v FlowTek! 🎉</h2>
          <p style="margin:0 0 14px">Pozdravljeni${contact ? ' ' + contact : ''},</p>
          <p style="margin:0 0 14px">vaš FlowTek asistent za <strong>${salonName}</strong> je aktiviran in pripravljen na delo.</p>
          <p style="margin:0 0 14px">Od zdaj vaše stranke naročajo in rezervirajo kar prek WhatsAppa — 24/7, brez klicanja in čakanja. Ob vsakem novem naročilu oz. rezervaciji boste takoj obveščeni, vse skupaj pa pregledno spremljate na svoji nadzorni plošči.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${loginUrl}" style="display:inline-block;background:#0aa06e;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Odpri nadzorno ploščo →</a>
          </div>
          <p style="margin:0 0 14px">Če potrebujete pomoč ali kakšno spremembo, nam kar odgovorite na ta email — z veseljem pomagamo. 🙌</p>
          <p style="margin:0">Želimo vam obilo naročil in zadovoljnih strank! 🚀</p>
        </div>
        <div style="padding:16px 24px;text-align:center;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0">— Ekipa FlowTek · <a href="https://flowtek.si" style="color:#0e7a5f;text-decoration:none">flowtek.si</a></div>
      </div>`;

    const ok = await mail.sendEmail(to, `Dobrodošli v FlowTek — ${salonName} je aktiviran 🎉`, html);
    if (!ok) return res.status(500).json({ error: 'Email ni bil poslan (preveri RESEND_API_KEY / EMAIL_FROM).' });
    console.log(`Welcome email sent to ${to} for salon ${salonName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Welcome error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Update salon plan (admin dashboard) ─────────────────────
app.patch('/api/salons/:id/plan', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { id } = req.params;
  const { plan, billing_period } = req.body;
  if (!plans.isPlan(plan)) return res.status(400).json({ error: 'Invalid plan' });
  try {
    const axios = require('axios');
    const BASE = process.env.SUPABASE_URL + '/rest/v1';
    const HEADERS = {
      apikey: process.env.SUPABASE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    };
    const patch = { subscription_plan: plan };
    if (billing_period === 'yearly' || billing_period === 'monthly') patch.billing_period = billing_period;
    await axios.patch(`${BASE}/sb_salons?id=eq.${id}`, patch, { headers: HEADERS });
    console.log(`Salon ${id} plan → ${plan}${patch.billing_period ? ' (' + patch.billing_period + ')' : ''}`);
    res.json({ success: true, plan, billing_period: patch.billing_period });
  } catch (err) {
    console.error('Plan update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Error log (admin dashboard) ─────────────────────────────
app.get('/api/admin/salons/:id/settings', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    res.json({
      ...publicSalon(salon),
      owner_name: salon.owner_name || '',
      owner_email: salon.owner_email || '',
      owner_password_configured: !!salon.owner_password_hash,
      custom_price_id: salon.custom_price_id || '',
      ai_monthly_limit: parseInt(salon.ai_monthly_limit) || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/salons/:id/settings', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const allowed = [
    'name',
    'business_slug',
    'business_type',
    'bot_phone_display',
    'whatsapp_phone_number_id',
    'whatsapp_access_token',
    'greeting_message',
    'working_days',
    'working_hours_start',
    'working_hours_end',
    'working_hours',
    'delivery_zones',
    'booking_interval_minutes',
    'break_between_minutes',
    'max_advance_days',
    'booking_mode',
    'datetime_position',
    'form_fields',
    'inquiry_confirmation_message',
    'review_message',
    'review_link',
    'reactivation_message',
    'notify_whatsapp', 'auto_confirm',
    'notify_email', 'booking_confirmation_message',
    'custom_price_id', 'ai_monthly_limit'
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.ai_monthly_limit !== undefined) {
    updates.ai_monthly_limit = Math.max(0, parseInt(updates.ai_monthly_limit) || 0);
  }
  if (updates.custom_price_id !== undefined) {
    const cp = String(updates.custom_price_id).trim();
    if (cp && !/^price_[A-Za-z0-9_]+$/.test(cp)) return res.status(400).json({ error: 'Neveljaven Stripe price ID (mora biti price_...)' });
    updates.custom_price_id = cp;
  }
  if (updates.business_slug) updates.business_slug = slugify(updates.business_slug);
  if (updates.business_type) {
    updates.business_type = normalizeBusinessType(updates.business_type);
    updates.business_label = getPreset(updates.business_type).label;
    if (!updates.greeting_message) updates.greeting_message = getPreset(updates.business_type).greeting;
  }
  if (updates.booking_interval_minutes !== undefined) {
    const v = parseInt(updates.booking_interval_minutes);
    if (![5,10,15,20,30,45,60].includes(v)) return res.status(400).json({ error: 'Neveljaven interval' });
    updates.booking_interval_minutes = v;
  }
  if (updates.break_between_minutes !== undefined) updates.break_between_minutes = parseInt(updates.break_between_minutes) || 0;
  if (updates.max_advance_days !== undefined) updates.max_advance_days = parseInt(updates.max_advance_days) || 30;
  if (updates.booking_mode !== undefined) updates.booking_mode = normalizeBookingMode(updates.booking_mode);
  if (updates.datetime_position !== undefined) updates.datetime_position = updates.datetime_position === 'last' ? 'last' : 'first';
  if (updates.form_fields !== undefined) updates.form_fields = safeFormFields(updates.form_fields, {});
  // null pomeni "urnika ni" — takrat velja star model (working_days + eno območje)
  if (updates.working_hours !== undefined) updates.working_hours = urnik.varenUrnik(updates.working_hours);
  if (updates.delivery_zones !== undefined) updates.delivery_zones = dostava.varneZone(updates.delivery_zones);
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    if (req.body.owner_email !== undefined) {
      const email = String(req.body.owner_email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email ni veljaven' });
      updates.owner_email = email;
    }
    if (req.body.owner_password) {
      updates.owner_password_hash = ownerAuth.hashPassword(req.body.owner_password);
      updates.owner_password_set_at = new Date().toISOString();
    }
    await db.updateSalonSettings(salon.id, updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/salons/:id/services', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    res.json(await db.getServices(salon.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/salons/:id/services', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const serviceName = String(req.body.name || '').trim();
  const price = parseFloat(req.body.price);
  const duration = parseInt(req.body.duration_minutes);
  if (!serviceName) return res.status(400).json({ error: 'Ime storitve je obvezno' });
  if (isNaN(price) || price < 0 || price > 10000) return res.status(400).json({ error: 'Cena ni veljavna' });
  if (isNaN(duration) || duration < 5 || duration > 480) return res.status(400).json({ error: 'Trajanje mora biti med 5 in 480 minut' });
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const existing = await db.getServices(salon.id);
    const service = await db.createService(salon.id, {
      name: serviceName,
      price,
      duration_minutes: duration,
      sort_order: existing.length + 1
    });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/salons/:id/services/:serviceId', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { name, price, duration_minutes } = req.body;
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const service = await db.getServiceById(salon.id, req.params.serviceId);
    if (!service) return res.status(404).json({ error: 'Storitev ni najdena' });
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Ime storitve je obvezno' });
    if (price !== undefined) {
      const p = parseFloat(price);
      if (isNaN(p) || p < 0 || p > 10000) return res.status(400).json({ error: 'Cena ni veljavna' });
    }
    if (duration_minutes !== undefined) {
      const d = parseInt(duration_minutes);
      if (isNaN(d) || d < 5 || d > 480) return res.status(400).json({ error: 'Trajanje mora biti med 5 in 480 minut' });
    }
    await db.updateServiceById(
      service.id,
      price !== undefined ? parseFloat(price) : undefined,
      duration_minutes !== undefined ? parseInt(duration_minutes) : undefined,
      name !== undefined ? String(name).trim() : undefined
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/salons/:id/services/:serviceId', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const service = await db.getServiceById(salon.id, req.params.serviceId);
    if (!service) return res.status(404).json({ error: 'Storitev ni najdena' });
    await db.setServiceActive(service.id, false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/salons/:id/apply-preset', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const type = normalizeBusinessType(req.body.business_type);
  const preset = getPreset(type);
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const existing = await db.getServices(salon.id);
    for (const service of existing) await db.setServiceActive(service.id, false);
    await db.updateSalonSettings(salon.id, {
      business_type: type,
      business_label: preset.label,
      greeting_message: preset.greeting
    });
    const services = await db.createServicesFromPreset(salon.id, preset.services);
    res.json({ success: true, services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Owner Settings endpoints (salon.html) ────────────────

// GET /api/settings — vrne nastavitve salona za lastnika
app.get('/api/settings', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    res.json({
      name: salon.name || '',
      greeting_message: salon.greeting_message || '',
      working_days: salon.working_days || '1,2,3,4,5',
      working_hours_start: salon.working_hours_start || '08:00',
      working_hours_end: salon.working_hours_end || '18:00',
      urnik: urnik.zaVmesnik(salon),
      booking_interval_minutes: salon.booking_interval_minutes || 30,
      break_between_minutes: salon.break_between_minutes || 0,
      max_advance_days: salon.max_advance_days || 30,
      bot_phone_display: salon.bot_phone_display || '',
      business_type: salon.business_type || '',
      business_slug: salon.business_slug || '',
      owner_email: salon.owner_email || '',
      booking_mode: normalizeBookingMode(salon.booking_mode),
      datetime_position: salon.datetime_position === 'last' ? 'last' : 'first',
      form_fields: safeFormFields(salon.form_fields, salon),
      inquiry_confirmation_message: salon.inquiry_confirmation_message || '',
      notify_whatsapp: salon.notify_whatsapp !== false,
    auto_confirm: salon.auto_confirm === true,
      notify_email: salon.notify_email !== false,
      packaging_price: parseFloat(salon.packaging_price || 0),
      delivery_fee: parseFloat(salon.delivery_fee || 0),
      min_order: parseFloat(salon.min_order || 0),
      subscription_plan: salon.subscription_plan || 'ai',
      subscription_status: salon.subscription_status || 'trial',
      signup_status: salon.signup_status || 'active',
      billing_status: salon.billing_status || 'none',
      billing_period: salon.billing_period || 'monthly',
      valid_until: salon.valid_until || salon.trial_ends_at || null,
      company_name: salon.company_name || '',
      vat_id: salon.vat_id || '',
      address: salon.address || '',
      contact_person: salon.contact_person || '',
      owner_email: salon.owner_email || '',
      account_phone: salon.admin_phone || '',
      stripe_active: !!salon.stripe_customer_id,
      pos_type: salon.pos_type || '',
      pos_account: salon.pos_account || '',
      pos_spot_id: salon.pos_spot_id || '',
      pos_token_set: !!salon.pos_token,
      allow_delivery: salon.allow_delivery !== false,
      allow_pickup: salon.allow_pickup !== false,
      pickup_packaging: salon.pickup_packaging !== false,
      pickup_address: salon.pickup_address || '',
      bot_active: salon.bot_active !== false,
      delivery_area: salon.delivery_area || '',
      delivery_zones: dostava.zoneLokala(salon) || [],
      working_hours_start: salon.working_hours_start || '',
      working_hours_end: salon.working_hours_end || '',
      working_days: salon.working_days || '1,2,3,4,5,6',
      urnik: urnik.zaVmesnik(salon),
      bot_messages: (salon.bot_messages && typeof salon.bot_messages === 'object') ? salon.bot_messages : {},
      bot_messages_defaults: BOT_MSG_DEFAULTS,
      review_link: salon.review_link || '',
      review_message: salon.review_message || '',
      review_enabled: salon.review_enabled === true,
      review_delay_hours: salon.review_delay_hours || 2,
      logo_url: salon.logo_url || '',
      listed_public: salon.listed_public === true,
      auto_confirm: salon.auto_confirm === true,
      custom_sounds: parseSounds(salon),
      drivers: parseDrivers(salon),
      ai_instructions: salon.ai_instructions || '',
      slug: salon.slug || ''
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/settings — posodobi nastavitve salona
app.patch('/api/settings', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const allowed = ['name', 'greeting_message', 'working_days', 'working_hours_start',
      'working_hours_end', 'working_hours', 'booking_interval_minutes', 'break_between_minutes', 'max_advance_days',
      'booking_mode', 'datetime_position', 'form_fields', 'inquiry_confirmation_message',
      'pos_type', 'pos_token', 'pos_account', 'pos_spot_id',
      'packaging_price', 'delivery_fee', 'delivery_zones', 'min_order',
      'allow_delivery', 'allow_pickup', 'pickup_packaging', 'pickup_address', 'bot_messages', 'bot_active', 'delivery_area',
      'notify_whatsapp', 'notify_email', 'auto_confirm', 'review_link', 'review_message', 'reactivation_message', 'booking_confirmation_message',
      'review_enabled', 'review_delay_hours', 'listed_public', 'ai_instructions',
      'company_name', 'vat_id', 'address', 'contact_person'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.review_enabled !== undefined) updates.review_enabled = updates.review_enabled === true || updates.review_enabled === 'true';
    if (updates.listed_public !== undefined) {
      updates.listed_public = updates.listed_public === true || updates.listed_public === 'true';
      // Zabeleži trenutek privolitve (dokazilo o soglasju za objavo)
      if (updates.listed_public === true && salon.listed_public !== true) {
        updates.listed_public_at = new Date().toISOString();
      }
    }
    if (updates.review_delay_hours !== undefined) {
      const h = parseInt(updates.review_delay_hours);
      updates.review_delay_hours = (isNaN(h) || h < 1) ? 2 : Math.min(48, h);
    }
    if (updates.booking_mode) updates.booking_mode = normalizeBookingMode(updates.booking_mode);
    // null pomeni "urnika ni" — takrat velja star model (working_days + eno območje)
    if (updates.working_hours !== undefined) updates.working_hours = urnik.varenUrnik(updates.working_hours);
    if (updates.datetime_position) updates.datetime_position = updates.datetime_position === 'last' ? 'last' : 'first';
    if (updates.form_fields !== undefined) updates.form_fields = safeFormFields(updates.form_fields, {});
    if (updates.packaging_price !== undefined) updates.packaging_price = Math.max(0, parseFloat(String(updates.packaging_price).replace(',', '.')) || 0);
    if (updates.delivery_fee !== undefined) updates.delivery_fee = Math.max(0, parseFloat(String(updates.delivery_fee).replace(',', '.')) || 0);
    // null pomeni "krajev ni" — takrat velja enotna cena dostave
    if (updates.delivery_zones !== undefined) updates.delivery_zones = dostava.varneZone(updates.delivery_zones);
    for (const bkey of ['allow_delivery', 'allow_pickup', 'pickup_packaging', 'bot_active']) {
      if (updates[bkey] !== undefined) updates[bkey] = updates[bkey] === true || updates[bkey] === 'true';
    }
    if (updates.allow_delivery === false && updates.allow_pickup === false) {
      return res.status(400).json({ error: 'Omogočena mora biti vsaj dostava ali prevzem.' });
    }
    if (updates.pickup_address !== undefined) updates.pickup_address = String(updates.pickup_address).trim().slice(0, 200);
    if (updates.delivery_area !== undefined) updates.delivery_area = String(updates.delivery_area).trim().slice(0, 200);
    if (updates.bot_messages !== undefined) {
      let inBm = updates.bot_messages;
      if (typeof inBm === 'string') { try { inBm = JSON.parse(inBm); } catch (_) { inBm = {}; } }
      const cleanBm = {};
      for (const k of BOT_MSG_KEYS) {
        const v = String((inBm || {})[k] || '').trim();
        if (v) cleanBm[k] = v.slice(0, 600);
      }
      updates.bot_messages = cleanBm;
    }
    const POS_KEYS = ['pos_type', 'pos_token', 'pos_account', 'pos_spot_id'];
    if (POS_KEYS.some(k => updates[k] !== undefined) && !plans.isPlan(salon.subscription_plan || 'ai')) {
      return res.status(403).json({ error: 'POS integracija je vključena v paketih AI.' });
    }
    if (updates.pos_spot_id !== undefined) updates.pos_spot_id = parseInt(updates.pos_spot_id) || 1;
    await db.updateSalonSettings(salon.id, updates);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/pos-test — preveri POS povezavo (lastnik; POS vključen v AI/Premium)
app.post('/api/settings/pos-test', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  if (!plans.isPlan(salon.subscription_plan || 'ai')) {
    return res.status(403).json({ ok: false, msg: 'POS integracija je vključena v paketih AI.' });
  }
  try {
    const posType    = req.body.pos_type || salon.pos_type;
    const posToken   = req.body.pos_token || salon.pos_token;
    const posAccount = req.body.pos_account !== undefined ? req.body.pos_account : (salon.pos_account || '');
    if (!posType || !posToken) return res.status(400).json({ ok: false, msg: 'Vnesite POS sistem in API token.' });
    const adapter = getAdapter(posType);
    const result = await adapter.testConnection(posToken, posAccount);
    res.json(result);
  } catch (e) {
    res.json({ ok: false, msg: e.message });
  }
});

// ─── BILLING (Stripe) ─────────────────────────────────────
// POST /api/billing/checkout { plan: 'ai'|'premium' } — ustvari Stripe Checkout
app.post('/api/billing/checkout', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: 'Plačila še niso omogočena. Pišite na info@flowtek.si.' });
  const plan = plans.planKey(req.body.plan);
  // Obdobje iz zahteve ima prednost — stranka ga izbere s preklopnikom v plošči.
  const period = (req.body.billing_period === 'yearly'
    || (req.body.billing_period !== 'monthly' && salon.billing_period === 'yearly')) ? 'yearly' : 'monthly';
  /*
    Ločimo dve različni težavi, ki sta prej obe javili "cena ni nastavljena":
    klic v Stripe ni uspel (neveljaven ključ, nedosegljiv Stripe) ali pa cene
    s tem lookup_key res ni. Prva kaže na okolje, druga na cenik.
  */
  const r = await stripePriceId(plan, period, salon.custom_price_id);
  // Podrobnost o napaki dobi le master — stranki ne koristi, nam pa prihrani
  // ugibanje, ker dnevnikov Railwaya ni vedno pri roki.
  const zaMastra = isMasterRequest(req) ? { podrobno: r.podrobno } : {};
  if (r.napaka === 'stripe') {
    console.error('[billing] checkout: ' + r.podrobno);
    return res.status(502).json({ error: 'Povezava s Stripom ni uspela. Poskusite znova ali pišite na info@flowtek.si.', ...zaMastra });
  }
  if (!r.priceId) {
    console.error('[billing] checkout: ' + (r.podrobno || 'cene ni'));
    return res.status(503).json({ error: `Stripe cena za paket "${plan}" (${period === 'yearly' ? 'letno' : 'mesečno'}) še ni nastavljena.`, ...zaMastra });
  }
  const priceId = r.priceId;
  const baseUrl = process.env.BASE_URL || 'https://flowtek.si';
  const returnPage = (salon.booking_mode === 'delivery' || salon.business_type === 'restaurant') ? 'delivery.html' : 'salon.html';

  const sejaOpts = zKupcem => ({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    // Obstoječega Stripe kupca ponovno uporabi, sicer predizpolni email
    ...(zKupcem ? { customer: salon.stripe_customer_id } : { customer_email: salon.owner_email || undefined }),
    subscription_data: { metadata: { salon_id: salon.id, plan } },
    metadata: { salon_id: salon.id, plan },
    allow_promotion_codes: true,
    success_url: `${baseUrl}/${returnPage}?billing=success`,
    cancel_url: `${baseUrl}/${returnPage}?billing=cancel`
  });

  try {
    let session;
    try {
      session = await stripe.checkout.sessions.create(sejaOpts(!!salon.stripe_customer_id));
    } catch (e) {
      /*
        Shranjeni kupec lahko v tem Stripe načinu ne obstaja — tipično po
        preklopu s testnega na živi ključ, ko v bazi ostanejo testni ID-ji,
        pa tudi če je bil kupec v Stripu izbrisan. Plačilo zato ne sme pasti:
        poskusimo znova brez kupca in tako ustvarimo novega. Pravi ID zapiše
        uskladitev po plačilu.
      */
      const jeNeznanKupec = salon.stripe_customer_id
        && /No such customer/i.test(String(e.message || ''));
      if (!jeNeznanKupec) throw e;
      console.warn(`[billing] kupec ${salon.stripe_customer_id} v tem načinu ne obstaja `
        + `(${salon.name}) — nadaljujem brez njega; ID v bazi je zastarel`);
      session = await stripe.checkout.sessions.create(sejaOpts(false));
    }
    res.json({ url: session.url });
  } catch (e) {
    console.error('[billing] checkout error: ' + stripeSync.opisNapake(e));
    res.status(500).json({ error: e.message });
  }
});

/*
  GET /api/admin/stripe-stanje — diagnostika Stripe okolja (samo master).

  Nastala je iz izkušnje: stanje okoljskih spremenljivk smo trikrat sklepali
  iz vedenja endpointov in se enkrat zmotili. Tu se vidi na en pogled, brez
  dostopa do dnevnikov Railwaya.

  Ključa NE izpisuje — le njegovo obliko in način. Cene preverja po lookup_key,
  torej po isti poti, kot jih najde checkout.
*/
app.get('/api/admin/stripe-stanje', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const kljuc = stripeSync.preveriKljuc();
  const out = { kljuc, cene: {}, napaka: null };

  if (!kljuc.ok && kljuc.opis === 'ni nastavljen') return res.json(out);

  for (const paket of plans.PLAN_KEYS) {
    for (const obdobje of ['monthly', 'yearly']) {
      const r = await stripePriceId(paket, obdobje, null);
      out.cene[plans.lookupKey(paket, obdobje)] = r.priceId
        || ((r.napaka === 'stripe' ? 'NAPAKA: ' : 'NI: ') + (r.podrobno || ''));
      if (r.napaka === 'stripe' && !out.napaka) out.napaka = r.podrobno;
    }
  }
  res.json(out);
});

/*
  GET /api/admin/wa-stanje — ali WhatsApp žeton vsakega lokala še dela (samo master).

  Nastalo iz konkretnega primera: Meta je aplikaciji, ki ji pripada Botanin
  žeton, zaprla dostop do API-ja ("API access blocked"). Ob blokadi neha
  dostavljati tudi webhooke, zato v sb_errors ni bilo NIČESAR — bot je
  osemnajst dni tiho molčal in tega ni opazil nihče.

  Takih okvar torej ni mogoče prikazati iz zabeleženih napak; žeton je treba
  vprašati. Ta endpoint za vsak lokal z WhatsApp številko naredi eno poizvedbo
  na Meto in vrne, ali ta številka odgovarja. Sporočil ne pošilja.

  Žeton razrešimo enako kot povsod v kodi (lasten, sicer globalni), da rezultat
  pove, kaj bi se res zgodilo, ko stranka piše.
*/
app.get('/api/admin/wa-stanje', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salons = await db.getAllSalons();
    const zaPreverbo = salons.filter(s => s.whatsapp_phone_number_id);

    const out = {};
    await Promise.all(zaPreverbo.map(async s => {
      const token = s.whatsapp_access_token || process.env.WA_TOKEN;
      if (!token) {
        out[s.id] = { ok: false, kaj: 'ni žetona', podrobno: 'Lokal nima lastnega žetona, globalni WA_TOKEN pa ni nastavljen.' };
        return;
      }
      try {
        const r = await axios.get(`https://graph.facebook.com/v19.0/${s.whatsapp_phone_number_id}`, {
          params: { fields: 'display_phone_number,verified_name' },
          headers: { Authorization: 'Bearer ' + token },
          timeout: 8000
        });
        out[s.id] = {
          ok: true,
          stevilka: r.data.display_phone_number || '',
          ime: r.data.verified_name || '',
          lastenZeton: !!s.whatsapp_access_token
        };
      } catch (e) {
        const err = e.response?.data?.error;
        out[s.id] = {
          ok: false,
          kaj: err ? (err.message || 'napaka') : (e.code === 'ECONNABORTED' ? 'časovna omejitev' : e.message),
          koda: err ? String(err.code) + (err.error_subcode ? '/' + err.error_subcode : '') : '',
          lastenZeton: !!s.whatsapp_access_token,
          podrobno: err
            ? [err.type, err.message, err.error_user_msg].filter(Boolean).join(' — ')
            : String(e.message || '')
        };
      }
    }));

    res.json({ preverjeno: new Date().toISOString(), stanje: out });
  } catch (err) {
    console.error('[wa-stanje]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/portal — Stripe portal za upravljanje naročnine in računov
app.post('/api/billing/portal', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: 'Plačila še niso omogočena.' });
  if (!salon.stripe_customer_id) return res.status(400).json({ error: 'Naročnina prek Stripe še ni aktivirana.' });
  try {
    const baseUrl = process.env.BASE_URL || 'https://flowtek.si';
    const returnPage = (salon.booking_mode === 'delivery' || salon.business_type === 'restaurant') ? 'delivery.html' : 'salon.html';
    const portal = await stripe.billingPortal.sessions.create({
      customer: salon.stripe_customer_id,
      // ?billing=portal pove plošči, naj po vrnitvi uskladi stanje —
      // stranka je morda ravno odpovedala ali zamenjala kartico.
      return_url: `${baseUrl}/${returnPage}?billing=portal`
    });
    res.json({ url: portal.url });
  } catch (e) {
    /*
      Kupca v tem Stripe načinu ni (zastarel testni ID po preklopu ključa ali
      izbrisan kupec). Za stranko to ni napaka strežnika — ni česa upravljati,
      zato ji povemo isto kot lokalu, ki Stripa še ne uporablja.
    */
    if (/No such customer/i.test(String(e.message || ''))) {
      console.warn(`[billing] portal: kupec ${salon.stripe_customer_id} v tem načinu ne obstaja `
        + `(${salon.name}) — ID v bazi je zastarel`);
      return res.status(400).json({ error: 'Naročnina prek Stripe še ni aktivirana.' });
    }
    console.error('[billing] portal error: ' + stripeSync.opisNapake(e));
    res.status(500).json({ error: e.message });
  }
});

/*
  POST /api/billing/sync — preberi stanje naročnine iz Stripa in ga zapiši.

  Kliče ga nadzorna plošča ob vrnitvi s plačila ali iz portala, da stranka
  učinek vidi takoj in ji ni treba čakati na urno uskladitev. Ni od nje
  odvisen: isto opravi urnik vsako uro, tudi če stranke ni.

  Vrne osveženo obračunsko stanje, da plošča ne potrebuje drugega klica.
*/
app.post('/api/billing/sync', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    await stripeSync.sinhronizirajLokal(salon);
  } catch (e) {
    console.error('[billing] sync error:', e.message);
  }
  // Preberemo znova, tudi če uskladitev ni uspela — plošča dobi resnično stanje.
  const svez = await db.getSalonById(salon.id).catch(() => salon);
  res.json({
    subscription_status: svez.subscription_status,
    subscription_plan: svez.subscription_plan,
    billing_period: svez.billing_period,
    billing_status: svez.billing_status,
    signup_status: svez.signup_status,
    bot_active: svez.bot_active,
    valid_until: svez.valid_until,
    stripe_customer_id: svez.stripe_customer_id
  });
});

// PATCH /api/settings/password — zamenjava gesla lastnika
app.patch('/api/settings/password', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || new_password.length < 8)
    return res.status(400).json({ error: 'Geslo mora imeti vsaj 8 znakov' });
  try {
    const { verifyPassword, hashPassword } = require('./src/auth');
    if (!salon.owner_password_hash || !verifyPassword(current_password, salon.owner_password_hash))
      return res.status(401).json({ error: 'Trenutno geslo ni pravilno' });
    await db.updateSalonSettings(salon.id, { owner_password_hash: hashPassword(new_password) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/services — seznam storitev za lastnika
// POST /api/settings/logo — naloži logotip lokala (base64 data URL)
app.post('/api/settings/logo', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const data = String(req.body.image || '');
    const m = data.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Neveljavna slika — dovoljeni PNG, JPG ali WEBP.' });
    const buffer = Buffer.from(m[3], 'base64');
    if (buffer.length > 1024 * 1024) return res.status(400).json({ error: 'Logotip je prevelik (največ 1 MB).' });
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const url = await db.uploadLogo(salon.id, buffer, m[1], ext);
    await db.updateSalonSettings(salon.id, { logo_url: url });
    res.json({ success: true, logo_url: url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parseSounds(salon) {
  let list = salon.custom_sounds;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  return Array.isArray(list) ? list : [];
}

// POST /api/settings/sound — naloži lasten zvok obvestila (do 3, do 15 MB)
app.post('/api/settings/sound', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const list = parseSounds(salon);
    if (list.length >= 3) return res.status(400).json({ error: 'Največ 3 lastni zvoki. Najprej enega odstranite.' });
    const data = String(req.body.audio || '');
    const m = data.match(/^data:(audio\/[\w.+-]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Neveljavna zvočna datoteka.' });
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > 15 * 1024 * 1024) return res.status(400).json({ error: 'Zvok je prevelik (največ 15 MB).' });
    const ext = (m[1].split('/')[1] || 'mp3').replace(/[^\w]/g, '').slice(0, 5) || 'mp3';
    const url = await db.uploadSound(salon.id, buffer, m[1], ext);
    const name = String(req.body.name || 'Zvok').replace(/\.[^.]+$/, '').slice(0, 40) || 'Zvok';
    const next = [...list, { url, name }];
    await db.updateSalonSettings(salon.id, { custom_sounds: JSON.stringify(next) });
    res.json({ success: true, custom_sounds: next });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/settings/sound — odstrani lasten zvok (tudi iz Storagea)
app.delete('/api/settings/sound', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const url = String(req.body.url || '');
    const list = parseSounds(salon);
    const next = list.filter(s => s.url !== url);
    await db.deleteSound(url);
    await db.updateSalonSettings(salon.id, { custom_sounds: JSON.stringify(next) });
    res.json({ success: true, custom_sounds: next });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── VOZNIKI (dostava) ────────────────────────────────────────────────
// Lastnik: dodaj voznika (ime -> generira 4-mestni PIN)
app.post('/api/settings/drivers', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const ime = String(req.body.ime || '').trim().slice(0, 40);
    if (!ime) return res.status(400).json({ error: 'Vnesite ime voznika' });
    const list = parseDrivers(salon);
    if (list.length >= 20) return res.status(400).json({ error: 'Preveč voznikov (največ 20).' });
    let pin;
    do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (list.some(d => String(d.pin) === pin));
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const next = [...list, { id, ime, pin, aktiven: true }];
    await db.updateSalonSettings(salon.id, { drivers: JSON.stringify(next) });
    res.json({ success: true, drivers: next });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lastnik: vklop/izklop voznika
app.patch('/api/settings/drivers/:id', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const list = parseDrivers(salon).map(d => d.id === req.params.id ? { ...d, aktiven: req.body.aktiven !== false } : d);
    await db.updateSalonSettings(salon.id, { drivers: JSON.stringify(list) });
    res.json({ success: true, drivers: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lastnik: odstrani voznika
app.delete('/api/settings/drivers/:id', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const list = parseDrivers(salon).filter(d => d.id !== req.params.id);
    await db.updateSalonSettings(salon.id, { drivers: JSON.stringify(list) });
    res.json({ success: true, drivers: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Voznik: prijava (lokal + PIN)
app.post('/api/driver/login', rateLimit(10, 15 * 60 * 1000, req => 's:' + String(req.body?.salon || '').trim().toLowerCase()),
  rateLimit(30, 15 * 60 * 1000, poIp()), async (req, res) => {
  try {
    const slug = String(req.body.salon || '').trim();
    const pin = String(req.body.pin || '').trim();
    if (!slug || !pin) return res.status(400).json({ error: 'Manjka lokal ali PIN' });
    const salon = await db.resolveSalon(slug);
    if (!salon || salon.subscription_status === 'inactive') return res.status(404).json({ error: 'Lokal ni najden' });
    const d = parseDrivers(salon).find(x => x && x.aktiven !== false && String(x.pin) === pin);
    if (!d) return res.status(401).json({ error: 'Napačen PIN' });
    const token = ownerAuth.createSession(salon.id, 'driver', { driverName: d.ime, driverId: d.id });
    res.json({ success: true, token, driver_name: d.ime, salon_name: salon.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const _faParse = (fa) => { try { return typeof fa === 'object' && fa ? fa : JSON.parse(fa || '{}'); } catch { return {}; } };

// Voznik: naročila za dostavo (branje + iskanje)
app.get('/api/driver/orders', async (req, res) => {
  const ctx = await driverAuth(req, res);
  if (!ctx) return;
  try {
    const all = await db.listBookings(ctx.salon.id);
    const q = String(req.query.search || '').toLowerCase().trim();
    const rows = all.filter(b => {
      const notes = String(b.notes || '');
      const isDelivery = notes.startsWith('RAZVOZ') || /razvoz|dostava/i.test(notes);
      return isDelivery && (b.status === 'confirmed' || b.status === 'delivered');
    }).filter(b => {
      if (!q) return true;
      const fa = _faParse(b.form_answers);
      return [b.customer_name, b.customer_phone, fa.naslov, (b.id || '').slice(-6)]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
    const out = rows.map(b => {
      const fa = _faParse(b.form_answers);
      return {
        id: b.id,
        ref: (b.id || '').slice(-6).toUpperCase(),
        name: b.customer_name || '',
        phone: b.customer_phone || '',
        address: fa.naslov || '',
        items: fa.narocilo || '',
        total: fa.skupaj || '',
        payment: fa.placilo || '',
        note: fa.opomba || '',
        status: b.status,
        delivered_by: b.delivered_by || null,
        delivered_at: b.delivered_at || null,
        created_at: b.created_at
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ orders: out, driver_name: ctx.driverName, salon_name: ctx.salon.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Voznik: potrdi dostavo
app.patch('/api/driver/orders/:id/delivered', async (req, res) => {
  const ctx = await driverAuth(req, res);
  if (!ctx) return;
  try {
    const booking = await db.getBookingById(req.params.id);
    if (!booking || booking.salon_id !== ctx.salon.id) return res.status(404).json({ error: 'Naročilo ni najdeno' });
    const updated = await db.markDelivered(booking.id, ctx.driverName);
    res.json({ success: true, id: booking.id, status: 'delivered', delivered_by: ctx.driverName, delivered_at: updated ? updated.delivered_at : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings/services', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const services = await db.getServices(salon.id);
    res.json(services.filter(s => s.is_active !== false));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/*
  GET /api/settings/dostava-neznani
  Kraji iz pravih naslovov, ki jih na ceniku dostave ni. Napačno zapisan kraj
  v ceniku se pokaže enako kot manjkajoč — oboje je tu, s številom naročil.
  Nič ne piše in nič ne hrani: izračuna se iz naročil ob vsakem klicu, zato
  vpisan kraj s seznama izgine sam.
*/
app.get('/api/settings/dostava-neznani', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    if (!dostava.poKrajih(salon)) return res.json({ kraji: [] });
    const bookings = await db.listBookings(salon.id);
    res.json({ kraji: dostava.neznaniKraji(salon, bookings, 20) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/customers — agregirane stranke iz rezervacij (obiski, zadnji obisk)
app.get('/api/settings/customers', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const bookings = await db.listBookings(salon.id);
    const map = new Map();
    for (const b of bookings) {
      const key = (b.customer_phone || '').trim() || (b.customer_name || '?');
      let c = map.get(key);
      if (!c) { c = { phone: b.customer_phone || '', name: b.customer_name || '', visits: 0, cancelled: 0, lastDate: null }; map.set(key, c); }
      if (!c.name && b.customer_name) c.name = b.customer_name;
      const d = (b.booking_date || '').slice(0, 10);
      if (b.status === 'cancelled') c.cancelled++;
      else { c.visits++; if (!c.lastDate || d > c.lastDate) c.lastDate = d; }
    }
    const customers = [...map.values()].sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
    const totalVisits = customers.reduce((s, c) => s + c.visits, 0);
    res.json({ customers, total: customers.length, totalVisits });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cena embalaže artikla: prazno = velja enotna cena lokala, 0 = brez embalaže.
// Vrne { napaka } ali { vrednost }.
function cenaEmbalaze(v) {
  if (v === null || String(v).trim() === '') return { vrednost: null };
  const n = parseFloat(String(v).replace(',', '.'));
  if (isNaN(n) || n < 0 || n > 100) return { napaka: 'Cena embalaže mora biti med 0 in 100 € (ali prazna)' };
  return { vrednost: Math.round(n * 100) / 100 };
}

// POST /api/settings/services — nova storitev
app.post('/api/settings/services', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const { name, price, duration_minutes, description, category, tags, packaging_price } = req.body;
  if (!name) return res.status(400).json({ error: 'Ime storitve je obvezno' });
  let emb = null;
  if (packaging_price !== undefined) {
    const p = cenaEmbalaze(packaging_price);
    if (p.napaka) return res.status(400).json({ error: p.napaka });
    emb = p.vrednost;
  }
  try {
    const svc = await db.createService(salon.id, {
      name: name.trim(),
      price: parseFloat(price) || 0,
      duration_minutes: parseInt(duration_minutes) || 0,
      description: description || '',
      category: category || 'Ostalo',
      tags: Array.isArray(tags) ? tags : [],
      packaging_price: emb,
      is_active: true
    });
    res.json(svc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/services/reorder — posodobi vrstni red (batch)
app.post('/api/settings/services/reorder', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const { items } = req.body; // [{id, sort_order}, ...]
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  try {
    await Promise.all(items.map(({ id, sort_order }) =>
      db.updateServiceById(id, undefined, undefined, undefined, sort_order)
    ));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/settings/services/:id — posodobi storitev
app.patch('/api/settings/services/:id', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const { name, price, duration_minutes, description, category, tags, packaging_price } = req.body;
  try {
    const svc = await db.getServiceById(salon.id, req.params.id);
    if (!svc) return res.status(404).json({ error: 'Storitev ni najdena' });
    const fields = {};
    if (name !== undefined) fields.name = name.trim();
    if (price !== undefined) fields.price = parseFloat(price) || 0;
    if (duration_minutes !== undefined) fields.duration_minutes = parseInt(duration_minutes) || 0;
    if (description !== undefined) fields.description = description;
    if (category !== undefined) fields.category = category;
    if (Array.isArray(tags)) fields.tags = tags;
    if (packaging_price !== undefined) {
      const p = cenaEmbalaze(packaging_price);
      if (p.napaka) return res.status(400).json({ error: p.napaka });
      fields.packaging_price = p.vrednost;
    }
    await db.patchService(svc.id, fields);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/settings/services/:id — izbriši storitev
app.delete('/api/settings/services/:id', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const svc = await db.getServiceById(salon.id, req.params.id);
    if (!svc) return res.status(404).json({ error: 'Storitev ni najdena' });
    await db.deleteServiceById(svc.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Errors ───────────────────────────────────────────────────

// GET /api/admin/usage — število naročil ta mesec po lokalih (za maržo/fair-use)
app.get('/api/admin/usage', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const salons = await db.getAllSalons();
    const usage = {};
    const limits = {};
    const defLimit = parseInt(process.env.AI_FAIR_USE_LIMIT) || 1500;
    await Promise.all(salons.map(async (s) => {
      usage[s.id] = await db.getMonthlyOrderCount(s.id).catch(() => 0);
      limits[s.id] = (parseInt(s.ai_monthly_limit) > 0) ? parseInt(s.ai_monthly_limit) : planLimit(s.subscription_plan);
    }));
    res.json({ usage, limits, month: t.todayStr().slice(0, 7), limit: defLimit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/errors', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const errors = await db.getRecentErrors(100);
    res.json(errors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/errors', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    await db.clearErrors();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    res.json(await db.getRecentLogs(100));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Owner WhatsApp OTP auth ─────────────────────────────────
app.post('/api/auth/login', ...omejiPrijavo('email'), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email in geslo sta obvezna' });
  try {
    // Vsi lokali istega lastnika (email) — večlokacijska podpora
    const all = (await db.getSalonsByOwnerEmail(email)).filter(s => s.subscription_status !== 'inactive');
    // Geslo mora ustrezati vsaj enemu lokalu s tem emailom
    const salon = all.find(s => s.owner_password_hash && ownerAuth.verifyPassword(password, s.owner_password_hash));
    if (!salon) {
      return res.status(401).json({ error: 'Napacen email ali geslo' });
    }
    const allowedSalons = all.map(s => s.id).slice(0, 20);
    const token = ownerAuth.createSession(salon.id, 'owner', { email, allowedSalons });
    await db.updateSalonSettings(salon.id, { owner_last_login_at: new Date().toISOString() });
    res.json({
      success: true, token, role: 'owner', salon: publicSalon(salon),
      salons: all.map(s => ({ id: s.id, name: s.name, booking_mode: s.booking_mode || 'exact_time', business_type: s.business_type || '' }))
    });
  } catch (err) {
    console.error('Owner login error:', err.message);
    res.status(500).json({ error: 'Prijava trenutno ni uspela' });
  }
});

/*
  ─── Pozabljeno geslo lastnika ─────────────────────────────────────────────
  Enak vzorec kot pri master adminu, z dvema razlikama:

  1. En lastnik ima lahko VEČ lokalov in geslo je skupno (prijava preveri
     geslo pri katerem koli njegovem lokalu). Zato se žeton in novo geslo
     zapišeta pri VSEH njegovih lokalih — sicer bi staro geslo pri drugem
     lokalu še naprej delovalo.
  2. Ob ponastavitvi prekličemo obstoječe seje (sessions_valid_from). Kdor je
     geslo pozabil, mora tudi kogar koli drugega izbiti iz že odprtih sej.

  Odgovor je vedno enak, ne glede na to, ali email obstaja — sicer bi obrazec
  razkril, kateri e-naslovi so v sistemu.
*/
app.post('/api/auth/owner-forgot',
  rateLimit(5, 60 * 60 * 1000, poEposti('email')),
  rateLimit(15, 60 * 60 * 1000, poIp()), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email je obvezen' });
  const enakOdgovor = { success: true, message: 'Če email obstaja, je povezava za ponastavitev poslana.' };
  try {
    const lokali = (await db.getSalonsByOwnerEmail(email)) || [];
    // Brez gesla ni česa ponastaviti; takim lokalom geslo nastavi administrator.
    const zGeslom = lokali.filter(s => s.owner_password_hash);
    if (!zGeslom.length) return res.json(enakOdgovor);

    const token = crypto.randomBytes(32).toString('hex');
    const odtis = ownerAuth.hashToken(token);
    const velja = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    for (const s of zGeslom) {
      await db.updateSalonSettings(s.id, { owner_reset_token_hash: odtis, owner_reset_expires_at: velja });
    }
    const povezava = `${req.protocol}://${req.get('host')}/geslo?reset=${token}`;
    await mail.sendPasswordReset(email, povezava);
    console.log('[owner-forgot] povezava poslana:', email, '(' + zGeslom.length + ' lokalov)');
    res.json(enakOdgovor);
  } catch (err) {
    console.error('[owner-forgot]', err.message);
    res.status(500).json({ error: 'Ponastavitev trenutno ni uspela' });
  }
});

app.post('/api/auth/owner-reset', rateLimit(10, 60 * 60 * 1000, poIp()), async (req, res) => {
  const token = String(req.body.token || '').trim();
  const geslo = String(req.body.password || '');
  if (!token) return res.status(400).json({ error: 'Povezava ni veljavna' });
  if (geslo.length < 8) return res.status(400).json({ error: 'Geslo mora imeti vsaj 8 znakov' });
  try {
    const najdeni = await db.getSalonsByOwnerResetTokenHash(ownerAuth.hashToken(token));
    const velja = najdeni.filter(s => s.owner_reset_expires_at
      && new Date(s.owner_reset_expires_at).getTime() > Date.now());
    if (!velja.length) return res.status(401).json({ error: 'Povezava je potekla ali ni veljavna' });

    const zdaj = new Date().toISOString();
    const odtisGesla = ownerAuth.hashPassword(geslo);
    // Vsi lokali istega lastnika: novo geslo, žeton pobrisan, seje preklicane.
    const email = String(velja[0].owner_email || '').trim().toLowerCase();
    const vsi = email ? ((await db.getSalonsByOwnerEmail(email)) || []).filter(s => s.owner_password_hash) : velja;
    const cilji = vsi.length ? vsi : velja;
    for (const s of cilji) {
      await db.updateSalonSettings(s.id, {
        owner_password_hash: odtisGesla,
        owner_password_set_at: zdaj,
        owner_reset_token_hash: null,
        owner_reset_expires_at: null,
        sessions_valid_from: zdaj
      });
    }
    console.log('[owner-reset] geslo ponastavljeno:', email || velja[0].id, '(' + cilji.length + ' lokalov)');
    res.json({ success: true, lokalov: cilji.length });
  } catch (err) {
    console.error('[owner-reset]', err.message);
    res.status(500).json({ error: 'Gesla ni bilo mogoče ponastaviti' });
  }
});

app.post('/api/auth/master-login', ...omejiPrijavo('email'), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email in geslo sta obvezna' });
  try {
    const admin = await db.getMasterAdminByEmail(email);
    if (!admin || !ownerAuth.verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Napacen email ali geslo' });
    }
    const token = ownerAuth.createSession(null, 'master', { email });
    await db.updateMasterAdmin(admin.id, { last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    res.json({ success: true, token, role: 'master', redirect: '/admin.html' });
  } catch (err) {
    console.error('Master login error:', err.message);
    res.status(500).json({ error: 'Prijava trenutno ni uspela' });
  }
});

app.post('/api/auth/master-forgot', rateLimit(5, 60 * 60 * 1000, poEposti('email')),
  rateLimit(15, 60 * 60 * 1000, poIp()), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email je obvezen' });
  try {
    const admin = await db.getMasterAdminByEmail(email);
    if (admin) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.updateMasterAdmin(admin.id, {
        reset_token_hash: ownerAuth.hashToken(token),
        reset_token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString()
      });
      const resetUrl = `${req.protocol}://${req.get('host')}/admin.html?reset=${token}`;
      await mail.sendPasswordReset(email, resetUrl);
    }
    res.json({ success: true, message: 'Ce email obstaja, je povezava za ponastavitev poslana.' });
  } catch (err) {
    console.error('Master forgot error:', err.message);
    res.status(500).json({ error: 'Ponastavitev trenutno ni uspela' });
  }
});

app.post('/api/auth/master-reset', rateLimit(10, 60 * 60 * 1000, poIp()), async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  if (!token || password.length < 8) return res.status(400).json({ error: 'Token ali geslo ni veljavno' });
  try {
    const admin = await db.getMasterAdminByResetTokenHash(ownerAuth.hashToken(token));
    if (!admin || !admin.reset_token_expires_at || new Date(admin.reset_token_expires_at).getTime() < Date.now()) {
      return res.status(401).json({ error: 'Povezava je potekla ali ni veljavna' });
    }
    await db.updateMasterAdmin(admin.id, {
      password_hash: ownerAuth.hashPassword(password),
      reset_token_hash: null,
      reset_token_expires_at: null,
      updated_at: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Master reset error:', err.message);
    res.status(500).json({ error: 'Gesla ni bilo mogoce ponastaviti' });
  }
});

app.post('/api/auth/master-change-password', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const session = ownerAuth.getSession(req.headers.authorization || req.headers['x-owner-token']);
  const email = String(session?.email || '').trim().toLowerCase();
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  if (!email || newPassword.length < 8) return res.status(400).json({ error: 'Novo geslo mora imeti vsaj 8 znakov' });
  try {
    const admin = await db.getMasterAdminByEmail(email);
    if (!admin || !ownerAuth.verifyPassword(currentPassword, admin.password_hash)) {
      return res.status(401).json({ error: 'Trenutno geslo ni pravilno' });
    }
    await db.updateMasterAdmin(admin.id, {
      password_hash: ownerAuth.hashPassword(newPassword),
      reset_token_hash: null,
      reset_token_expires_at: null,
      updated_at: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Master change password error:', err.message);
    res.status(500).json({ error: 'Gesla ni bilo mogoce zamenjati' });
  }
});

app.post('/api/auth/start', rateLimit(5, 15 * 60 * 1000, poTelefonu('phone')),
  rateLimit(20, 15 * 60 * 1000, poIp()), async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  if (phone.length < 8) return res.status(400).json({ error: 'Neveljavna telefonska stevilka' });
  try {
    if (isMasterAdminPhone(phone)) {
      const code = ownerAuth.createOtp(phone, null, 'master');
      await wa.send(process.env.WA_PHONE_ID, process.env.WA_TOKEN, wa.textMsg(phone, `FlowTek master admin koda: ${code}\nVelja 10 minut.`));
      return res.json({ success: true, role: 'master', message: 'Master admin koda poslana na WhatsApp.' });
    }

    const salon = await db.getSalonByAdminPhone(phone);
    if (!salon || salon.subscription_status === 'inactive') {
      return res.status(404).json({ error: 'Podjetje s to stevilko ni najdeno' });
    }
    const code = ownerAuth.createOtp(phone, salon.id, 'owner');
    const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
    const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
    await wa.send(phoneId, token, wa.textMsg(phone, `FlowTek prijavna koda: ${code}\nVelja 10 minut.`));
    res.json({ success: true, message: 'Koda poslana na WhatsApp.' });
  } catch (err) {
    console.error('OTP start error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Kode ni bilo mogoce poslati.' });
  }
});

app.post('/api/auth/verify', rateLimit(10, 15 * 60 * 1000, poTelefonu('phone')),
  rateLimit(30, 15 * 60 * 1000, poIp()), async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  const token = ownerAuth.verifyOtp(phone, req.body.code);
  if (!token) return res.status(401).json({ error: 'Napacna ali potekla koda' });
  const session = ownerAuth.getSession(token);
  if (session?.role === 'master') {
    return res.json({ success: true, token, role: 'master', redirect: '/admin.html' });
  }
  const salon = await db.getSalonById(session.salonId);
  res.json({ success: true, token, role: 'owner', salon: publicSalon(salon) });
});

// GET /api/my-salons — lokali, do katerih ima lastnik dostop (za preklopnik)
app.get('/api/my-salons', async (req, res) => {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  if (!session || session.role !== 'owner') return res.status(401).json({ error: 'Neveljavna prijava' });
  try {
    const ids = Array.isArray(session.allowedSalons) && session.allowedSalons.length
      ? session.allowedSalons
      : [session.salonId];
    const salons = [];
    for (const id of ids) {
      const s = await db.getSalonById(id);
      if (s && s.subscription_status !== 'inactive') {
        salons.push({ id: s.id, name: s.name, booking_mode: s.booking_mode || 'exact_time', business_type: s.business_type || '', current: s.id === session.salonId });
      }
    }
    res.json({ salons });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/switch { salonId } — preklop na drug lokal istega lastnika
app.post('/api/auth/switch', async (req, res) => {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  if (!session || session.role !== 'owner') return res.status(401).json({ error: 'Neveljavna prijava' });
  const targetId = String(req.body.salonId || '');
  const allowed = Array.isArray(session.allowedSalons) ? session.allowedSalons : [session.salonId];
  if (!allowed.includes(targetId)) return res.status(403).json({ error: 'Nimate dostopa do tega lokala' });
  try {
    const salon = await db.getSalonById(targetId);
    if (!salon || salon.subscription_status === 'inactive') return res.status(404).json({ error: 'Lokal ni najden' });
    const token = ownerAuth.createSession(salon.id, 'owner', { email: session.email, allowedSalons: allowed });
    const redirect = (salon.booking_mode === 'delivery' || salon.business_type === 'restaurant') ? '/delivery.html' : '/salon.html';
    res.json({ success: true, token, redirect, salon: publicSalon(salon) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/*
  Odjava. Prej je pobrisala le pomnilniško kopijo, žeton pa je bil podpisan in
  brezstanjski — torej je ukraden žeton po odjavi delal še do 30 dni.

  Zdaj zapišemo sessions_valid_from na lokal oziroma master admina; vsi žetoni,
  izdani pred tem trenutkom, so s tem neveljavni. Posledica, ki jo je treba
  poznati: odjava velja za VSE naprave tega računa, ne le za trenutno. Za
  administracijsko orodje je to prava privzeta izbira — če je žeton ušel,
  hočemo, da neha delati povsod.
*/
app.post('/api/auth/logout', async (req, res) => {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  ownerAuth.clearSession(bearer);

  const zdaj = new Date().toISOString();
  try {
    if (session?.role === 'master' && session.email) {
      const admin = await db.getMasterAdminByEmail(session.email);
      if (admin) {
        await db.updateMasterAdmin(admin.id, { sessions_valid_from: zdaj });
        masterValidFrom.set(String(session.email).toLowerCase(), zdaj);   // takoj, brez čakanja na osvežitev
      }
    } else if (session?.salonId) {
      await db.updateSalonSettings(session.salonId, { sessions_valid_from: zdaj });
    }
  } catch (e) {
    // Odjava na odjemalcu se zgodi tako ali tako; napake ne skrivamo, a je ne vračamo kot 500.
    console.error('[auth] preklic sej ob odjavi:', e.message);
  }
  res.json({ success: true });
});

// ─── Public Booking API ───────────────────────────────────────
const cal = require('./src/calendar');

// Salon info + services (public)
app.get('/api/book/info', async (req, res) => {
  try {
    const salon = await resolveBookSalon(req);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const services = await db.getServices(salon.id);
    res.json({
      salon: publicSalon(salon),
      services: services.map(s => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes, price: s.price }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Available dates (public)
app.get('/api/book/dates', async (req, res) => {
  try {
    const salon = await resolveBookSalon(req);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const svc = await db.getServiceById(salon.id, req.query.serviceId);
    const dates = await cal.getFreeDates(salon, 45, svc?.duration_minutes || null);
    res.json(dates);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Available times for a date (public)
app.get('/api/book/times', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  try {
    const salon = await resolveBookSalon(req);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const svc = await db.getServiceById(salon.id, req.query.serviceId);
    const times = await cal.getFreeTimesForDate(salon, date, svc?.duration_minutes || null);
    res.json(times);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create booking (public)
app.post('/api/book', rateLimit(20, 10 * 60 * 1000), async (req, res) => {
  const { serviceId, date, time, customerName, customerPhone } = req.body;
  const formAnswers = req.body.formAnswers && typeof req.body.formAnswers === 'object' ? req.body.formAnswers : {};
  if (!date || !customerName || !customerPhone) {
    return res.status(400).json({ error: 'Manjkajo podatki' });
  }
  // Normalize phone: strip + and spaces
  const phone = String(customerPhone).replace(/[^\d]/g, '');
  if (phone.length < 8) return res.status(400).json({ error: 'Neveljavna telefonska številka' });

  try {
    const salon = await resolveBookSalon(req);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const svc = await db.getServiceById(salon.id, serviceId);
    const duration = svc?.duration_minutes || salon.booking_interval_minutes || 30;
    const bookingMode = normalizeBookingMode(salon.booking_mode);
    const needsExactTime = bookingMode === 'exact_time';
    if (needsExactTime && !time) return res.status(400).json({ error: 'Izberite uro' });
    const bookingTime = needsExactTime ? time : '00:00';

    // Double-check slot is still free
    const freeTimes = needsExactTime ? await cal.getFreeTimesForDate(salon, date, duration) : [bookingTime];
    if (needsExactTime && !freeTimes.includes(time)) {
      return res.status(409).json({ error: 'Ta termin je žal že zaseden. Izberite drugega.' });
    }

    const bookingPayload = {
      customer_phone: phone,
      customer_name: customerName.trim(),
      salon_id: salon.id,
      service_id: svc?.id || null,
      booking_date: date,
      booking_time: bookingTime + ':00',
      duration_minutes: needsExactTime ? duration : 0,
      status: 'pending',
      notes: bookingMode === 'inquiry' ? 'Povprasevanje iz obrazca' : (bookingMode === 'date_only' ? 'Rezervacija - datum brez ure' : (bookingMode === 'month_only' ? 'Rezervacija - samo mesec' : '')),
      form_answers: Object.keys(formAnswers).length ? JSON.stringify(formAnswers) : null
    };

    let booking;
    try {
      booking = needsExactTime ? await db.createBookingIfFree(bookingPayload) : await db.createBooking(bookingPayload);
    } catch (err) {
      if (err.code === 'SLOT_TAKEN') {
        return res.status(409).json({ error: 'Ta termin je žal že zaseden. Izberite drugega.' });
      }
      throw err;
    }
    const ref6 = booking.id ? booking.id.slice(-6).toUpperCase() : 'BOOK01';
    const fmtDate = date;
    const fmtTime = needsExactTime ? time : (bookingMode === 'month_only' ? date.slice(0,7) : 'po dogovoru');

    await notifyBookingAdmin(salon, customerName.trim(), phone, fmtDate, fmtTime, ref6, 'Spletna rezervacija', formAnswers);

    res.json({ success: true, ref: ref6, date: fmtDate, time: fmtTime });
  } catch (err) {
    console.error('POST /api/book error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Customer: my bookings ─────────────────────────────────────
app.get('/api/book/my', async (req, res) => {
  const salon = await resolveBookSalon(req);
  if (!salon) return res.status(404).json({ error: 'Salon not found' });
  const phone = String(req.query.phone || '').replace(/[^\d]/g, '');
  if (!phone) return res.status(400).json({ error: 'Manjka telefon' });
  try {
    const bookings = await db.getBookingsByPhone(salon.id, phone, null);
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Customer: cancel booking ──────────────────────────────────
app.post('/api/book/cancel', async (req, res) => {
  const { ref, phone } = req.body;
  if (!ref || !phone) return res.status(400).json({ error: 'Manjkajo podatki' });
  try {
    const booking = await db.getBooking(ref);
    if (!booking) return res.status(404).json({ error: 'Rezervacija ni najdena' });
    const cleanedPhone = String(phone).replace(/[^\d]/g, '');
    if (booking.customer_phone !== cleanedPhone) return res.status(403).json({ error: 'Napacna telefonska stevilka' });
    await db.updateBookingStatus(booking.id, 'cancelled');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Calendar (owner dashboard) ───────────────────────────────
app.get('/api/calendar', async (req, res) => {
  const isMaster = isMasterRequest(req);
  let ownerSalon = null;
  if (!isMaster) {
    ownerSalon = await salonAuth(req, res);
    if (!ownerSalon) return;
  }
  const { year, month, salonId } = req.query;
  try {
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || (new Date().getMonth() + 1);
    const from = `${y}-${String(m).padStart(2,'0')}-01`;
    const toDate = new Date(y, m, 0);
    const to = `${y}-${String(m).padStart(2,'0')}-${String(toDate.getDate()).padStart(2,'0')}`;
    const scopedSalonId = isMaster ? (salonId || null) : ownerSalon.id;
    res.json(await db.getBookingsForRange(scopedSalonId, from, to));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Email confirm/cancel link (Ewa klikne v emailu) ──────────
app.get('/api/confirm-booking', async (req, res) => {
  const { id, action } = req.query;
  if (!id) return res.status(400).send('<h2>Napaka: manjka ID rezervacije.</h2>');
  try {
    const booking = await db.getBookingById(id);
    if (!booking) return res.status(404).send('<h2>Rezervacija ni najdena.</h2>');
    if (booking.status === 'confirmed' && action === 'confirm') {
      return res.send(resultPage('✅ Že potrjeno', `Rezervacija <b>${id.slice(-6)}</b> je bila že potrjena.`, '#22c55e'));
    }
    if (booking.status === 'cancelled') {
      return res.send(resultPage('❌ Že preklicano', `Rezervacija <b>${id.slice(-6)}</b> je bila že preklicana.`, '#ef4444'));
    }

    const salon = await db.getSalonById(booking.salon_id);
    const phoneId = (salon && salon.whatsapp_phone_number_id) || process.env.WA_PHONE_ID;
    const token = (salon && salon.whatsapp_access_token) || process.env.WA_TOKEN;
    const fmtD = d => { const dt = new Date(d.substring(0,10)+'T12:00:00'); return String(dt.getDate()).padStart(2,'0')+'.'+String(dt.getMonth()+1).padStart(2,'0')+'.'+dt.getFullYear(); };
    const custDate = fmtD(booking.booking_date || '2000-01-01');
    const custTime = (booking.booking_time || '').substring(0, 5);
    const ref6 = id.slice(-6);
    const notesEmail = (booking.notes || '').match(/customer_email:([^\s,]+)/)?.[1];

    if (action === 'cancel') {
      await db.updateBookingStatus(id, 'cancelled');
      // Obvesti stranko
      if (booking.customer_phone && booking.customer_phone !== 'manual' && phoneId && token) {
        wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
          `❌ Žal vaša rezervacija za ${custDate} ob ${custTime} ni bila potrjena.\n\nZa novo rezervacijo nam pišite. 🙏`
        )).catch(e => console.error('email-cancel WA err:', e.message));
      }
      return res.send(resultPage('❌ Rezervacija zavrnjena', `Rezervacija stranke <b>${booking.customer_name || ref6}</b> za ${custDate} ob ${custTime} je bila zavrnjena.`, '#ef4444'));
    }

    // action === confirm (default)
    await db.updateBookingStatus(id, 'confirmed');

    // WA stranki
    if (booking.customer_phone && booking.customer_phone !== 'manual' && phoneId && token) {
      try {
        await wa.send(phoneId, token, wa.customerConfirmTemplate(booking.customer_phone, custDate, custTime, salon?.name || ''));
      } catch {
        wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
          `✅ Vaša rezervacija je potrjena!\n\n📅 ${custDate} ob ${custTime}\n\nHvala, vidimo se! 💆`
        )).catch(e => console.error('email-confirm WA err:', e.message));
      }
    }
    // Email stranki
    if (notesEmail) {
      mail.sendCustomerBookingConfirmed(notesEmail, booking.customer_name || 'stranka', salon?.name || '', custDate, custTime, ref6)
        .catch(e => console.error('email-confirm customer email err:', e.message));
    }

    return res.send(resultPage('✅ Rezervacija potrjena!', `Rezervacija stranke <b>${booking.customer_name || ref6}</b> za ${custDate} ob ${custTime} je bila potrjena.<br><br>Stranka je bila obveščena.`, '#22c55e'));
  } catch (err) {
    console.error('confirm-booking err:', err.message);
    res.status(500).send('<h2>Napaka strežnika.</h2>');
  }
});

function resultPage(title, body, color) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="background:#fff;border-radius:16px;padding:40px 48px;max-width:420px;text-align:center;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="font-size:48px;margin-bottom:16px;">${color === '#22c55e' ? '✅' : '❌'}</div>
    <h2 style="color:${color};margin:0 0 12px;font-size:22px;">${title}</h2>
    <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 24px;">${body}</p>
    <a href="/admin.html" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;">Odpri dashboard →</a>
  </div>
</body></html>`;
}

// ─── Admin: confirm booking ────────────────────────────────────
async function bookingActionSalon(req, res) {
  if (isMasterRequest(req)) {
    const salonId = req.body?.salonId || req.query.salonId;
    return salonId ? db.getSalonById(salonId) : null;
  }
  return salonAuth(req, res);
}

app.patch('/api/admin/bookings/:ref/confirm', async (req, res) => {
  const actionSalon = await bookingActionSalon(req, res);
  const isMaster = isMasterRequest(req);
  if (!isMaster && !actionSalon) return;
  try {
    const salon = actionSalon || await db.getSalonById(req.body?.salonId || req.query.salonId);
    const booking = actionSalon
      ? await db.getBookingForSalon(actionSalon.id, req.params.ref)
      : await db.getBooking(req.params.ref);
    if (!booking) return res.status(404).json({ error: 'Rezervacija ni najdena' });
    await db.updateBookingStatus(booking.id, 'confirmed');
    res.json({ success: true });

    // Pošlji obvestilo stranki (async, ne blokiraj odgovora)
    if (salon) {
      const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
      const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
      const custDate = booking.booking_date ? (() => {
        const d = new Date(booking.booking_date.substring(0,10) + 'T12:00:00');
        return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
      })() : '?';
      const custTime = (booking.booking_time || '').substring(0, 5);
      const ref = req.params.ref;

      // WA stranki (samo če ima telefon in ni manual)
      if (booking.customer_phone && booking.customer_phone !== 'manual' && phoneId && token) {
        try {
          await wa.send(phoneId, token, wa.customerConfirmTemplate(booking.customer_phone, custDate, custTime, salon.name));
        } catch {
          try {
            await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
              `✅ Vaša rezervacija je potrjena!\n\n📅 ${custDate} ob ${custTime}\n\nHvala, vidimo se! 💆`
            ));
          } catch (e2) { console.error('Dashboard confirm WA err:', e2.message); }
        }
      }

      // Email stranki (če je shranjen v notes)
      const notesEmail = (booking.notes || '').match(/customer_email:([^\s,]+)/)?.[1];
      if (notesEmail) {
        mail.sendCustomerBookingConfirmed(
          notesEmail, booking.customer_name || 'stranka',
          salon.name, custDate, custTime, ref
        ).catch(e => console.error('[email] dashboard confirm:', e.message));
      }
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/admin/bookings/:ref/cancel', async (req, res) => {
  const actionSalon = await bookingActionSalon(req, res);
  const isMaster = isMasterRequest(req);
  if (!isMaster && !actionSalon) return;
  try {
    const salon = actionSalon;
    const booking = actionSalon
      ? await db.getBookingForSalon(actionSalon.id, req.params.ref)
      : await db.getBooking(req.params.ref);
    if (!booking) return res.status(404).json({ error: 'Rezervacija ni najdena' });
    await db.updateBookingStatus(booking.id, 'cancelled');
    res.json({ success: true });

    // Obvesti stranko o zavrnitvi (async)
    if (salon) {
      const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
      const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
      const custDate = booking.booking_date ? (() => {
        const d = new Date(booking.booking_date.substring(0,10) + 'T12:00:00');
        return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
      })() : '?';
      const custTime = (booking.booking_time || '').substring(0, 5);

      if (booking.customer_phone && booking.customer_phone !== 'manual' && phoneId && token) {
        wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
          `❌ Žal vaša rezervacija za ${custDate} ob ${custTime} ni bila potrjena.\n\nZa novo rezervacijo nam pišite. 🙏`
        )).catch(e => console.error('Dashboard cancel WA err:', e.message));
      }
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Admin: manual booking ─────────────────────────────────────
app.post('/api/admin/bookings', async (req, res) => {
  const isMaster = isMasterRequest(req);
  let salon;
  if (isMaster) {
    const salonId = req.body.salonId;
    if (!salonId) return res.status(400).json({ error: 'Manjka salonId' });
    salon = await db.getSalonById(salonId);
  } else {
    salon = await salonAuth(req, res);
  }
  if (!salon) return;
  const { customerName, customerPhone, date, time, serviceId, notes } = req.body;
  if (!customerName || !date) return res.status(400).json({ error: 'Manjkajo podatki' });
  const phone = String(customerPhone || '').replace(/[^\d]/g, '');
  try {
    const svc = serviceId ? await db.getServiceById(salon.id, serviceId) : null;
    const booking = await db.createBooking({
      customer_phone: phone,
      customer_name: customerName.trim(),
      salon_id: salon.id,
      service_id: svc?.id || null,
      booking_date: date,
      booking_time: time ? time + ':00' : '00:00',
      duration_minutes: svc?.duration_minutes || 0,
      status: 'confirmed',
      notes: notes || 'Ročna rezervacija'
    });
    res.json({ success: true, id: booking.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
// ══════════════════════════════════════════════════════════════
// DELIVERY DASHBOARD ENDPOINTS
// ══════════════════════════════════════════════════════════════

// GET /api/orders — vrne naročila za lastnikov salon
app.get('/api/orders', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const status = req.query.status || 'all';
    const today = t.todayStr();
    const orderDir = status === 'pending' ? 'asc' : 'desc';
    const pageSize = 50;
    const page = Math.max(0, parseInt(req.query.page || '0', 10));
    const offset = page * pageSize;
    let url = `${process.env.SUPABASE_URL}/rest/v1/sb_bookings?salon_id=eq.${salon.id}&order=created_at.${orderDir}&limit=${pageSize}&offset=${offset}`;
    if (status === 'pending') url += '&status=eq.pending';
    else if (status === 'today') url += `&booking_date=eq.${today}&status=neq.pending`;
    else if (status === 'all') {
      const from = req.query.from || '';
      const to = req.query.to || today;
      if (from) url += `&booking_date=gte.${from}`;
      url += `&booking_date=lte.${to}`;
    }
    const { default: axios } = await import('axios');
    const r = await axios.get(url, {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
        Prefer: 'count=exact'
      }
    });
    const total = parseInt(r.headers['content-range']?.split('/')[1] || '0', 10);
    res.json({ orders: r.data, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/orders/:id/accept — sprejmi naročilo + pošlji čas dostave stranki
app.post('/api/orders/:id/accept', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const minutes = parseInt(req.body.minutes) || 30;
    const booking = await db.getBookingForSalon(salon.id, req.params.id.slice(-6));
    // Also try by full ID
    const bookingFull = booking || await (async () => {
      const { default: axios } = await import('axios');
      const r = await axios.get(
        `${process.env.SUPABASE_URL}/rest/v1/sb_bookings?id=eq.${req.params.id}&salon_id=eq.${salon.id}`,
        { headers: { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_KEY } }
      );
      return r.data[0] || null;
    })();
    if (!bookingFull) return res.status(404).json({ error: 'Naročilo ni najdeno' });
    await db.updateBookingStatus(bookingFull.id, 'confirmed');
    // Notify customer via WA
    if (bookingFull.customer_phone) {
      const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
      const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
      const isPickup = (bookingFull.notes || '').startsWith('PREVZEM');
      const acceptMsg = botMsg(salon, isPickup ? 'accepted_pickup' : 'accepted_delivery', {
        minute: String(minutes),
        naslov: (isPickup && salon.pickup_address) ? `\n📍 Prevzem: ${salon.pickup_address}` : ''
      });
      wa.send(phoneId, token, wa.textMsg(bookingFull.customer_phone, acceptMsg))
        .catch(e => console.error('[delivery accept] WA err:', e.message));
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats — analitika naročil
app.get('/api/stats', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const { default: axios } = await import('axios');
    const headers = { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_KEY };
    const base = process.env.SUPABASE_URL + '/rest/v1';
    const range = req.query.range || '30'; // dni
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();

    // Naročila v obdobju
    const [bookingsR, itemsR] = await Promise.all([
      axios.get(`${base}/sb_bookings?salon_id=eq.${salon.id}&created_at=gte.${since}&status=neq.cancelled&order=created_at.asc`, { headers }),
      axios.get(`${base}/sb_order_items?salon_id=eq.${salon.id}&created_at=gte.${since}&order=created_at.asc`, { headers })
    ]);
    const bookings = bookingsR.data || [];
    const items    = itemsR.data || [];

    // Skupni promet iz order_items (točni podatki)
    const totalRevenue = items.reduce((s, i) => s + (parseFloat(i.price) * (i.quantity || 1)), 0);
    const totalOrders  = bookings.length;
    const avgOrder     = totalOrders ? (totalRevenue / totalOrders) : 0;

    // Top artikli
    const itemCount = {};
    const itemRevenue = {};
    items.forEach(i => {
      itemCount[i.name]   = (itemCount[i.name] || 0) + (i.quantity || 1);
      itemRevenue[i.name] = (itemRevenue[i.name] || 0) + parseFloat(i.price) * (i.quantity || 1);
    });
    const topItems = Object.entries(itemCount)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, qty]) => ({ name, qty, revenue: itemRevenue[name] || 0 }));

    // Promet po dnevih
    const byDay = {};
    bookings.forEach(b => {
      const day = (b.created_at || b.booking_date || '').slice(0, 10);
      if (!byDay[day]) byDay[day] = { orders: 0, revenue: 0 };
      byDay[day].orders++;
    });
    items.forEach(i => {
      const day = (i.created_at || '').slice(0, 10);
      if (byDay[day]) byDay[day].revenue += parseFloat(i.price) * (i.quantity || 1);
    });
    const dailyChart = Object.entries(byDay)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));

    // Promet po kategorijah
    const byCat = {};
    items.forEach(i => {
      const c = i.category || 'Ostalo';
      byCat[c] = (byCat[c] || 0) + parseFloat(i.price) * (i.quantity || 1);
    });
    const catChart = Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([cat, rev]) => ({ cat, rev }));

    res.json({ totalRevenue, totalOrders, avgOrder, topItems, dailyChart, catChart });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/orders/:id/reject — zavrni naročilo
app.post('/api/orders/:id/reject', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const booking = await (async () => {
      const { default: axios } = await import('axios');
      const r = await axios.get(
        `${process.env.SUPABASE_URL}/rest/v1/sb_bookings?id=eq.${req.params.id}&salon_id=eq.${salon.id}`,
        { headers: { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_KEY } }
      );
      return r.data[0] || null;
    })();
    if (!booking) return res.status(404).json({ error: 'Naročilo ni najdeno' });
    await db.updateBookingStatus(booking.id, 'cancelled');
    if (booking.customer_phone) {
      const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
      const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
      wa.send(phoneId, token, wa.textMsg(booking.customer_phone, botMsg(salon, 'rejected'))).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Public Contact Form (landing page) ──────────────────────────────────────
app.post('/api/contact', rateLimit(10, 10 * 60 * 1000), async (req, res) => {
  try {
    const { name, email, phone, business_type, lokal, panoga, zelja, soglasje } = req.body || {};
    if (!name || !email || !business_type) {
      return res.status(400).json({ error: 'Manjkajo obvezna polja.' });
    }
    /*
      Soglasje je obvezno. Doslej je bilo preverjeno samo v brskalniku — torej
      ga je bilo mogoče obiti in o njem ni bilo nikakršnega zapisa.

      Zavrnemo, kadar je IZRECNO neoznačeno. Kadar polja v zahtevi ni, gre
      najverjetneje za starejšo stran iz predpomnilnika brskalnika; tako
      prijavo sprejmemo, v pošti pa piše, da podatka ni.
    */
    if (soglasje === false) {
      return res.status(400).json({ error: 'Za kontakt potrebujemo vaše soglasje.' });
    }

    /*
      Imena polj v e-pošti so ISTA kot na obrazcu (public/kontakt.html) — kdor
      bere prijavo, vidi natanko tisto, kar je obiskovalec izpolnil.

      Stran pošlje polja ločeno; "business_type" (zlepljen niz) ostaja zaradi
      zapisa v bazo in ker ga lahko pošlje starejša različica strani iz
      predpomnilnika brskalnika. V tem primeru se izpiše kot ena vrstica.
    */
    const esc = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const locenaPolja = !!(lokal || panoga);
    const vrsticeObrazca = locenaPolja
      ? [
          ['Ime in priimek', name],
          ['Telefon (WhatsApp)', phone || '—'],
          ['E-pošta', email],
          ['Ime lokala ali salona', lokal || '—'],
          ['Kaj delaš?', panoga || '—'],
          ['Kaj bi rad, da pomočnik prevzame?', zelja || '—'],
          ['Soglasje za kontakt', soglasje === undefined ? 'ni podatka (starejši obrazec)' : (soglasje ? 'da' : 'ni označeno')]
        ]
      : [
          ['Ime in priimek', name],
          ['Telefon (WhatsApp)', phone || '—'],
          ['E-pošta', email],
          ['Vrsta posla', business_type],
          // Vrstica je tudi tu, da zapis o soglasju nikoli ne manjka.
          ['Soglasje za kontakt', soglasje === undefined ? 'ni podatka (starejši obrazec)' : (soglasje ? 'da' : 'ni označeno')]
        ];

    const ownerEmail = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtek.si';
    const ownerPhone = process.env.FLOWTIQ_OWNER_PHONE || '38640599185';
    const waToken   = process.env.WA_TOKEN;
    const waPhoneId = process.env.WA_PHONE_ID;

    // 1. Email notification to Tomaz
    const ownerSubject = locenaPolja
      ? `Nova prijava FlowTek — ${lokal || name}${panoga ? ` (${panoga})` : ''}`
      : `Nova prijava FlowTek — ${business_type}`;
    const ownerHtml = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#1e293b">Nova prijava na FlowTek</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          ${vrsticeObrazca.map(([oznaka, vrednost], i) => `<tr><td style="padding:8px 12px;${i % 2 === 0 ? 'background:#f8fafc;' : ''}font-weight:600;color:#475569;width:44%;vertical-align:top">${esc(oznaka)}</td><td style="padding:8px 12px;color:#1e293b;${i % 2 === 0 ? 'background:#f8fafc;' : ''}">${esc(vrednost)}</td></tr>`).join('\n          ')}
        </table>
        <p style="margin-top:20px;color:#64748b;font-size:.9rem">Prijava prejeta: ${new Date().toLocaleString('sl-SI')}</p>
      </div>`;
    mail.sendEmail(ownerEmail, ownerSubject, ownerHtml).catch(e => console.error('[contact] owner email:', e.message));

    // 2. WhatsApp notification to Tomaz (best-effort — works within 24h session window)
    if (waToken && waPhoneId) {
      const waMsg = 'Nova prijava FlowTek!\n\n'
        + vrsticeObrazca.map(([oznaka, vrednost]) => oznaka + ': ' + vrednost).join('\n')
        + '\n\nOdgovori jim čim prej.';
      wa.send(waPhoneId, waToken, wa.textMsg(ownerPhone, waMsg)).catch(() => {});
    }

    // 3. Confirmation email to prospect
    const prospectSubject = 'Hvala za prijavo — FlowTek vas bo kontaktiral';
    const prospectHtml = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#1e293b">Prijava prejeta!</h2>
        <p style="color:#475569">Pozdravljeni ${esc(name)},</p>
        <p style="color:#475569">Hvala za zanimanje za <strong>FlowTek</strong>! Prijava je bila uspešno poslana.</p>
        <p style="color:#475569">Kontaktirali vas bomo v <strong>nekaj urah</strong> na e-pošto <strong>${esc(email)}</strong>${phone ? ` ali telefon <strong>${esc(phone)}</strong>` : ''}.</p>
        <div style="background:#f0fdf4;border-radius:12px;padding:16px;margin:20px 0">
          <p style="margin:0;color:#166534;font-weight:600">Naši paketi:</p>
          <p style="margin:6px 0 0;color:#166534">AI Start <strong>89 € / mes</strong> (do 500 naročil) · AI Pro <strong>159,99 € / mes</strong> (do 1.500) · Premium <strong>299 € / mes</strong> (do 10.000). Brez vezave.</p>
        </div>
        <p style="color:#64748b;font-size:.9rem">— Ekipa FlowTek</p>
      </div>`;
    mail.sendEmail(email, prospectSubject, prospectHtml).catch(e => console.error('[contact] prospect email:', e.message));

    // 4. Save to sb_contacts table (best-effort — table may not exist yet)
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_KEY;
    if (sbUrl && sbKey) {
      axios.post(`${sbUrl}/rest/v1/sb_contacts`, {
        name, email, phone: phone || null, business_type,
        created_at: new Date().toISOString(), source: 'landing_form'
      }, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' } })
      .catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[contact] error:', err.message);
    res.status(500).json({ error: 'Napaka pri posiljanju prijave.' });
  }
});




// ─── LEADS TRACKING ──────────────────────────────────────────────────────────

async function sbLeads(method, path, body = null) {
  const { default: axios } = await import('axios');
  const headers = {
    apikey: process.env.SUPABASE_KEY,
    Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  const url = process.env.SUPABASE_URL + '/rest/v1' + path;
  const r = await axios({ method, url, headers, data: body });
  return r.data;
}

// GET /track/:token/:response — email click tracking
app.get('/track/:token/:response', async (req, res) => {
  const { token, response } = req.params;
  const status = response === 'da' ? 'interested' : response === 'ne' ? 'not_interested' : null;
  if (!status) return res.redirect('/');
  try {
    await sbLeads('patch',
      `/leads?token=eq.${encodeURIComponent(token)}&status=eq.sent`,
      { status, responded_at: new Date().toISOString() }
    );
  } catch (e) { /* ne blokiraj redirect */ }
  const trackBase = process.env.BASE_URL || 'https://salonbot-production-785b.up.railway.app';
  if (status === 'interested') {
    res.redirect(trackBase + '/?interesse=1#cena');
  } else {
    res.redirect(trackBase + '/?interesse=0');
  }
});

// GET /api/leads — statistika za dashboard (master only)
app.get('/api/leads', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    // Paginacija — Supabase vrne max 1000 vrstic naenkrat
    let all = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const page = await sbLeads('get', `/leads?order=id.asc&limit=${pageSize}&offset=${offset}`);
      all = all.concat(page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    const stats = {
      total: all.length,
      sent: all.filter(l => l.status === 'sent').length,
      interested: all.filter(l => l.status === 'interested').length,
      not_interested: all.filter(l => l.status === 'not_interested').length,
      by_category: {},
      leads: all
    };
    for (const l of all) {
      if (!stats.by_category[l.category]) stats.by_category[l.category] = { total: 0, interested: 0 };
      stats.by_category[l.category].total++;
      if (l.status === 'interested') stats.by_category[l.category].interested++;
    }
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// POST /api/leads/import — bulk uvoz iz Google Maps bookmarklet
app.post('/api/leads/import', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { businesses, category } = req.body;
  if (!Array.isArray(businesses) || !businesses.length)
    return res.status(400).json({ error: 'Manjka seznam podjetij' });

  const crypto2 = require('crypto');
  let added = 0, skipped = 0;

  for (const b of businesses) {
    const name = (b.name || '').trim();
    if (!name || name.length < 2) { skipped++; continue; }
    const cat = category || b.category || b.type || 'Ostalo';
    const token = crypto2.randomBytes(16).toString('hex') + Date.now().toString(36);
    try {
      await sbLeads('post', '/leads', {
        email: b.email || '',
        business_name: name,
        category: cat,
        token,
        phone: b.phone || '',
        address: b.address || '',
        website: b.website || '',
      });
      added++;
    } catch (e) {
      // Preskoči duplicate (unique token constraint)
      skipped++;
    }
  }
  res.json({ success: true, added, skipped, total: businesses.length });
});

// POST /api/leads — dodaj nov lead (za generiranje emailov)
app.post('/api/leads', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const { email, business_name, category, token } = req.body;
    if (!email || !business_name || !category || !token) return res.status(400).json({ error: 'Manjkajo polja' });
    const result = await sbLeads('post', '/leads', { email, business_name, category, token });
    res.json(result[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ─── LEADS — SCRAPER + RESEND ────────────────────────────────────────────────

const TEMPLATE_DIR = path.join(__dirname, 'email-templates');

const CAT_TEMPLATE = {
  'frizerji': 'promo_frizerji', 'frizer': 'promo_frizerji',
  'nohtarnic': 'promo_nohtarnice', 'nohti': 'promo_nohtarnice', 'gel nohti': 'promo_nohtarnice',
  'masaž': 'promo_masaze', 'wellness': 'promo_masaze', 'spa': 'promo_masaze',
  'pasji': 'promo_pasji_strizci', 'grooming': 'promo_pasji_strizci',
  'picerij': 'promo_picerije', 'pizza': 'promo_picerije',
  'restavraci': 'promo_picerije',
  'fotograf': '07_fotografski_studii',
  'kozmetič': 'promo_kozmeticarke', 'kozmetika': 'promo_kozmeticarke',
  'pedikar': 'promo_kozmeticarke', 'pedikur': 'promo_kozmeticarke',
  'trener': '10_osebni_trenerji', 'fitnes': '10_osebni_trenerji',
  'tattoo': 'promo_tattoo', 'tetoviran': 'promo_tattoo',
};

const EMAIL_SUBJECTS = {
  'promo_frizerji':       '{} — WhatsApp asistent za rezervacije v vašem salonu ✂️',
  'promo_nohtarnice':     '{} — WhatsApp asistent za rezervacije v vaši nohtarnici 💅',
  'promo_masaze':         '{} — WhatsApp asistent za rezervacije v vašem masažnem salonu 💆',
  'promo_pasji_strizci':  '{} — WhatsApp asistent za termine v vašem pasjem salonu 🐾',
  'promo_picerije':       '{} — WhatsApp naročanje za vašo restavracijo 🍕',
  'promo_tattoo':         '{} — WhatsApp asistent za termine v vašem tattoo studiu 🎨',
  'promo_kozmeticarke':   '{} — WhatsApp asistent za rezervacije v vašem kozmetičnem salonu ✨',
  '07_fotografski_studii':'{} — termini za fotografiranje na avtopilotu?',
  '10_osebni_trenerji':   '{} — treningi rezervirani, vi trenirate',
  '12_splosno':           '{} — WhatsApp pomočnik za vaše podjetje?',
};

function resolveTemplate(category) {
  const c = (category || '').toLowerCase();
  for (const [key, val] of Object.entries(CAT_TEMPLATE)) {
    if (c.includes(key)) return val;
  }
  return '12_splosno';
}

function loadEmailTemplate(templateName) {
  const fp = path.join(TEMPLATE_DIR, templateName + '.html');
  if (!fs.existsSync(fp)) {
    const fallback = path.join(TEMPLATE_DIR, '12_splosno.html');
    return fs.existsSync(fallback) ? fs.readFileSync(fallback, 'utf8') : null;
  }
  return fs.readFileSync(fp, 'utf8');
}

function personalizeEmail(html, businessName, token) {
  return html.replace(/\{\{IME_FIRME\}\}/g, businessName).replace(/\{\{TOKEN\}\}/g, token);
}

function parseBiziSi(html) {
  const results = [];
  try {
    // Razdeli na company bloke po h2/h3 naslovih
    const blocks = html.split(/(?=<(?:h2|h3|div)[^>]+class="[^"]*(?:company|result|card)[^"]*")/i);
    const seen = new Set();
    for (const block of blocks) {
      // Ime podjetja — iščemo v heading tagih
      const nameM = block.match(/<(?:h[23])[^>]*>\s*(?:<[^>]+>)*([A-ZŠŽČ][^<]{2,80})(?:<\/[^>]+>)*\s*<\/(?:h[23])>/i)
                 || block.match(/class="[^"]*(?:company-name|naziv|title)[^"]*"[^>]*>\s*(?:<[^>]+>)*([A-ZŠŽČ][^<]{2,80})/i)
                 || block.match(/<a href="\/[^"]+\/?"[^>]*>([A-ZŠŽČ][^<]{2,60})<\/a>/i);
      if (!nameM) continue;
      const name = nameM[1].replace(/<[^>]+>/g, '').trim();
      if (!name || name.length < 3 || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      const emailM = block.match(/href="mailto:([^"\s]+@[^"\s]+\.[^"\s]+)"/i);
      const phoneM = block.match(/href="tel:([+\d\s()\-]{6,20})"/i)
                  || block.match(/(?:>|\s)(0\d[\d\s]{6,14})(?:<|\/)/);
      const addrM  = block.match(/class="[^"]*(?:address|naslov)[^"]*"[^>]*>([^<]{5,100})/i)
                  || block.match(/(?:ulica|cesta|trg|pot|ave|dr\.|ul\.) [^<]{2,60}/i);

      results.push({
        name,
        email: emailM ? emailM[1].toLowerCase() : '',
        phone: phoneM ? phoneM[1].replace(/\s+/g, ' ').trim() : '',
        address: addrM ? addrM[0].replace(/<[^>]+>/g, '').trim() : '',
      });
      if (results.length >= 30) break;
    }
  } catch (e) { /* vrni kar imamo */ }
  return results;
}

// GET /api/leads/search — Brave Search API → spletne strani → emaili
app.get('/api/leads/search', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { category, region } = req.query;
  if (!category || !region) return res.status(400).json({ error: 'Manjkata category in region' });

  const BRAVE_KEY = process.env.BRAVE_API_KEY;
  if (!BRAVE_KEY) {
    return res.status(503).json({
      error: 'BRAVE_API_KEY ni nastavljen. Dodaj ga v Railway env vars (zastonj na https://api.search.brave.com/register).'
    });
  }

  try {
    const axios = require('axios');
    const query = `${category} ${region}`;

    const SKIP = ['facebook.com','instagram.com','twitter.com','linkedin.com','youtube.com',
                  'wikipedia.org','google.com','duckduckgo.com','bing.com','bizi.si','zlatestrani.si',
                  'telefonski.com','paginaslive.si','yelp.com','tripadvisor.com','find-open.com',
                  'foursquare.com','mapquest.com'];

    // 1. Brave Search API — vrne JSON z URL-ji spletnih strani
    const braveResp = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: { q: query, count: 20, country: 'si', search_lang: 'sl', freshness: 'py' },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_KEY,
      },
      timeout: 12000,
    });

    const results = braveResp.data?.web?.results || [];
    const urlMap = new Map(); // domain -> {url, title}

    for (const r of results) {
      if (!r.url) continue;
      try {
        const host = new URL(r.url).hostname;
        const domain = host.replace(/^www\./, '');
        if (SKIP.some(s => domain.includes(s))) continue;
        if (!urlMap.has(domain)) {
          urlMap.set(domain, { url: r.url.split('?')[0].split('#')[0], title: r.title || '' });
        }
      } catch(e) {}
    }

    // 2. Obiščemo vsako stran in poiščemo email z regex
    const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}/g;
    const SKIP_EMAILS = ['example.com','sentry.io','wix.com','wordpress.com','schema.org',
                         'googletagmanager','apple.com','w3.org','amazonaws.com','cloudfront.net',
                         'fbcdn.net','cdn.','static.','noreply','no-reply','@2x','@3x'];
    const businesses = [];

    await Promise.allSettled([...urlMap.entries()].map(async ([domain, { url, title }]) => {
      try {
        const pageResp = await axios.get(url, {
          timeout: 7000,
          maxRedirects: 3,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
          responseType: 'text',
        });
        const html = String(pageResp.data).slice(0, 150000);

        // Emaili
        const allEmails = [...new Set(html.match(EMAIL_RE) || [])].filter(e =>
          !SKIP_EMAILS.some(s => e.toLowerCase().includes(s)) && e.length < 80 && !e.includes('..')
        );
        if (!allEmails.length) return;

        // Ime podjetja iz strani ali iz Brave naslova
        let name = '';
        const ogSite = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]{2,60})"/i);
        const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]{2,80})"/i);
        const titleTag = html.match(/<title[^>]*>([^<]{2,100})<\/title>/i);
        const raw = (ogSite && ogSite[1]) || (ogTitle && ogTitle[1]) || (titleTag && titleTag[1]) || title || domain;
        name = raw.split(/[|\-–•]/)[0].trim().slice(0, 60);
        if (!name || name.length < 2) name = domain;

        // Telefon (slovensko)
        const phoneM = html.match(/(?:tel:|>|\s|")(\+?386[\d\s\-]{7,14}|0[1-9][\d\s]{7,9})/);
        const phone = phoneM ? phoneM[1].replace(/\s+/g, ' ').trim() : '';

        businesses.push({ name, email: allEmails[0], website: url, phone, domain });
      } catch(e) { /* timeout/blok — preskoči */ }
    }));

    businesses.sort((a, b) => a.name.localeCompare(b.name, 'sl'));
    res.json({ businesses, total: businesses.length, withEmail: businesses.length, query, region, category });

  } catch (err) {
    const msg = err.response?.status === 401 ? 'Neveljaven BRAVE_API_KEY'
               : err.response?.status === 429 ? 'Brave API limit dosežen (2000/mesec)'
               : err.message;
    res.status(502).json({ error: 'Iskanje ni uspelo: ' + msg });
  }
});

// GET /api/leads/find — bizi.si (legacy, obdržimo za kompatibilnost)
app.get('/api/leads/find', async (req, res) => {
  // Preusmeri na nov endpoint
  const { q, city } = req.query;
  req.query.category = q || '';
  req.query.region = city || '';
  return res.redirect(307, `/api/leads/search?category=${encodeURIComponent(q||'')}&region=${encodeURIComponent(city||'')}`);
});

// PATCH /api/leads/:id — posodobi email/telefon/naslov
app.patch('/api/leads/:id', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const allowed = ['email','phone','address','business_name','category','notes','status'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nič za posodobiti' });
  try {
    const result = await sbLeads('patch', `/leads?id=eq.${req.params.id}`, updates);
    res.json(result[0] || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leads/:id/send — pošlji email prek Resend
app.post('/api/leads/:id/send', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY ni nastavljen' });
  try {
    const leads = await sbLeads('get', `/leads?id=eq.${req.params.id}`);
    const lead = leads[0];
    if (!lead) return res.status(404).json({ error: 'Lead ne obstaja' });
    if (!lead.email) return res.status(400).json({ error: 'Email ni vnesen' });

    const templateName = resolveTemplate(lead.category);
    const templateHtml = loadEmailTemplate(templateName);
    if (!templateHtml) return res.status(500).json({ error: 'Predloga ne obstaja' });

    const html = personalizeEmail(templateHtml, lead.business_name, lead.token);
    const subject = (EMAIL_SUBJECTS[templateName] || '{} — WhatsApp pomočnik?').replace('{}', lead.business_name);
    const fromEmail = process.env.RESEND_FROM || 'FlowTek <info@flowtek.si>';

    const { default: axios } = await import('axios');
    await axios.post('https://api.resend.com/emails', {
      from: fromEmail,
      to: lead.email,
      subject,
      html,
      reply_to: 'info@flowtek.si',
    }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

    await sbLeads('patch', `/leads?id=eq.${lead.id}&email_sent_at=is.null`,
      { email_sent_at: new Date().toISOString(), status: 'sent' });

    res.json({ success: true, to: lead.email, subject });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ error: msg });
  }
});


// POST /api/leads/:id/reset — ponastavi email_sent_at (za ponovno pošiljanje)
app.post('/api/leads/:id/reset', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const leads = await sbLeads('get', `/leads?id=eq.${req.params.id}`);
    if (!leads[0]) return res.status(404).json({ error: 'Lead ne obstaja' });
    await sbLeads('patch', `/leads?id=eq.${req.params.id}`,
      { email_sent_at: null, responded_at: null, status: 'new' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/bulk-send — pošlji vsem neposlani
app.post('/api/leads/bulk-send', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY ni nastavljen' });
  try {
    const { category, limit: limitParam } = req.body || {};
    const limitVal = Math.min(parseInt(limitParam) || 30, 100);
    let leadsUrl = '/leads?email_sent_at=is.null&email=neq.&order=id.asc&limit=' + limitVal;
    if (category) leadsUrl += '&category=eq.' + encodeURIComponent(category);
    const pending = await sbLeads('get', leadsUrl);
    if (!pending.length) return res.json({ success: true, sent: 0, message: 'Ni leadov za pošiljanje' });

    const { default: axios } = await import('axios');
    const fromEmail = process.env.RESEND_FROM || 'FlowTek <info@flowtek.si>';
    let sent = 0, errors = [];

    for (const lead of pending) {
      try {
        const templateName = resolveTemplate(lead.category);
        const html = personalizeEmail(loadEmailTemplate(templateName) || '', lead.business_name, lead.token);
        const subject = (EMAIL_SUBJECTS[templateName] || '{} — WhatsApp pomočnik?').replace('{}', lead.business_name);
        await axios.post('https://api.resend.com/emails', {
          from: fromEmail, to: lead.email, subject, html, reply_to: 'info@flowtek.si',
        }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        await sbLeads('patch', `/leads?id=eq.${lead.id}`,
          { email_sent_at: new Date().toISOString(), status: 'sent' });
        sent++;
        // Rate limit — Resend free plan 2/sec
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        errors.push({ id: lead.id, email: lead.email, error: e.response?.data?.message || e.message });
      }
    }
    res.json({ success: true, sent, errors, total: pending.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



app.listen(PORT, () => {
  console.log(`FlowTek server running on port ${PORT}`);
  /*
    Uskladitev naročnin s Stripom. Zavestno ni v startScheduler(): tista
    funkcija se v tem projektu nikoli ne kliče, poleg tega pa poganja tudi
    pošiljanje pošte strankam (dnevni povzetki, opomniki, prošnje za ocene).
    Plačila ne smejo biti odvisna od tega, ali se tisto vklopi.
  */
  stripeSync.zacniUskladitev();

  /*
    Predpomnilnik preklicanih master sej. Napolnimo ga takoj, da odjava velja
    tudi po ponovnem zagonu, in osvežujemo vsako minuto, da preklic z drugega
    procesa ali iz baze pride v veljavo brez deploya.
  */
  osveziMasterValidFrom();
  setInterval(osveziMasterValidFrom, 60 * 1000).unref();
});
