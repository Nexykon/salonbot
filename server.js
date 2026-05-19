require('dotenv').config();
const express = require('express');
const path = require('path');
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
  if (type === 'tattoo') {
    return [
      { id: 'idea', label: 'Opis tattoo ideje', type: 'textarea', required: true },
      { id: 'placement', label: 'Mesto na telesu', type: 'text', required: false },
      { id: 'size', label: 'Približna velikost', type: 'text', required: false }
    ];
  }
  return [];
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
  return ['exact_time', 'date_only', 'inquiry'].includes(mode) ? mode : 'exact_time';
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
    await wa.send(phoneId, token, wa.adminBookingNotif(to, customerName, phone, date, time, ref6));
  } catch (e) {
    try {
      await wa.send(phoneId, token, wa.adminBookingNotifSession(to, customerName, phone, date, time, ref6));
    } catch (e2) {
      await wa.send(phoneId, token, wa.textMsg(to,
        `Nova ${sourceLabel || 'rezervacija'}\n\n${customerName}\n+${phone}\n${date} ob ${time}\nRef: ${ref6}` +
        (Object.keys(formAnswers || {}).length ? `\n\nDodatni odgovori:\n${Object.entries(formAnswers).map(([k,v]) => `${k}: ${v}`).join('\n')}` : '')
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
      booking_mode: type === 'tattoo' ? 'inquiry' : 'exact_time',
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
    'form_fields',
    'inquiry_confirmation_message'
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
      notes: bookingMode === 'inquiry' ? 'Povprasevanje iz obrazca' : (bookingMode === 'date_only' ? 'Rezervacija brez izbrane ure' : ''),
      form_answers: formAnswers
    };
    const booking = needsExactTime ? await db.createBookingIfFree(bookingPayload) : await db.createBooking(bookingPayload);

    const ref6 = (booking.id || '').slice(-6);
    const fmtD = `${date.substring(8,10)}.${date.substring(5,7)}.${date.substring(0,4)}`;

    const timeLabel = needsExactTime ? time : (bookingMode === 'date_only' ? 'brez ure' : 'povprasevanje');
    await notifyBookingAdmin(salon, customerName.trim(), phone, fmtD, timeLabel, ref6, bookingMode === 'inquiry' ? 'WEB povprasevanje' : 'WEB rezervacija', formAnswers);

    res.json({ success: true, ref: ref6, date: fmtD, time: timeLabel, customerName: customerName.trim(), booking_mode: bookingMode });
  } catch (err) {
    console.error('Web booking error:', err.message);
    res.status(err.code === 'SLOT_TAKEN' ? 409 : 500).json({ error: err.code === 'SLOT_TAKEN' ? 'Ta termin je zal ze zaseden. Izberite drugega.' : err.message });
  }
});

// Get customer's bookings by phone (public)
app.get('/api/book/my', async (req, res) => {
  let phone = String(req.query.phone || '').replace(/[^\d]/g, '');
  if (phone.length < 8) return res.status(400).json({ error: 'Neveljavna telefonska številka' });
  try {
    const salon = await resolveBookSalon(req);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const today = new Date().toISOString().split('T')[0];
    const rows = await db.getBookingsByPhone(salon.id, phone, today);
    const bookings = rows.map(b => ({
      ref: (b.id || '').slice(-6),
      date: b.booking_date,
      time: (b.booking_time || '').substring(0, 5),
      status: b.status,
      service_id: b.service_id
    }));
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel booking by ref + phone verification (public)
app.post('/api/book/cancel', async (req, res) => {
  const { ref, phone } = req.body;
  if (!ref || !phone) return res.status(400).json({ error: 'Manjkajo podatki' });
  const cleanPhone = String(phone).replace(/[^\d]/g, '');
  try {
    const salon = await resolveBookSalon(req);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const booking = await db.getBookingForSalon(salon.id, ref);
    if (!booking) return res.status(404).json({ error: 'Rezervacija ni najdena' });
    // Verify phone matches
    const bookingPhone = String(booking.customer_phone || '').replace(/[^\d]/g, '');
    if (bookingPhone !== cleanPhone) return res.status(403).json({ error: 'Napačna telefonska številka' });
    // Only allow cancelling future bookings
    const today = new Date().toISOString().split('T')[0];
    if ((booking.booking_date || '').substring(0, 10) < today) {
      return res.status(400).json({ error: 'Pretečenih rezervacij ni mogoče odpovedati' });
    }
    await db.updateBookingStatus(booking.id, 'cancelled');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// All bookings for a month (dashboard calendar)
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

// ─── Admin booking management ─────────────────────────────────

async function bookingActionSalon(req, res) {
  if (isMasterRequest(req)) {
    const salonId = req.body?.salonId || req.query.salonId;
    return salonId ? db.getSalonById(salonId) : null;
  }
  return salonAuth(req, res);
}

// Confirm booking (admin dashboard)
app.patch('/api/admin/bookings/:ref/confirm', async (req, res) => {
  const actionSalon = await bookingActionSalon(req, res);
  const isMaster = isMasterRequest(req);
  if (!isMaster && !actionSalon) return;
  try {
    const booking = actionSalon
      ? await db.getBookingForSalon(actionSalon.id, req.params.ref)
      : await db.getBooking(req.params.ref);
    if (!booking) return res.status(404).json({ error: 'Rezervacija ni najdena' });
    await db.updateBookingStatus(booking.id, 'confirmed');
    // Notify customer via WA
    const salon = actionSalon || await db.getSalonById(booking.salon_id);
    const phoneId = salon?.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
    const token = salon?.whatsapp_access_token || process.env.WA_TOKEN;
    if (booking.customer_phone && booking.customer_phone !== 'manual') {
      const custDate = `${(booking.booking_date||'').substring(8,10)}.${(booking.booking_date||'').substring(5,7)}.${(booking.booking_date||'').substring(0,4)}`;
      const custTime = (booking.booking_time || '').substring(0, 5);
      try {
        await wa.send(phoneId, token, wa.customerConfirmTemplate(booking.customer_phone, custDate, custTime, salon?.name));
      } catch (e) {
        try {
          await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
            `✅ Vaša rezervacija je potrjena!\n\n📅 ${custDate} ob ${custTime}\n\nHvala, vidimo se! 💆`));
        } catch (_) {}
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel booking (admin dashboard)
app.patch('/api/admin/bookings/:ref/cancel', async (req, res) => {
  const actionSalon = await bookingActionSalon(req, res);
  const isMaster = isMasterRequest(req);
  if (!isMaster && !actionSalon) return;
  try {
    const booking = actionSalon
      ? await db.getBookingForSalon(actionSalon.id, req.params.ref)
      : await db.getBooking(req.params.ref);
    if (!booking) return res.status(404).json({ error: 'Rezervacija ni najdena' });
    await db.updateBookingStatus(booking.id, 'cancelled');
    // Notify customer
    const salon = actionSalon || await db.getSalonById(booking.salon_id);
    const phoneId = salon?.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
    const token = salon?.whatsapp_access_token || process.env.WA_TOKEN;
    if (booking.customer_phone && booking.customer_phone !== 'manual') {
      const custDate = `${(booking.booking_date||'').substring(8,10)}.${(booking.booking_date||'').substring(5,7)}.${(booking.booking_date||'').substring(0,4)}`;
      const custTime = (booking.booking_time || '').substring(0, 5);
      try {
        await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
          `❌ Žal vaša rezervacija za ${custDate} ob ${custTime} ni bila potrjena.\n\nZa novo rezervacijo nas kontaktirajte. 🙏`));
      } catch (_) {}
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual add booking (admin dashboard)
app.post('/api/admin/bookings', async (req, res) => {
  const actionSalon = await bookingActionSalon(req, res);
  const isMaster = isMasterRequest(req);
  if (!isMaster && !actionSalon) return;
  const { date, time, customerName, customerPhone, serviceId } = req.body;
  if (!date || !time || !customerName) return res.status(400).json({ error: 'Manjkajo podatki' });
  try {
    const salon = actionSalon || await db.getSalon();
    const svc = await db.getServiceById(salon.id, serviceId);
    const duration = svc?.duration_minutes || salon.booking_interval_minutes || 30;
    const booking = await db.createBookingIfFree({
      salon_id: salon.id,
      customer_name: customerName.trim(),
      customer_phone: customerPhone ? String(customerPhone).replace(/[^\d]/g,'') : 'manual',
      booking_date: date,
      booking_time: time + ':00',
      service_id: svc?.id || null,
      duration_minutes: duration,
      status: 'confirmed'
    });
    res.json({ success: true, ref: (booking.id||'').slice(-6) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Salon Settings Portal ────────────────────────────────────
// Get salon settings
app.get('/api/settings', async (req, res) => {
  const salon = await settingsSalonAuth(req, res);
  if (!salon) return;
  res.json({
    id: salon.id,
    name: salon.name,
    business_type: salon.business_type || 'hair',
    business_label: salon.business_label || getPreset(salon.business_type || 'hair').label,
    business_slug: salon.business_slug || '',
    bot_phone_display: salon.bot_phone_display || '',
    working_days: salon.working_days || '1,2,3,4