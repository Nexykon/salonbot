require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { handleMessage } = require('./src/handler');
const db = require('./src/supabase');
const wa = require('./src/whatsapp');
const mail = require('./src/email');
const { startScheduler } = require('./src/scheduler');
const ownerAuth = require('./src/auth');
const { getPreset, listBusinessTypes, normalizeBusinessType, slugify } = require('./src/presets');

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
  return ['exact_time', 'date_only', 'inquiry', 'month_only'].includes(mode) ? mode : 'exact_time';
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
    inquiry_confirmation_message: salon.inquiry_confirmation_message || 'Hvala! Vaše povpraševanje je poslano. Kontaktirali vas bomo za potrditev.'
  };
}

async function resolveBookSalon(req) {
  const ref = req.query.b || req.query.salon || req.body?.business_slug || req.body?.salonId;
  const salon = await db.resolveSalon(ref);
  if (!salon || salon.subscription_status === 'inactive' || salon.is_active === false) return null;
  return salon;
}

function isMasterRequest(req) {
  const bearer = req.headers.authorization || req.headers['x-owner-token'] || '';
  const session = ownerAuth.getSession(bearer);
  const configuredApiKey = process.env.ADMIN_API_KEY;
  return session?.role === 'master' || (!!configuredApiKey && req.headers['x-api-key'] === configuredApiKey);
}

function adminAuth(req, res) {
  if (!isMasterRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
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
  try {
    const answersText = Object.keys(formAnswers || {}).length
      ? `\n\n📋 Odgovori strank:\n${Object.entries(formAnswers).map(([k,v]) => `• ${k}: ${v}`).join('\n')}`
      : '';
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
  }
});

// ─── Stripe Webhook ───────────────────────────────────────────
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
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        await db.updateSubscriptionStatus(subId, 'active');
        await db.logInvoice(null, invoice.id, invoice.amount_paid / 100, 'paid');
        console.log('Subscription activated:', subId);
        break;
      }
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const sub = event.data.object;
        const subId = sub.subscription || sub.id;
        await db.updateSubscriptionStatus(subId, 'inactive');
        console.log('Subscription deactivated:', subId);

        // Obvesti FlowTiq ownerja
        try {
          const cancelledSalon = await db.getSalonByStripeSubId(subId);
          const ownerEmail = process.env.FLOWTIQ_OWNER_EMAIL || 'nexon.crypto@gmail.com';
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
        const status = sub.status === 'active' ? 'active' : 'trial';
        await db.updateSubscriptionStatus(sub.id, status);
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
  if (!['starter', 'pro'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
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
      owner_password_configured: !!salon.owner_password_hash
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
    'notify_email'
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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
      'notify_whatsapp', 'notify_email', 'review_link', 'review_message', 'reactivation_message'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.booking_mode) updates.booking_mode = normalizeBookingMode(updates.booking_mode);
    if (updates.datetime_position) updates.datetime_position = updates.datetime_position === 'last' ? 'last' : 'first';
    if (updates.form_fields !== undefined) updates.form_fields = safeFormFields(updates.form_fields, {});
    await db.updateSalonSettings(salon.id, updates);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  const { name, price, duration_minutes } = req.body;
  if (!name) return res.status(400).json({ error: 'Ime storitve je obvezno' });
  try {
    const svc = await db.createService(salon.id, {
      name: name.trim(),
      price: parseFloat(price) || 0,
      duration_minutes: parseInt(duration_minutes) || 60,
      is_active: true
    });
    res.json(svc);
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
    const salon = await db.getSalonByOwnerEmail(email);
    if (!salon || salon.subscription_status === 'inactive' || !salon.owner_password_hash) {
      return res.status(401).json({ error: 'Napacen email ali geslo' });
    }
    if (!ownerAuth.verifyPassword(password, salon.owner_password_hash)) {
      return res.status(401).json({ error: 'Napacen email ali geslo' });
    }
    const token = ownerAuth.createSession(salon.id, 'owner', { email });
    await db.updateSalonSettings(salon.id, { owner_last_login_at: new Date().toISOString() });
    res.json({ success: true, token, role: 'owner', salon: publicSalon(salon) });
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
app.post('/api/book', async (req, res) => {
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

    const booking = await db.createBooking(bookingPayload);
    const ref6 = booking.id ? booking.id.slice(0,6).toUpperCase() : 'BOOK01';
    const fmtDate = date;
    const fmtTime = needsExactTime ? time : (bookingMode === 'month_only' ? date.slice(0,7) : date);

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
    const token = process.env.WA_TOKEN;
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
      const token = process.env.WA_TOKEN;
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
      const token = process.env.WA_TOKEN;
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
app.listen(PORT, () => {
  console.log(`FlowTiq server running on port ${PORT}`);
});
