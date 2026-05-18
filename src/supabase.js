const axios = require('axios');

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

async function updateSalonStripe(salonId, stripeCustomerId, stripeSubId, status, plan) {
  const r = await axios.patch(
    `${BASE}/sb_salons?id=eq.${salonId}`,
    { stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubId, subscription_status: status, subscription_plan: plan },
    { headers: HEADERS }
  );
  return r.data[0];
}

async function updateSubscriptionStatus(stripeSubId, status) {
  await axios.patch(
    `${BASE}/sb_salons?stripe_subscription_id=eq.${stripeSubId}`,
    { subscription_status: status },
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

async function getAvailableSlots(salonId) {
  const today = new Date().toISOString().split('T')[0];
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

async function markSlotBooked(slotId) {
  await axios.patch(
    `${BASE}/sb_available_slots?id=eq.${slotId}`,
    { is_booked: true },
    { headers: { ...HEADERS, Prefer: 'return=minimal' } }
  );
}

async function getBooking(ref) {
  // ref = last 6 chars of booking ID
  const r = await axios.get(`${BASE}/sb_bookings?id=like.*${ref}&order=created_at.desc&limit=1`, { headers: HEADERS });
  return r.data[0];
}

async function updateBookingStatus(id, status) {
  const r = await axios.patch(
    `${BASE}/sb_bookings?id=eq.${id}`,
    { status },
    { headers: HEADERS }
  );
  return r.data[0];
}

async function getTodayBookings(salonId) {
  const today = new Date().toISOString().split('T')[0];
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
  if (data.service_name) {
    const svc = services.find(s => s.name.toLowerCase().includes(data.service_name.toLowerCase()));
    if (svc) serviceId = svc.id;
  }
  const booking = {
    salon_id: salonId,
    customer_name: data.customer_name,
    customer_phone: data.customer_phone || 'manual',
    booking_date: data.date,
    booking_time: data.time.length === 5 ? data.time + ':00' : data.time,
    status: 'confirmed',
    notes: 'Ročno dodano'
  };
  if (serviceId) booking.service_id = serviceId;
  const r = await axios.post(`${BASE}/sb_bookings`, booking, { headers: HEADERS });
  return r.data[0];
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

async function updateService(salonId, serviceName, price, durationMinutes) {
  const r = await axios.get(
    `${BASE}/sb_services?salon_id=eq.${salonId}&name=ilike.*${encodeURIComponent(serviceName)}*&limit=1`,
    { headers: HEADERS }
  );
  if (!r.data.length) return null;
  const service = r.data[0];
  const updates = {};
  if (price !== undefined) updates.price = Math.round(price);
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
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${date}&status=neq.cancelled&select=booking_time`,
    { headers: HEADERS }
  );
  return r.data.map(b => (b.booking_time || '').substring(0, 5));
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

module.exports = {
  getSalon, getServices, getAvailableSlots, createBooking, markSlotBooked,
  getBooking, updateBookingStatus, getTodayBookings,
  getBookingsByDate, getSlotsByDate, addManualBooking, getBookingByName,
  markSlotFree, updateService, addSlot, removeSlot, getBookedTimesForDate, getPendingBookings, getDailyStats,
  getKnowledge, addKnowledge, deleteKnowledge,
  getSalonByPhoneId, getAllSalons, createSalon, updateSalonStripe, updateSubscriptionStatus, logInvoice,
  logError, getRecentErrors, clearErrors,
  getSalonByAdminPhone, getSalonByToken, updateSalonSettings
};
