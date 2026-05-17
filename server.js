require('dotenv').config();
const express = require('express');
const path = require('path');
const { handleMessage } = require('./src/handler');
const db = require('./src/supabase');
const wa = require('./src/whatsapp');
const { startScheduler } = require('./src/scheduler');

const app = express();

// ─── Raw body za Stripe webhook (mora biti pred express.json) ──
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Static files (dashboard) ─────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

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

  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages?.length) return;

    const msgObj = entry.messages[0];
    const phoneNumberId = entry.metadata?.phone_number_id;

    // Multi-salon: najdi pravi salon po WhatsApp phone number ID
    let salon = phoneNumberId
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
app.post('/onboard', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, owner_name, owner_email, admin_phone, whatsapp_phone_number_id, plan } = req.body;
  if (!name || !owner_email || !admin_phone) {
    return res.status(400).json({ error: 'name, owner_email, admin_phone required' });
  }

  try {
    const salon = await db.createSalon({
      name,
      owner_name: owner_name || '',
      owner_email,
      admin_phone,
      whatsapp_phone_number_id: whatsapp_phone_number_id || process.env.WA_PHONE_ID,
      subscription_status: 'trial',
      subscription_plan: plan || 'starter',
      working_days: '1,2,3,4,5,6',
      working_hours_start: '08:00',
      working_hours_end: '19:00'
    });

    console.log('New salon onboarded:', salon.id, name);
    res.json({ success: true, salon_id: salon.id, message: `Salon "${name}" ustvarjen.` });
  } catch (err) {
    console.error('Onboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Salons list (admin) ──────────────────────────────────────
app.get('/salons', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const salons = await db.getAllSalons();
  res.json(salons.map(s => ({
    id: s.id,
    name: s.name,
    owner_name: s.owner_name,
    owner_email: s.owner_email,
    subscription_status: s.subscription_status,
    subscription_plan: s.subscription_plan,
    admin_phone: s.admin_phone,
    created_at: s.created_at
  })));
});

// ─── Update salon status (admin dashboard) ───────────────────
app.patch('/api/salons/:id/status', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id } = req.params;
  try {
    const salon = (await db.getAllSalons()).find(s => s.id === id);
    if (!salon) return res.status(404).json({ error: 'Salon not found' });

    const phoneId = process.env.WA_PHONE_ID;
    const token = process.env.WA_TOKEN;
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
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
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
app.get('/api/errors', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const errors = await db.getRecentErrors(100);
    res.json(errors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/errors', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.clearErrors();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', bot: 'SalonBot v3', version: '4.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SalonBot running on port ${PORT}`);
  startScheduler();
});
