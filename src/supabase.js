const axios = require('axios');
const { slugify } = require('./presets');
const t = require('./time');

const BASE = process.env.SUPABASE_URL + '/rest/v1';
const HEADERS = {
  apikey: process.env.SUPABASE_KEY,
  Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
};

async function getSalon() {
  const r = await axios.get(`${BASE}/sb_salons?limit=1`, { headers: HEADERS });
  return r.data[0];
}

async function getSalonById(salonId) {
  const r = await axios.get(`${BASE}/sb_salons?id=eq.${salonId}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function getSalonBySlug(slug) {
  const r = await axios.get(`${BASE}/sb_salons?business_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function resolveSalon(ref) {
  if (!ref) return getSalon();
  const clean = String(ref).trim();
  if (/^[0-9a-f-]{36}$/i.test(clean)) return getSalonById(clean);
  return getSalonBySlug(slugify(clean));
}

// Multi-salon: najdi salon po WhatsApp phone number ID
async function getSalonByPhoneId(phoneNumberId) {
  const r = await axios.get(
    `${BASE}/sb_salons?whatsapp_phone_number_id=eq.${phoneNumberId}&limit=1`,
    { headers: HEADERS }
  );
  return r.data[0] || null;
}

async function getAllSalons() {
  const r = await axios.get(`${BASE}/sb_salons?order=created_at`, { headers: HEADERS });
  return r.data;
}

async function createSalon(data) {
  const r = await axios.post(`${BASE}/sb_salons`, data, { headers: HEADERS });
  return r.data[0];
}

async function createService(salonId, service) {
  const r = await axios.post(`${BASE}/sb_services`, {
    salon_id: salonId,
    name: service.name,
    price: Number(service.price || 0),
    duration_minutes: Math.round(Number(service.duration_minutes || 0)),
    description: service.description || '',
    category: service.category || 'Ostalo',
    sort_order: service.sort_order || 0,
    is_active: service.is_active !== false
  }, { headers: HEADERS });
  return r.data[0];
}

async function createServicesFromPreset(salonId, services) {
  const created = [];
  for (const service of services || []) {
    created.push(await createService(salonId, service));
  }
  return created;
}

async function updateSalonStripe(salonId, stripeCustomerId, stripeSubId, status, plan) {
  const r = await axios.patch(
    `${BASE}/sb_salons?id=eq.${salonId}`,
    { stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubId, subscription_status: status, subscription_plan: plan },
    { headers: HEADERS }
  );
  return r.data[0];
}

async function getSalonByStripeSubId(stripeSubId) {
  const r = await axios.get(`${BASE}/sb_salons?stripe_subscription_id=eq.${stripeSubId}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function updateSubscriptionStatus(stripeSubId, status, plan = null) {
  const body = { subscription_status: status };
  if (plan) body.subscription_plan = plan;
  await axios.patch(
    `${BASE}/sb_salons?stripe_subscription_id=eq.${stripeSubId}`,
    body,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function logInvoice(salonId, stripeInvoiceId, amountEur, status) {
  await axios.post(`${BASE}/sb_invoices`, {
    salon_id: salonId,
    stripe_invoice_id: stripeInvoiceId,
    amount_eur: amountEur,
    status,
    paid_at: status === 'paid' ? new Date().toISOString() : null
  }, { headers: { ...HEADERS, Prefer: 'return=minimal' } });
}

async function getServices(salonId) {
  const r = await axios.get(`${BASE}/sb_services?salon_id=eq.${salonId}&is_active=eq.true&order=sort_order`, { headers: HEADERS });
  return r.data;
}

async function getServiceById(salonId, serviceId) {
  if (!serviceId) return null;
  const r = await axios.get(`${BASE}/sb_services?salon_id=eq.${salonId}&id=eq.${serviceId}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function getAvailableSlots(salonId) {
  const today = t.todayStr();
  const r = await axios.get(
    `${BASE}/sb_available_slots?salon_id=eq.${salonId}&is_booked=eq.false&slot_date=gte.${today}&order=slot_date,slot_time`,
    { headers: HEADERS }
  );
  return r.data;
}

async function createBooking(data) {
  const r = await axios.post(`${BASE}/sb_bookings`, data, { headers: HEADERS });
  return r.data[0];
}

async function createBookingIfFree(data) {
  const booked = await getBookedTimesForDate(data.salon_id, data.booking_date);
  const start = String(data.booking_time || '').substring(0, 5);
  const duration = data.duration_minutes || 60;
  const toMins = t => {
    const [h, m] = String(t || '00:00').substring(0, 5).split(':').map(Number);
    return h * 60 + m;
  };
  const newStart = toMins(start);
  const newEnd = newStart + duration;
  const overlaps = booked.some(slot => {
    const slotStart = toMins(slot.time);
    const slotEnd = slotStart + (slot.duration || 60);
    return slotStart < newEnd && slotEnd > newStart;
  });
  if (overlaps) {
    const err = new Error('Termin je ze zaseden.');
    err.code = 'SLOT_TAKEN';
    throw err;
  }
  return createBooking(data);
}

async function markSlotBooked(slotId) {
  await axios.patch(
    `${BASE}/sb_available_slots?id=eq.${slotId}`,
    { is_booked: true },
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function getBooking(ref) {
  // ref = last 6 chars of booking ID — cast uuid to text for LIKE
  const uuidFull = /^[0-9a-f-]{36}$/.test(ref);
  const filter = uuidFull ? `id=eq.${ref}` : `id=like.*${ref}`;
  const r = await axios.get(`${BASE}/sb_bookings?${filter}&order=created_at.desc&limit=1`, {
    headers: { ...HEADERS, 'Accept-Profile': 'public' }
  }).catch(async () => {
    // fallback: fetch all and filter in JS
    const all = await axios.get(`${BASE}/sb_bookings?order=created_at.desc&limit=200`, { headers: HEADERS });
    return { data: all.data.filter(b => (b.id || '').toLowerCase().endsWith(String(ref).toLowerCase())) };
  });
  return r.data[0];
}

async function getBookingById(id) {
  const r = await axios.get(`${BASE}/sb_bookings?id=eq.${id}&limit=1`, { headers: HEADERS });
  return r.data[0];
}

async function getBookingForSalon(salonId, ref) {
  // UUID type doesn't support LIKE in PostgREST — filter in JS
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&order=created_at.desc&limit=500`,
    { headers: HEADERS }
  );
  return r.data.find(b => (b.id || '').toLowerCase().endsWith(String(ref).toLowerCase())) || null;
}

// Število naročil lokala v tekočem mesecu (za fair-use in statistiko)
async function getMonthlyOrderCount(salonId) {
  const monthStart = t.todayStr().slice(0, 8) + '01';
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&created_at=gte.${monthStart}T00:00:00&select=id&limit=1`,
    { headers: { ...HEADERS, Prefer: 'count=exact' } }
  );
  return parseInt(String(r.headers['content-range'] || '').split('/')[1]) || 0;
}

// Artikli zadnjega (nepreklicanega) naročila stranke — za "enako kot zadnjič"
async function getLastOrderItemsByPhone(salonId, phone) {
  const b = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&customer_phone=eq.${phone}&status=neq.cancelled&order=created_at.desc&limit=1`,
    { headers: HEADERS }
  );
  const bk = b.data[0];
  if (!bk) return [];
  const r = await axios.get(`${BASE}/sb_order_items?booking_id=eq.${bk.id}`, { headers: HEADERS });
  return r.data || [];
}

// Javno objavljeni lokali — za stran /restavracije
async function getPublicRestaurants() {
  const cols = 'id,name,logo_url,address,delivery_area,pickup_address,working_hours_start,working_hours_end,bot_phone_display,business_type,business_slug,allow_delivery,allow_pickup';
  const r = await axios.get(
    `${BASE}/sb_salons?listed_public=eq.true&subscription_status=neq.inactive&select=${cols}&order=name`,
    { headers: HEADERS }
  );
  return (r.data || []).filter(s => s.is_active !== false);
}

// Naloži logotip v Storage (bucket "logos") in vrni javni URL
async function uploadLogo(salonId, buffer, contentType, ext) {
  const path = `${salonId}-${Date.now()}.${ext}`;
  await axios.post(
    `${process.env.SUPABASE_URL}/storage/v1/object/logos/${path}`,
    buffer,
    {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    }
  );
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/logos/${path}`;
}

// Naloži zvočno datoteko v Storage (bucket "sounds") in vrni javni URL
async function uploadSound(salonId, buffer, contentType, ext) {
  const path = `${salonId}-${Date.now()}.${ext}`;
  await axios.post(
    `${process.env.SUPABASE_URL}/storage/v1/object/sounds/${path}`,
    buffer,
    {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_KEY,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    }
  );
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/sounds/${path}`;
}

// Izbriši zvočno datoteko iz Storagea po javnem URL-ju
async function deleteSound(url) {
  const marker = '/storage/v1/object/public/sounds/';
  const idx = String(url || '').indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  await axios.delete(
    `${process.env.SUPABASE_URL}/storage/v1/object/sounds/${path}`,
    { headers: { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_KEY } }
  ).catch(function(){});
}

// Ime + datum zadnjega naročila stranke — za prepoznavo vračajoče se stranke
async function getLastCustomerByPhone(salonId, phone) {
  try {
    const r = await axios.get(
      `${BASE}/sb_bookings?salon_id=eq.${salonId}&customer_phone=eq.${phone}&status=neq.cancelled&order=created_at.desc&limit=1&select=customer_name,created_at`,
      { headers: HEADERS }
    );
    const bk = r.data[0];
    if (!bk || !bk.customer_name) return null;
    const nm = String(bk.customer_name).trim();
    // preskoči telefonske "imena" (npr. shranjeno kot številka)
    if (!nm || /^\+?\d[\d\s]{5,}$/.test(nm)) return null;
    return { name: nm, lastAt: bk.created_at || null };
  } catch (_e) { return null; }
}

// Zadnje odprto (pending/confirmed) današnje naročilo stranke — za preklic
async function getActiveBookingByPhone(salonId, phone) {
  const today = t.todayStr();
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&customer_phone=eq.${phone}&booking_date=eq.${today}&status=in.(pending,confirmed)&order=created_at.desc&limit=1`,
    { headers: HEADERS }
  );
  return r.data[0] || null;
}

async function updateBookingStatus(id, status) {
  const r = await axios.patch(
    `${BASE}/sb_bookings?id=eq.${id}`,
    { status },
    { headers: HEADERS }
  );
  return r.data[0];
}

async function updateBookingNotes(id, notes) {
  const r = await axios.patch(
    `${BASE}/sb_bookings?id=eq.${id}`,
    { notes },
    { headers: HEADERS }
  );
  return r.data[0];
}

// Poišče email stranke iz prejšnjih rezervacij
async function getCustomerEmailByPhone(salonId, phone) {
  try {
    const r = await axios.get(
      `${BASE}/sb_bookings?salon_id=eq.${salonId}&customer_phone=eq.${phone}&notes=like.*customer_email*&order=created_at.desc&limit=1`,
      { headers: HEADERS }
    );
    const booking = r.data[0];
    if (!booking) return null;
    return (booking.notes || '').match(/customer_email:([^\s,]+)/)?.[1] || null;
  } catch (e) {
    return null;
  }
}

async function getTodayBookings(salonId) {
  const today = t.todayStr();
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&created_at=gte.${today}T00:00:00&order=created_at`,
    { headers: HEADERS }
  );
  return r.data;
}

// ─── AI Admin functions ──────────────────────────────────────

async function getBookingsByDate(salonId, date) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${date}&order=booking_time`,
    { headers: HEADERS }
  );
  return r.data;
}

async function getBookingsForRange(salonId, from, to) {
  let url = `${BASE}/sb_bookings?booking_date=gte.${from}&booking_date=lte.${to}&status=neq.cancelled&order=booking_date,booking_time`;
  if (salonId) url = `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=gte.${from}&booking_date=lte.${to}&status=neq.cancelled&order=booking_date,booking_time`;
  const r = await axios.get(url, { headers: HEADERS });
  return r.data;
}

async function getBookingsByPhone(salonId, phone, today) {
  let url = `${BASE}/sb_bookings?salon_id=eq.${salonId}&customer_phone=eq.${phone}&order=booking_date,booking_time`;
  if (today) url += `&booking_date=gte.${today}`;
  const r = await axios.get(url, { headers: HEADERS });
  return r.data;
}

async function getSlotsByDate(salonId, date) {
  const r = await axios.get(
    `${BASE}/sb_available_slots?salon_id=eq.${salonId}&slot_date=eq.${date}&order=slot_time`,
    { headers: HEADERS }
  );
  return r.data;
}

async function addManualBooking(salonId, data) {
  const services = await getServices(salonId);
  let serviceId = null;
  let durationMinutes = data.duration_minutes || null;
  if (data.service_name) {
    const svc = services.find(s => s.name.toLowerCase().includes(data.service_name.toLowerCase()));
    if (svc) {
      serviceId = svc.id;
      durationMinutes = svc.duration_minutes || durationMinutes;
    }
  }
  const booking = {
    salon_id: salonId,
    customer_name: data.customer_name,
    customer_phone: data.customer_phone || 'manual',
    booking_date: data.date,
    booking_time: data.time.length === 5 ? data.time + ':00' : data.time,
    duration_minutes: durationMinutes || 60,
    status: 'confirmed',
    notes: 'Ročno dodano'
  };
  if (serviceId) booking.service_id = serviceId;
  return createBookingIfFree(booking);
}

async function getBookingByName(salonId, name, date) {
  let url = `${BASE}/sb_bookings?salon_id=eq.${salonId}&customer_name=ilike.*${name}*&order=created_at.desc&limit=1`;
  if (date) url += `&booking_date=eq.${date}`;
  const r = await axios.get(url, { headers: HEADERS });
  return r.data[0];
}

async function markSlotFree(slotId) {
  await axios.patch(
    `${BASE}/sb_available_slots?id=eq.${slotId}`,
    { is_booked: false },
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function updateServiceById(serviceId, price, durationMinutes, name, sortOrder) {
  const updates = {};
  if (name !== undefined && name !== null) updates.name = String(name).trim();
  if (price !== undefined && price !== null) updates.price = Number(price);
  if (durationMinutes !== undefined && durationMinutes !== null) updates.duration_minutes = Math.round(durationMinutes);
  if (sortOrder !== undefined && sortOrder !== null) updates.sort_order = Math.round(sortOrder);
  if (!Object.keys(updates).length) return null;
  await axios.patch(
    `${BASE}/sb_services?id=eq.${serviceId}`,
    updates,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
  return updates;
}

async function setServiceActive(serviceId, isActive) {
  await axios.patch(
    `${BASE}/sb_services?id=eq.${serviceId}`,
    { is_active: Boolean(isActive) },
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function updateService(salonId, serviceName, price, durationMinutes) {
  const r = await axios.get(
    `${BASE}/sb_services?salon_id=eq.${salonId}&name=ilike.*${encodeURIComponent(serviceName)}*&limit=1`,
    { headers: HEADERS }
  );
  if (!r.data.length) return null;
  const service = r.data[0];
  const updates = {};
  if (price !== undefined) updates.price = Number(price);
  if (durationMinutes !== undefined) updates.duration_minutes = Math.round(durationMinutes);
  await axios.patch(
    `${BASE}/sb_services?id=eq.${service.id}`,
    updates,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
  return { ...service, ...updates };
}

async function addSlot(salonId, date, time) {
  const slotTime = time.length === 5 ? time + ':00' : time;
  const r = await axios.post(`${BASE}/sb_available_slots`, {
    salon_id: salonId,
    slot_date: date,
    slot_time: slotTime,
    is_booked: false
  }, { headers: HEADERS });
  return r.data[0];
}

async function removeSlot(salonId, date, time) {
  const slotTime = time.length === 5 ? time + ':00' : time;
  await axios.delete(
    `${BASE}/sb_available_slots?salon_id=eq.${salonId}&slot_date=eq.${date}&slot_time=eq.${slotTime}&is_booked=eq.false`,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function getPendingBookings(salonId) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&status=eq.pending&order=created_at.asc`,
    { headers: HEADERS }
  );
  return r.data;
}

// ─── Knowledge Base ──────────────────────────────────────────

async function getKnowledge(salonId) {
  const r = await axios.get(
    `${BASE}/sb_knowledge?salon_id=eq.${salonId}&order=created_at.asc`,
    { headers: HEADERS }
  );
  return r.data;
}

async function addKnowledge(salonId, content) {
  const r = await axios.post(`${BASE}/sb_knowledge`, {
    salon_id: salonId,
    content: content.trim()
  }, { headers: HEADERS });
  return r.data[0];
}

async function deleteKnowledge(salonId, keyword) {
  await axios.delete(
    `${BASE}/sb_knowledge?salon_id=eq.${salonId}&content=ilike.*${encodeURIComponent(keyword)}*`,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function getDailyStats(salonId, date) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${date}&order=booking_time`,
    { headers: HEADERS }
  );
  const bookings = r.data;
  return {
    total: bookings.length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    pending: bookings.filter(b => b.status === 'pending').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
    list: bookings.filter(b => b.status !== 'cancelled')
  };
}

async function getBookedTimesForDate(salonId, date) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${date}&status=neq.cancelled&select=booking_time,duration_minutes`,
    { headers: HEADERS }
  );
  // Vrne [{time, duration}] za overlap preverjanje
  return r.data.map(b => ({
    time: (b.booking_time || '').substring(0, 5),
    duration: b.duration_minutes || 60  // default 60 min če ni nastavljeno
  }));
}

async function logError(salonId, type, message, details, customerPhone) {
  try {
    await axios.post(`${BASE}/sb_errors`, {
      salon_id: salonId || null,
      type,
      message: String(message).substring(0, 500),
      details: details ? String(details).substring(0, 1000) : null,
      customer_phone: customerPhone || null
    }, { headers: { ...HEADERS, Prefer: 'return=minimal' } });
  } catch (e) {
    console.error('logError failed:', e.message);
  }
}

async function getRecentErrors(limit = 50) {
  const r = await axios.get(
    `${BASE}/sb_errors?order=created_at.desc&limit=${limit}`,
    { headers: HEADERS }
  );
  return r.data;
}

async function getRecentLogs(limit = 50) {
  const r = await axios.get(
    `${BASE}/sb_logs?select=*,sb_salons(name)&order=created_at.desc&limit=${limit}`,
    { headers: HEADERS }
  );
  return r.data;
}

async function clearErrors() {
  await axios.delete(
    `${BASE}/sb_errors?created_at=lt.${new Date().toISOString()}`,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function getSalonByAdminPhone(phone) {
  const clean = String(phone).replace(/[^\d]/g, '');
  const r = await axios.get(`${BASE}/sb_salons?admin_phone=eq.${clean}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function getSalonsByOwnerEmail(email) {
  const clean = String(email || '').trim();
  if (!clean) return [];
  const r = await axios.get(`${BASE}/sb_salons?owner_email=ilike.${encodeURIComponent(clean)}&order=created_at`, { headers: HEADERS });
  return r.data || [];
}

async function getSalonByOwnerEmail(email) {
  const clean = String(email || '').trim();
  if (!clean) return null;
  const r = await axios.get(`${BASE}/sb_salons?owner_email=ilike.${encodeURIComponent(clean)}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function getSalonByToken(token) {
  const r = await axios.get(`${BASE}/sb_salons?salon_token=eq.${token}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function updateSalonSettings(salonId, settings) {
  await axios.patch(
    `${BASE}/sb_salons?id=eq.${salonId}`,
    settings,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function getMasterAdminByEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  const r = await axios.get(`${BASE}/sb_master_admins?email=eq.${encodeURIComponent(clean)}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function getMasterAdminByResetTokenHash(tokenHash) {
  const clean = String(tokenHash || '').trim();
  if (!clean) return null;
  const r = await axios.get(`${BASE}/sb_master_admins?reset_token_hash=eq.${encodeURIComponent(clean)}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
}

async function updateMasterAdmin(adminId, updates) {
  await axios.patch(
    `${BASE}/sb_master_admins?id=eq.${adminId}`,
    updates,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}



async function deleteServiceById(serviceId) {
  await axios.delete(`${BASE}/sb_services?id=eq.${serviceId}`, { headers: HEADERS });
}

// ─── Scheduler helpers ────────────────────────────────────

// Posodobi polja na booking-u
async function updateBookingFields(id, fields) {
  await axios.patch(
    `${BASE}/sb_bookings?id=eq.${id}`,
    fields,
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

// Termini za jutri kjer reminder_sent = false, created_at > 7 dni nazaj
async function getBookingsForReminder(salonId, tomorrow) {
  const sevenDaysAgo = new Date(tomorrow + 'T00:00:00');
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().split('T')[0];
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${tomorrow}&status=eq.confirmed&reminder_sent=eq.false&created_at=lte.${cutoff}T23:59:59Z`,
    { headers: HEADERS }
  );
  return r.data;
}

// Termini ki so bili danes (za recenzijo) kjer review_sent = false
async function getBookingsForReview(salonId, date) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${date}&status=eq.confirmed&review_sent=eq.false`,
    { headers: HEADERS }
  );
  return r.data;
}

// Stranke ki zadnjič so bile pred točno 8 tedni (56 dni)
async function getBookingsForReactivation(salonId, date56ago) {
  // Poiščemo stranke kjer je zadnji confirmed booking točno na ta datum
  // in od takrat nimajo nobene nove rezervacije
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${date56ago}&status=eq.confirmed`,
    { headers: HEADERS }
  );
  return r.data;
}


async function deleteSalon(salonId) {
  // Delete related records first
  await axios.delete(`${BASE}/sb_bookings?salon_id=eq.${salonId}`, { headers: HEADERS }).catch(() => {});
  await axios.delete(`${BASE}/sb_services?salon_id=eq.${salonId}`, { headers: HEADERS }).catch(() => {});
  await axios.delete(`${BASE}/sb_knowledge?salon_id=eq.${salonId}`, { headers: HEADERS }).catch(() => {});
  await axios.delete(`${BASE}/sb_errors?salon_id=eq.${salonId}`, { headers: HEADERS }).catch(() => {});
  await axios.delete(`${BASE}/sb_order_items?salon_id=eq.${salonId}`, { headers: HEADERS }).catch(() => {});
  await axios.delete(`${BASE}/sb_invoices?salon_id=eq.${salonId}`, { headers: HEADERS }).catch(() => {});
  const r = await axios.delete(`${BASE}/sb_salons?id=eq.${salonId}`, { headers: HEADERS });
  return r.data;
}


async function createOrderItems(bookingId, salonId, cartItems) {
  if (!cartItems || !cartItems.length) return;
  const rows = cartItems.map(item => ({
    booking_id: bookingId,
    salon_id: salonId,
    service_id: item.id || null,
    name: item.name,
    category: item.category || 'Ostalo',
    price: Number(item.price || 0),
    quantity: item.quantity || 1
  }));
  await axios.post(`${BASE}/sb_order_items`, rows, { headers: HEADERS });
}

async function getOrderItems(bookingId) {
  const r = await axios.get(`${BASE}/sb_order_items?booking_id=eq.${bookingId}`, { headers: HEADERS });
  return r.data;
}

async function getOrderItemsBysalon(salonId, since) {
  let url = `${BASE}/sb_order_items?salon_id=eq.${salonId}&order=created_at.desc`;
  if (since) url += `&created_at=gte.${since}`;
  const r = await axios.get(url, { headers: HEADERS });
  return r.data;
}


async function logAiMiss(salonId, phone, message, stage, context) {
  try {
    await axios.post(`${BASE}/ai_misses`, {
      salon_id: salonId, phone,
      message: String(message || '').slice(0, 300),
      stage: String(stage || ''),
      context: String(context || '').slice(0, 300)
    }, { headers: { ...HEADERS, Prefer: 'return=minimal' } });
  } catch (e) { /* dnevnik ne sme motiti pogovora */ }
}

async function getAiMissesSince(sinceIso) {
  try {
    const r = await axios.get(
      `${BASE}/ai_misses?created_at=gte.${encodeURIComponent(sinceIso)}&select=salon_id,phone,message,stage,context,created_at&order=created_at.asc&limit=200`,
      { headers: HEADERS }
    );
    return r.data || [];
  } catch (e) { return []; }
}

async function saveAiSession(salonId, phone, data) {
  try {
    await axios.post(`${BASE}/ai_sessions?on_conflict=salon_id,phone`, { salon_id: salonId, phone, data, updated_at: new Date().toISOString() }, {
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
  } catch (e) { /* tiho — seja je samo optimizacija */ }
}

async function loadAiSession(salonId, phone) {
  try {
    const r = await axios.get(`${BASE}/ai_sessions?salon_id=eq.${encodeURIComponent(salonId)}&phone=eq.${encodeURIComponent(phone)}&select=data,updated_at&order=updated_at.desc&limit=1`, { headers: HEADERS });
    const row = r.data?.[0];
    if (!row) return null;
    // Seja je stara > 24h → ignoriraj
    if (row.updated_at && Date.now() - new Date(row.updated_at).getTime() > 86400000) return null;
    return row.data || null;
  } catch (e) { return null; }
}

async function clearAiSession(salonId, phone) {
  try {
    await axios.delete(`${BASE}/ai_sessions?salon_id=eq.${encodeURIComponent(salonId)}&phone=eq.${encodeURIComponent(phone)}`, { headers: HEADERS });
  } catch (e) {}
}

module.exports = {
  getSalon, getSalonById, deleteSalon, getSalonBySlug, resolveSalon, getSalonByPhoneId,
  getAllSalons, createSalon, createService, createServicesFromPreset,
  updateSalonStripe, updateSubscriptionStatus, logInvoice,
  getServices, getServiceById, getAvailableSlots,
  createBooking, createBookingIfFree, markSlotBooked,
  createOrderItems, getOrderItems, getOrderItemsBysalon,
  getPublicRestaurants, uploadLogo, uploadSound, deleteSound,
  getBooking, getBookingById, getBookingForSalon, getActiveBookingByPhone, getLastOrderItemsByPhone, getLastCustomerByPhone, getMonthlyOrderCount, updateBookingStatus, updateBookingNotes, getCustomerEmailByPhone,
  getTodayBookings, getBookingsByDate, getBookingsForRange, getBookingsByPhone,
  getSlotsByDate, addManualBooking, getBookingByName, markSlotFree,
  updateServiceById, setServiceActive, updateService, deleteServiceById,
  addSlot, removeSlot, getPendingBookings,
  getKnowledge, addKnowledge, deleteKnowledge,
  getDailyStats, getBookedTimesForDate,
  updateBookingFields, getBookingsForReminder, getBookingsForReview, getBookingsForReactivation,
  getSalonByStripeSubId,
  logError, getRecentErrors, getRecentLogs, clearErrors,
  getSalonByAdminPhone, getSalonByOwnerEmail, getSalonsByOwnerEmail, getSalonByToken,
  updateSalonSettings,
  getMasterAdminByEmail, getMasterAdminByResetTokenHash, updateMasterAdmin,
  saveAiSession, loadAiSession, clearAiSession,
  logAiMiss, getAiMissesSince
};
