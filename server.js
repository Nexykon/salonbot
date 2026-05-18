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

// ─── Public Booking API ───────────────────────────────────────
const cal = require('./src/calendar');

// Salon info + services (public)
app.get('/api/book/info', async (req, res) => {
  try {
    const salon = await db.getSalon();
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const services = await db.getServices(salon.id);
    res.json({
      salon: { name: salon.name, working_hours_start: salon.working_hours_start, working_hours_end: salon.working_hours_end },
      services: services.map(s => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes, price: s.price }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Available dates (public)
app.get('/api/book/dates', async (req, res) => {
  try {
    const salon = await db.getSalon();
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const dates = await cal.getFreeDates(salon, 45);
    res.json(dates);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Available times for a date (public)
app.get('/api/book/times', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  try {
    const salon = await db.getSalon();
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const times = await cal.getFreeTimesForDate(salon, date);
    res.json(times);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create booking (public)
app.post('/api/book', async (req, res) => {
  const { serviceId, date, time, customerName, customerPhone } = req.body;
  if (!date || !time || !customerName || !customerPhone) {
    return res.status(400).json({ error: 'Manjkajo podatki' });
  }
  // Normalize phone: strip + and spaces
  const phone = String(customerPhone).replace(/[^\d]/g, '');
  if (phone.length < 8) return res.status(400).json({ error: 'Neveljavna telefonska številka' });

  try {
    const salon = await db.getSalon();
    if (!salon) return res.status(404).json({ error: 'Salon not found' });

    // Double-check slot is still free
    const freeTimes = await cal.getFreeTimesForDate(salon, date);
    if (!freeTimes.includes(time)) {
      return res.status(409).json({ error: 'Ta termin je žal že zaseden. Izberite drugega.' });
    }

    const booking = await db.createBooking({
      customer_phone: phone,
      customer_name: customerName.trim(),
      salon_id: salon.id,
      service_id: serviceId || null,
      booking_date: date,
      booking_time: time + ':00',
      status: 'pending'
    });

    const ref6 = (booking.id || '').slice(-6);
    const fmtD = `${date.substring(8,10)}.${date.substring(5,7)}.${date.substring(0,4)}`;

    // Notify admin via WA
    const ADMIN_PHONE = process.env.ADMIN_PHONE;
    if (ADMIN_PHONE) {
      const phoneId = process.env.WA_PHONE_ID;
      const token = process.env.WA_TOKEN;
      try {
        await wa.send(phoneId, token,
          wa.adminBookingNotif(ADMIN_PHONE, customerName.trim(), phone, fmtD, time, ref6)
        );
      } catch (e) {
        try {
          await wa.send(phoneId, token,
            wa.adminBookingNotifSession(ADMIN_PHONE, customerName.trim(), phone, date, time, ref6)
          );
        } catch (e2) {
          try {
            await wa.send(phoneId, token, wa.textMsg(ADMIN_PHONE,
              `📩 *Nova WEB rezervacija*\n\n👤 ${customerName.trim()}\n📞 +${phone}\n📅 ${fmtD} ob ${time}\n🔑 Ref: *${ref6}*`
            ));
          } catch (_) {}
        }
      }
    }

    res.json({ success: true, ref: ref6, date: fmtD, time, customerName: customerName.trim() });
  } catch (err) {
    console.error('Web booking error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get customer's bookings by phone (public)
app.get('/api/book/my', async (req, res) => {
  let phone = String(req.query.phone || '').replace(/[^\d]/g, '');
  if (phone.length < 8) return res.status(400).json({ error: 'Neveljavna telefonska številka' });
  try {
    const salon = await db.getSalon();
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    const axios = require('axios');
    const BASE = process.env.SUPABASE_URL + '/rest/v1';
    const HEADERS = {
      apikey: process.env.SUPABASE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
      'Content-Type': 'application/json'
    };
    const today = new Date().toISOString().split('T')[0];
    const r = await axios.get(
      `${BASE}/sb_bookings?salon_id=eq.${salon.id}&customer_phone=eq.${phone}&booking_date=gte.${today}&order=booking_date,booking_time`,
      { headers: HEADERS }
    );
    const bookings = r.data.map(b => ({
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
    const booking = await db.getBooking(ref);
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
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { year, month } = req.query;
  try {
    const salon = await db.getSalon();
    const axios = require('axios');
    const BASE = process.env.SUPABASE_URL + '/rest/v1';
    const HEADERS = { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_KEY };
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || (new Date().getMonth() + 1);
    const from = `${y}-${String(m).padStart(2,'0')}-01`;
    const toDate = new Date(y, m, 0);
    const to = `${y}-${String(m).padStart(2,'0')}-${String(toDate.getDate()).padStart(2,'0')}`;
    const r = await axios.get(
      `${BASE}/sb_bookings?salon_id=eq.${salon.id}&booking_date=gte.${from}&booking_date=lte.${to}&order=booking_date,booking_time`,
      { headers: HEADERS }
    );
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', bot: 'SalonBot v3', version: '4.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SalonBot running on port ${PORT}`);
  startScheduler();
});
