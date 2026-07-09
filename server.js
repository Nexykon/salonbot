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
const { getPreset, listBusinessTypes, normalizeBusinessType, slugify } = require('./src/presets');
const t = require('./src/time');
const { botMsg, DEFAULTS: BOT_MSG_DEFAULTS, KEYS: BOT_MSG_KEYS } = require('./src/botmsg');

const app = express();

// ─── Raw body za Stripe webhook (mora biti pred express.json) ──
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Static files (dashboard) ─────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

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

// ─── Preprost rate limiter za javne endpointe (per IP) ────────
const rateBuckets = new Map();
function rateLimit(maxReq, windowMs) {
  return (req, res, next) => {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    const key = req.path + '|' + ip;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;
    if (rateBuckets.size > 10000) rateBuckets.clear(); // varovalka proti puščanju pomnilnika
    if (bucket.count > maxReq) return res.status(429).json({ error: 'Preveč zahtev. Poskusite čez nekaj minut.' });
    next();
  };
}

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

// ─── Stripe helperja ──────────────────────────────────────
function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}
function stripePlanPrices() {
  return {
    starter: process.env.STRIPE_PRICE_STARTER || '',
    pro: process.env.STRIPE_PRICE_PRO || '',
    ai: process.env.STRIPE_PRICE_AI || ''
  };
}
function planFromPriceId(priceId) {
  const prices = stripePlanPrices();
  if (priceId && priceId === prices.ai) return 'ai';
  if (priceId && priceId === prices.pro) return 'pro';
  if (priceId && priceId === prices.starter) return 'starter';
  return null;
}

function isMasterRequest(req) {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  const configuredApiKey = process.env.ADMIN_API_KEY;
  return session?.role === 'master' || (!!configuredApiKey && req.headers['x-api-key'] === configuredApiKey);
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
  if (session) {
    const salon = await db.getSalonById(session.salonId);
    if (salon) return salon;
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
    try { await db.logError(salon?.id, 'handler', err.message, err.stack); } catch(_) {}
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

app.post('/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    res.sendStatus(200);
    return;
  }

  let event;
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const cs = event.data.object;
        const salonId = cs.metadata?.salon_id;
        const csPlan = ['pro', 'ai'].includes(cs.metadata?.plan) ? cs.metadata.plan : 'starter';
        if (salonId && cs.mode === 'subscription' && cs.subscription) {
          await db.updateSalonStripe(salonId, cs.customer, cs.subscription, 'active', csPlan);
          console.log('Checkout completed — salon', salonId, 'plan', csPlan);
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) await db.updateSubscriptionStatus(subId, 'active');
        await db.logInvoice(null, invoice.id, invoice.amount_paid / 100, 'paid');
        console.log('Subscription activated:', subId);
        break;
      }
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const sub = event.data.object;
        const subId = sub.subscription || sub.id;
        if (subId) await db.updateSubscriptionStatus(subId, 'inactive');
        console.log('Subscription deactivated:', subId);

        // Obvesti FlowTiq ownerja
        try {
          const cancelledSalon = await db.getSalonByStripeSubId(subId);
          const ownerEmail = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtiq.si';
          const reason = event.type === 'invoice.payment_failed' ? 'Neuspešno plačilo' : 'Stranka odpovedala';
          const waNumberId = cancelledSalon?.whatsapp_phone_number_id || 'ni nastavljen';
          await mail.sendEmail(ownerEmail,
            `⚠️ Odpoved naročnine — ${cancelledSalon?.name || subId}`,
            [
              `Salon je odpovedal naročnino ali plačilo ni uspelo.`,
              ``,
              `Salon: ${cancelledSalon?.name || '-'}`,
              `Email: ${cancelledSalon?.owner_email || '-'}`,
              `WhatsApp Phone Number ID: ${waNumberId}`,
              `Admin telefon: ${cancelledSalon?.admin_phone || '-'}`,
              `Razlog: ${reason}`,
              `Stripe Sub ID: ${subId}`,
              ``,
              `UKREPAJ: Odstrani WhatsApp številko (Phone Number ID: ${waNumberId}) iz Meta Business Manager.`,
            ].join('\n')
          );
        } catch (notifyErr) {
          console.error('Cancellation notify error:', notifyErr.message);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const statusMap = { active: 'active', trialing: 'trial', past_due: 'inactive', unpaid: 'inactive', canceled: 'inactive', incomplete_expired: 'inactive' };
        const status = statusMap[sub.status] || 'trial';
        const subPlan = planFromPriceId(sub.items?.data?.[0]?.price?.id);
        await db.updateSubscriptionStatus(sub.id, status, subPlan);
        break;
      }
    }
  } catch (err) {
    console.error('Stripe event processing error:', err.message);
  }

  res.json({ received: true });
});

// ─── Onboarding API — registracija novega salona ──────────────
app.get('/api/business-types', (req, res) => {
  res.json(listBusinessTypes());
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
      subscription_plan: plan || 'starter',
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
    const baseUrl = process.env.BASE_URL || 'https://flowtiq.si';
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


// ─── Katalog paketov (cene + ali vsebuje AI) ───────────────────
const PLAN_CATALOG = {
  starter: { label: 'Osnovni',    price: 49.99,  ai: false },
  pro:     { label: 'Pro',        price: 79.99,  ai: false },
  ai:      { label: 'AI natakar', price: 159.99, ai: true  },
  premium: { label: 'Premium',    price: 299,    ai: true  }
};
function planInfo(plan) { return PLAN_CATALOG[plan] || PLAN_CATALOG.starter; }

// ─── Javna samopostrežna registracija ──────────────────────────
// Ustvari salon v statusu "čaka na priklop" (bot ugasnjen). AI paketi nimajo
// brezplačnega testa -> billing_status='awaiting' (plačilo predračuna pred priklopom).
app.post('/api/signup', rateLimit(5, 10 * 60 * 1000), async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ success: true }); // honeypot (boti izpolnijo skrito polje)

    const name    = String(b.company_name || b.name || '').trim();
    const email   = String(b.owner_email || b.email || '').trim().toLowerCase();
    const contact = String(b.contact_person || '').trim();
    const vat     = String(b.vat_id || '').trim();
    const address = String(b.address || '').trim();
    const phone   = cleanPhone(b.phone);
    const plan    = PLAN_CATALOG[b.plan] ? b.plan : 'starter';
    const type    = normalizeBusinessType(b.business_type || 'custom');

    if (!name || !email || !contact) {
      return res.status(400).json({ error: 'Naziv firme, kontaktna oseba in email so obvezni.' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Neveljaven email naslov.' });
    }

    const preset = getPreset(type);
    const slugBase = slugify(b.business_slug || name);
    let slug = slugBase, n = 2;
    while (await db.getSalonBySlug(slug)) slug = `${slugBase}-${n++}`;

    const info = planInfo(plan);
    const bookingMode = plan === 'ai' ? 'delivery' : defaultBookingMode(type);

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
      bot_active: false,          // bot ostane ugasnjen do priklopa
      trial_ends_at: null,        // trial za osnovna paketa začne ob priklopu (+30 dni)
      working_days: '1,2,3,4,5,6',
      working_hours_start: '08:00',
      working_hours_end: '19:00'
      // NAMENOMA brez whatsapp_phone_number_id — priklop opravi admin
    };

    const salon = await db.createSalon(salonData);
    if (preset.services && preset.services.length) {
      await db.createServicesFromPreset(salon.id, preset.services).catch(() => {});
    }

    const baseUrl = process.env.BASE_URL || 'https://flowtiq.si';
    const setupUrl = `${baseUrl}/setup.html?token=${salon.salon_token}`;

    // 1) stranki: welcome + link za nastavitev gesla (dostop do dashboarda takoj)
    let custEmail = false;
    try { custEmail = await mail.sendWelcomeEmail(salon, setupUrl); }
    catch (e) { console.warn('Signup welcome email failed:', e.message); }

    // 2) tebi: obvestilo za priklop
    const ownerEmail = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtiq.si';
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
        `Paket: ${info.label} (${info.price} €${info.ai ? ' — vsebuje AI, plačilo predračuna PRED priklopom' : ' — 30 dni brezplačno od priklopa'})`,
        `Obračun: ${salonData.billing_period === 'yearly' ? 'letno' : 'mesečno'}`,
        '', `Salon ID: ${salon.id}`,
        'Priklop opraviš v master dashboardu.'
      ].join('\n'));
    } catch (e) { console.warn('Owner notify email failed:', e.message); }

    console.log('New self-signup:', salon.id, name, info.label, custEmail ? '(cust email sent)' : '(cust email failed)');
    res.json({
      success: true,
      salon_id: salon.id,
      ai: info.ai,
      email_sent: custEmail,
      message: info.ai
        ? 'Registracija uspešna! Za aktivacijo prejmete predračun — po plačilu vas priklopimo in pošljemo račun.'
        : 'Registracija uspešna! Kontaktirali vas bomo za priklop (aktivacijo). Preverite email za dostop do nadzorne plošče.'
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
    if (!info.ai) updates.trial_ends_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
    const updates = { billing_status: 'paid', paid_at: new Date().toISOString(), subscription_status: 'active' };
    if (req.body?.invoice_no) updates.invoice_no = String(req.body.invoice_no).trim();
    const updated = await db.updateSalonSettings(salon.id, updates);
    console.log('Salon marked paid:', salon.id, salon.name);
    res.json({ success: true, salon: updated || null });
  } catch (err) { console.error('Mark-paid error:', err.message); res.status(500).json({ error: err.message }); }
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
    const baseUrl = process.env.BASE_URL || 'https://flowtiq.si';
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
      business_label: s.business_label || getPreset(s.business_type || 'hair').label,
      business_slug: s.business_slug || '',
      bot_phone_display: s.bot_phone_display || '',
      whatsapp_phone_number_id: s.whatsapp_phone_number_id || '',
      owner_name: s.owner_name,
      owner_email: s.owner_email,
      owner_password_configured: !!s.owner_password_hash,
      subscription_status: s.subscription_status,
      subscription_plan: s.subscription_plan,
      admin_phone: s.admin_phone,
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

// ─── Send welcome WA message to salon admin ───────────────────
app.post('/api/salons/:id/welcome', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { id } = req.params;
  try {
    const salon = (await db.getAllSalons()).find(s => s.id === id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });

    const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
    const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
    const to = salon.admin_phone;
    if (!to) return res.status(400).json({ error: 'Salon nima nastavljene admin_phone številke.' });

    const salonName = salon.name || 'Salon';
    const msg = wa.textMsg(to,
      `👋 Pozdravljeni!\n\n` +
      `Vaš SalonBot za *${salonName}* je aktiviran in pripravljen na delo! 🎉\n\n` +
      `📱 Stranke vas bodo kontaktirale prek WhatsApp bota.\n` +
      `✅ Ko stranka rezervira termin, boste takoj obveščeni.\n` +
      `💬 Za upravljanje bot-a enostavno pišite tukaj:\n\n` +
      `• Pošljite *#termini* za prikaz rezervacij danes\n` +
      `• Pošljite *#jutri* za prikaz rezervacij jutri\n` +
      `• Pošljite *#storitve* za seznam storitev\n` +
      `• Pošljite *#nauci [info]* da bot naučite o salonu\n\n` +
      `Srečno! 💇 — Ekipa SalonBot`
    );

    await wa.send(phoneId, token, msg);
    console.log(`Welcome message sent to ${to} for salon ${salonName}`);
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
  const { plan } = req.body;
  if (!['starter', 'pro', 'ai'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  try {
    const axios = require('axios');
    const BASE = process.env.SUPABASE_URL + '/rest/v1';
    const HEADERS = {
      apikey: process.env.SUPABASE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    };
    await axios.patch(`${BASE}/sb_salons?id=eq.${id}`, { subscription_plan: plan }, { headers: HEADERS });
    console.log(`Salon ${id} plan → ${plan}`);
    res.json({ success: true, plan });
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
    'greeting_message',
    'working_days',
    'working_hours_start',
    'working_hours_end',
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

// ─── Owner Settings endpoints (settings.html) ────────────────

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
      subscription_plan: salon.subscription_plan || 'starter',
      subscription_status: salon.subscription_status || 'trial',
      signup_status: salon.signup_status || 'active',
      billing_status: salon.billing_status || 'none',
      billing_period: salon.billing_period || 'monthly',
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
      bot_messages: (salon.bot_messages && typeof salon.bot_messages === 'object') ? salon.bot_messages : {},
      bot_messages_defaults: BOT_MSG_DEFAULTS,
      review_link: salon.review_link || ''
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/settings — posodobi nastavitve salona
app.patch('/api/settings', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const allowed = ['name', 'greeting_message', 'working_days', 'working_hours_start',
      'working_hours_end', 'booking_interval_minutes', 'break_between_minutes', 'max_advance_days',
      'booking_mode', 'datetime_position', 'form_fields', 'inquiry_confirmation_message',
      'pos_type', 'pos_token', 'pos_account', 'pos_spot_id',
      'packaging_price', 'delivery_fee',
      'allow_delivery', 'allow_pickup', 'pickup_packaging', 'pickup_address', 'bot_messages', 'bot_active', 'delivery_area',
      'notify_whatsapp', 'notify_email', 'auto_confirm', 'review_link', 'review_message', 'reactivation_message', 'booking_confirmation_message'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.booking_mode) updates.booking_mode = normalizeBookingMode(updates.booking_mode);
    if (updates.datetime_position) updates.datetime_position = updates.datetime_position === 'last' ? 'last' : 'first';
    if (updates.form_fields !== undefined) updates.form_fields = safeFormFields(updates.form_fields, {});
    if (updates.packaging_price !== undefined) updates.packaging_price = Math.max(0, parseFloat(String(updates.packaging_price).replace(',', '.')) || 0);
    if (updates.delivery_fee !== undefined) updates.delivery_fee = Math.max(0, parseFloat(String(updates.delivery_fee).replace(',', '.')) || 0);
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
    if (POS_KEYS.some(k => updates[k] !== undefined) && !['pro', 'ai'].includes(salon.subscription_plan || 'starter')) {
      return res.status(403).json({ error: 'POS integracija je na voljo v Pro paketu.' });
    }
    if (updates.pos_spot_id !== undefined) updates.pos_spot_id = parseInt(updates.pos_spot_id) || 1;
    await db.updateSalonSettings(salon.id, updates);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/pos-test — preveri POS povezavo (lastnik, samo Pro)
app.post('/api/settings/pos-test', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  if (!['pro', 'ai'].includes(salon.subscription_plan || 'starter')) {
    return res.status(403).json({ ok: false, msg: 'POS integracija je na voljo v Pro paketu.' });
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
// POST /api/billing/checkout { plan: 'starter'|'pro' } — ustvari Stripe Checkout
app.post('/api/billing/checkout', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: 'Plačila še niso omogočena. Pišite na info@flowtiq.si.' });
  const plan = ['pro', 'ai'].includes(req.body.plan) ? req.body.plan : 'starter';
  const priceId = (plan === 'ai' && salon.custom_price_id) ? salon.custom_price_id : stripePlanPrices()[plan];
  if (!priceId) return res.status(503).json({ error: `Stripe cena za paket "${plan}" še ni nastavljena (env STRIPE_PRICE_${plan.toUpperCase()}).` });
  try {
    const baseUrl = process.env.BASE_URL || 'https://flowtiq.si';
    const returnPage = (salon.booking_mode === 'delivery' || salon.business_type === 'restaurant') ? 'delivery.html' : 'settings.html';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Obstoječega Stripe kupca ponovno uporabi, sicer predizpolni email
      ...(salon.stripe_customer_id ? { customer: salon.stripe_customer_id } : { customer_email: salon.owner_email || undefined }),
      subscription_data: {
        // 30 dni brezplačno samo ob prvi naročnini
        ...(salon.stripe_subscription_id ? {} : { trial_period_days: 30 }),
        metadata: { salon_id: salon.id, plan }
      },
      metadata: { salon_id: salon.id, plan },
      allow_promotion_codes: true,
      success_url: `${baseUrl}/${returnPage}?billing=success`,
      cancel_url: `${baseUrl}/${returnPage}?billing=cancel`
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[billing] checkout error:', e.message);
    res.status(500).json({ error: e.message });
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
    const baseUrl = process.env.BASE_URL || 'https://flowtiq.si';
    const returnPage = (salon.booking_mode === 'delivery' || salon.business_type === 'restaurant') ? 'delivery.html' : 'settings.html';
    const portal = await stripe.billingPortal.sessions.create({
      customer: salon.stripe_customer_id,
      return_url: `${baseUrl}/${returnPage}`
    });
    res.json({ url: portal.url });
  } catch (e) {
    console.error('[billing] portal error:', e.message);
    res.status(500).json({ error: e.message });
  }
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
app.get('/api/settings/services', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const services = await db.getServices(salon.id);
    res.json(services.filter(s => s.is_active !== false));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/services — nova storitev
app.post('/api/settings/services', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  const { name, price, duration_minutes, description, category } = req.body;
  if (!name) return res.status(400).json({ error: 'Ime storitve je obvezno' });
  try {
    const svc = await db.createService(salon.id, {
      name: name.trim(),
      price: parseFloat(price) || 0,
      duration_minutes: parseInt(duration_minutes) || 0,
      description: description || '',
      category: category || 'Ostalo',
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
  const { name, price, duration_minutes } = req.body;
  try {
    const svc = await db.getServiceById(salon.id, req.params.id);
    if (!svc) return res.status(404).json({ error: 'Storitev ni najdena' });
    await db.updateServiceById(svc.id,
      price !== undefined ? parseFloat(price) : svc.price,
      duration_minutes !== undefined ? parseInt(duration_minutes) : svc.duration_minutes,
      name !== undefined ? name.trim() : svc.name
    );
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
      limits[s.id] = (parseInt(s.ai_monthly_limit) > 0) ? parseInt(s.ai_monthly_limit) : defLimit;
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
app.post('/api/auth/login', async (req, res) => {
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

app.post('/api/auth/master-login', async (req, res) => {
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
    res.json({ success: true, token, role: 'master', redirect: '/dashboard.html' });
  } catch (err) {
    console.error('Master login error:', err.message);
    res.status(500).json({ error: 'Prijava trenutno ni uspela' });
  }
});

app.post('/api/auth/master-forgot', async (req, res) => {
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
      const resetUrl = `${req.protocol}://${req.get('host')}/dashboard.html?reset=${token}`;
      await mail.sendPasswordReset(email, resetUrl);
    }
    res.json({ success: true, message: 'Ce email obstaja, je povezava za ponastavitev poslana.' });
  } catch (err) {
    console.error('Master forgot error:', err.message);
    res.status(500).json({ error: 'Ponastavitev trenutno ni uspela' });
  }
});

app.post('/api/auth/master-reset', async (req, res) => {
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

app.post('/api/auth/start', async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  if (phone.length < 8) return res.status(400).json({ error: 'Neveljavna telefonska stevilka' });
  try {
    if (isMasterAdminPhone(phone)) {
      const code = ownerAuth.createOtp(phone, null, 'master');
      await wa.send(process.env.WA_PHONE_ID, process.env.WA_TOKEN, wa.textMsg(phone, `FlowTiq master admin koda: ${code}\nVelja 10 minut.`));
      return res.json({ success: true, role: 'master', message: 'Master admin koda poslana na WhatsApp.' });
    }

    const salon = await db.getSalonByAdminPhone(phone);
    if (!salon || salon.subscription_status === 'inactive') {
      return res.status(404).json({ error: 'Podjetje s to stevilko ni najdeno' });
    }
    const code = ownerAuth.createOtp(phone, salon.id, 'owner');
    const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
    const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
    await wa.send(phoneId, token, wa.textMsg(phone, `FlowTiq prijavna koda: ${code}\nVelja 10 minut.`));
    res.json({ success: true, message: 'Koda poslana na WhatsApp.' });
  } catch (err) {
    console.error('OTP start error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Kode ni bilo mogoce poslati.' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  const token = ownerAuth.verifyOtp(phone, req.body.code);
  if (!token) return res.status(401).json({ error: 'Napacna ali potekla koda' });
  const session = ownerAuth.getSession(token);
  if (session?.role === 'master') {
    return res.json({ success: true, token, role: 'master', redirect: '/dashboard.html' });
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
    const redirect = (salon.booking_mode === 'delivery' || salon.business_type === 'restaurant') ? '/delivery.html' : '/settings.html';
    res.json({ success: true, token, redirect, salon: publicSalon(salon) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  ownerAuth.clearSession(req.headers.authorization || req.headers['x-owner-token']);
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
    <a href="/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;">Odpri dashboard →</a>
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
    const { name, email, phone, business_type } = req.body || {};
    if (!name || !email || !business_type) {
      return res.status(400).json({ error: 'Manjkajo obvezna polja.' });
    }

    const ownerEmail = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtiq.si';
    const ownerPhone = process.env.FLOWTIQ_OWNER_PHONE || '38640599185';
    const waToken   = process.env.WA_TOKEN;
    const waPhoneId = process.env.WA_PHONE_ID;

    // 1. Email notification to Tomaz
    const ownerSubject = `Nova prijava FlowTiq — ${business_type}`;
    const ownerHtml = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#1e293b">Nova prijava na FlowTiq</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569;width:40%">Ime</td><td style="padding:8px 12px;color:#1e293b">${name}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#475569">Email</td><td style="padding:8px 12px;color:#1e293b">${email}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">Telefon</td><td style="padding:8px 12px;color:#1e293b">${phone || '—'}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#475569">Vrsta posla</td><td style="padding:8px 12px;color:#1e293b">${business_type}</td></tr>
        </table>
        <p style="margin-top:20px;color:#64748b;font-size:.9rem">Prijava prejeta: ${new Date().toLocaleString('sl-SI')}</p>
      </div>`;
    mail.sendEmail(ownerEmail, ownerSubject, ownerHtml).catch(e => console.error('[contact] owner email:', e.message));

    // 2. WhatsApp notification to Tomaz (best-effort — works within 24h session window)
    if (waToken && waPhoneId) {
      const waMsg = `Nova prijava FlowTiq!\n\n${name}\nEmail: ${email}\nTel: ${phone || '—'}\nPosao: ${business_type}\n\nOdgovori jim cim prej!`;
      wa.send(waPhoneId, waToken, wa.textMsg(ownerPhone, waMsg)).catch(() => {});
    }

    // 3. Confirmation email to prospect
    const prospectSubject = 'Hvala za prijavo — FlowTiq vas bo kontaktiral';
    const prospectHtml = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#1e293b">Prijava prejeta!</h2>
        <p style="color:#475569">Pozdravljeni ${name},</p>
        <p style="color:#475569">Hvala za zanimanje za <strong>FlowTiq</strong>! Prijava je bila uspesno poslana.</p>
        <p style="color:#475569">Kontaktirali vas bomo v <strong>nekaj urah</strong> na email <strong>${email}</strong>${phone ? ` ali telefon <strong>${phone}</strong>` : ''}.</p>
        <div style="background:#f0fdf4;border-radius:12px;padding:16px;margin:20px 0">
          <p style="margin:0;color:#166534;font-weight:600">Vasa ugodnost:</p>
          <p style="margin:6px 0 0;color:#166534">Prvih 50 strank dobi <strong>30 dni brezplacno</strong>, nato samo <strong>49,99 € / mesec</strong>!</p>
        </div>
        <p style="color:#64748b;font-size:.9rem">— Ekipa FlowTiq</p>
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
  'promo_frizerji':       '{} — 1 mesec brezplačno za vaš salon ✂️',
  'promo_nohtarnice':     '{} — 1 mesec brezplačno za vašo nohtarnico 💅',
  'promo_masaze':         '{} — 1 mesec brezplačno za vaš masažni salon 💆',
  'promo_pasji_strizci':  '{} — 1 mesec brezplačno za vaš pasji salon 🐾',
  'promo_picerije':       '{} — 1 mesec brezplačno za vašo restavracijo',
  'promo_tattoo':         '{} — 1 mesec brezplačno za vaš tattoo studio 🎨',
  'promo_kozmeticarke':   '{} — 1 mesec brezplačno za vaš kozmetični salon ✨',
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
    const fromEmail = process.env.RESEND_FROM || 'FlowTiq <info@flowtiq.si>';

    const { default: axios } = await import('axios');
    await axios.post('https://api.resend.com/emails', {
      from: fromEmail,
      to: lead.email,
      subject,
      html,
      reply_to: 'info@flowtiq.si',
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
    const fromEmail = process.env.RESEND_FROM || 'FlowTiq <info@flowtiq.si>';
    let sent = 0, errors = [];

    for (const lead of pending) {
      try {
        const templateName = resolveTemplate(lead.category);
        const html = personalizeEmail(loadEmailTemplate(templateName) || '', lead.business_name, lead.token);
        const subject = (EMAIL_SUBJECTS[templateName] || '{} — WhatsApp pomočnik?').replace('{}', lead.business_name);
        await axios.post('https://api.resend.com/emails', {
          from: fromEmail, to: lead.email, subject, html, reply_to: 'info@flowtiq.si',
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
  console.log(`FlowTiq server running on port ${PORT}`);
});
