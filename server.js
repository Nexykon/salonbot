require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
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
  return ['exact_time', 'date_only', 'inquiry', 'month_only', 'sales', 'delivery'].includes(mode) ? mode : 'exact_time';
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
    'notify_email', 'booking_confirmation_message'
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
      'notify_whatsapp', 'notify_email', 'auto_confirm', 'review_link', 'review_message', 'reactivation_message', 'booking_confirmation_message'];
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
// ══════════════════════════════════════════════════════════════
// DELIVERY DASHBOARD ENDPOINTS
// ══════════════════════════════════════════════════════════════

// GET /api/orders — vrne naročila za lastnikov salon
app.get('/api/orders', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  try {
    const status = req.query.status || 'all';
    const today = new Date().toISOString().slice(0, 10);
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
      const token = process.env.WA_TOKEN;
      wa.send(phoneId, token, wa.textMsg(bookingFull.customer_phone,
        `🍕 Vaše naročilo je potrjeno!\n\n⏱️ Dostava v pribl. *${minutes} minutah*\n\nHvala za naročilo! 😊`
      )).catch(e => console.error('[delivery accept] WA err:', e.message));
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
      const token = process.env.WA_TOKEN;
      wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
        `Žal vaše naročilo ni bilo sprejeto. Za več informacij nas pokličite. 😔`
      )).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  if (status === 'interested') {
    res.redirect('https://salonbot-production-785b.up.railway.app/?interesse=1#cena');
  } else {
    res.redirect('https://salonbot-production-785b.up.railway.app/?interesse=0');
  }
});

// GET /api/leads — statistika za dashboard (master only)
app.get('/api/leads', async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const all = await sbLeads('get', '/leads?order=sent_at.desc&limit=500');
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
  'frizerji': '01_frizerji', 'frizer': '01_frizerji',
  'nohtarnic': '02_nohtarnice', 'nohti': '02_nohtarnice', 'gel nohti': '02_nohtarnice',
  'masaž': '03_masaze_wellness', 'wellness': '03_masaze_wellness', 'spa': '03_masaze_wellness',
  'pasji': '04_pasji_strizci', 'grooming': '04_pasji_strizci',
  'picerij': '05_picerije', 'pizza': '05_picerije',
  'restavraci': '06_restavracije',
  'fotograf': '07_fotografski_studii',
  'kozmetič': '08_kozmeticarke', 'kozmetika': '08_kozmeticarke',
  'pedikar': '09_pedikure', 'pedikur': '09_pedikure',
  'trener': '10_osebni_trenerji', 'fitnes': '10_osebni_trenerji',
  'tattoo': '11_tattoo', 'tetoviran': '11_tattoo',
};

const EMAIL_SUBJECTS = {
  '01_frizerji':          '{} — stranke se same naročajo prek WhatsAppa?',
  '02_nohtarnice':        '{} — zamujene rezervacije prek WhatsAppa?',
  '03_masaze_wellness':   '{} — kakšen bi bil polni urnik brez klicev?',
  '04_pasji_strizci':     '{} — manj klicev, več šišanja 🐾',
  '05_picerije':          '{} — naročila za dostavo prek WhatsAppa?',
  '06_restavracije':      '{} — rezervacije miz prek WhatsAppa?',
  '07_fotografski_studii':'{} — termini za fotografiranje na avtopilotu?',
  '08_kozmeticarke':      '{} — stranke se naročajo same, vi delate v miru',
  '09_pedikure':          '{} — polni termini brez telefoniranja?',
  '10_osebni_trenerji':   '{} — treningi rezervirani, vi trenirate',
  '11_tattoo':            '{} — manj pisanja, več tattooja',
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

// GET /api/leads/search — scraper: DuckDuckGo → spletne strani → emaili (brez cheerio)
app.get('/api/leads/search', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const { category, region } = req.query;
  if (!category || !region) return res.status(400).json({ error: 'Manjkata category in region' });

  try {
    const axios = require('axios');

    // Helper: izvleče vrednosti atributov iz HTML stringa brez DOM parserja
    function attr(html, tag, attrName) {
      const re = new RegExp(`<${tag}[^>]+${attrName}="([^"]+)"`, 'gi');
      const results = [];
      let m;
      while ((m = re.exec(html)) !== null) results.push(m[1]);
      return results;
    }

    function textContent(html) {
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const query = `${category} ${region} kontakt`;
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=sl-sl`;

    // 1. Iskanje na DuckDuckGo HTML (plain HTML, brez JS)
    const ddgResp = await axios.get(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sl-SI,sl;q=0.9,en;q=0.8',
        'Cookie': 'kl=sl-sl',
      },
      timeout: 15000,
    });

    const ddgHtml = ddgResp.data;

    // 2. Izvleči URL-je iz DDG rezultatov
    // DDG HTML format: <a class="result__a" href="..."> ali uddg= param
    const SKIP = ['facebook.com','instagram.com','twitter.com','linkedin.com','youtube.com',
                  'wikipedia.org','google.com','duckduckgo.com','bizi.si','zlatestrani.si',
                  'telefonski.com','paginaslive.si','yelp.com','tripadvisor.com','find-open.com'];

    const urlSet = new Map(); // domain -> url
    
    // DDG wraps links — poiščemo uddg= ali direktne href
    const uddgRe = /uddg=([^&"\s]+)/gi;
    let um;
    while ((um = uddgRe.exec(ddgHtml)) !== null) {
      try {
        const url = decodeURIComponent(um[1]);
        if (!url.startsWith('http')) continue;
        const host = new URL(url).hostname;
        const domain = host.replace(/^www\./, '');
        if (SKIP.some(s => domain.includes(s))) continue;
        if (!urlSet.has(domain)) urlSet.set(domain, url.split('?')[0].split('#')[0]);
      } catch(e) {}
    }

    // Fallback: direktni href linki
    const hrefRe = /<a[^>]+href="(https?:\/\/[^"]+)"/gi;
    let hm;
    while ((hm = hrefRe.exec(ddgHtml)) !== null) {
      try {
        const url = hm[1];
        const host = new URL(url).hostname;
        const domain = host.replace(/^www\./, '');
        if (SKIP.some(s => domain.includes(s))) continue;
        if (!urlSet.has(domain)) urlSet.set(domain, url.split('?')[0].split('#')[0]);
      } catch(e) {}
    }

    const urlList = [...urlSet.entries()].slice(0, 20);

    // 3. Za vsako spletno stran poišči email + ime
    const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}/g;
    const SKIP_EMAILS = ['example.com','sentry.io','wix.com','wordpress.com','jquery','schema.org',
                         'googletagmanager','apple.com','w3.org','vimeo.com','amazonaws.com',
                         'cloudfront.net','fbcdn.net','akamai','cdn.','static.'];
    const businesses = [];

    await Promise.allSettled(urlList.map(async ([domain, url]) => {
      try {
        const pageResp = await axios.get(url, {
          timeout: 7000,
          maxRedirects: 3,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          responseType: 'text',
        });
        const html = String(pageResp.data).slice(0, 200000); // max 200KB

        // Emaili
        const allEmails = [...new Set(html.match(EMAIL_RE) || [])].filter(e =>
          !SKIP_EMAILS.some(s => e.toLowerCase().includes(s)) &&
          !e.startsWith('no-reply') && !e.startsWith('noreply') && !e.includes('..') &&
          e.length < 80
        );
        if (!allEmails.length) return;

        // Ime podjetja
        let name = '';
        const ogSite = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]{2,60})"/i);
        const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]{2,80})"/i);
        const titleTag = html.match(/<title[^>]*>([^<]{2,100})<\/title>/i);
        const raw = (ogSite || ogTitle || titleTag || [,''])[1];
        name = raw.split(/[|\-–]/)[0].trim().slice(0, 60) || domain;
        if (name.length < 2) name = domain;

        // Telefon (slovensko)
        const phoneM = html.match(/(?:tel:|>|\s|")(\+?386[\d\s\-]{7,14}|0[\d]{8,9})/);
        const phone = phoneM ? phoneM[1].replace(/\s+/g, ' ').trim() : '';

        businesses.push({ name, email: allEmails[0], website: url, phone, domain });
      } catch (e) { /* preskoči - timeout ali blok */ }
    }));

    businesses.sort((a, b) => a.name.localeCompare(b.name, 'sl'));

    res.json({ businesses, total: businesses.length, query, region, category });
  } catch (err) {
    res.status(502).json({ error: 'Iskanje ni uspelo: ' + err.message });
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
    const fromEmail = process.env.RESEND_FROM || 'FlowTiq <hello@flowtiq.si>';

    const { default: axios } = await import('axios');
    await axios.post('https://api.resend.com/emails', {
      from: fromEmail,
      to: lead.email,
      subject,
      html,
    }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

    await sbLeads('patch', `/leads?id=eq.${lead.id}&email_sent_at=is.null`,
      { email_sent_at: new Date().toISOString(), status: 'sent' });

    res.json({ success: true, to: lead.email, subject });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/leads/bulk-send — pošlji vsem neposlani
app.post('/api/leads/bulk-send', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY ni nastavljen' });
  try {
    const pending = await sbLeads('get', '/leads?email_sent_at=is.null&email=neq.&order=id.asc&limit=100');
    if (!pending.length) return res.json({ success: true, sent: 0, message: 'Ni leadov za pošiljanje' });

    const { default: axios } = await import('axios');
    const fromEmail = process.env.RESEND_FROM || 'FlowTiq <hello@flowtiq.si>';
    let sent = 0, errors = [];

    for (const lead of pending) {
      try {
        const templateName = resolveTemplate(lead.category);
        const html = personalizeEmail(loadEmailTemplate(templateName) || '', lead.business_name, lead.token);
        const subject = (EMAIL_SUBJECTS[templateName] || '{} — WhatsApp pomočnik?').replace('{}', lead.business_name);
        await axios.post('https://api.resend.com/emails', {
          from: fromEmail, to: lead.email, subject, html,
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
