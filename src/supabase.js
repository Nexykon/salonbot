const axios = require('axios');
const { slugify } = require('./presets');

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
    price: Math.round(Number(service.price || 0)),
    duration_minutes: Math.round(Number(service.duration_minutes || 60)),
    description: service.description || '',
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

async function getServiceById(salonId, serviceId) {
  if (!serviceId) return null;
  const r = await axios.get(`${BASE}/sb_services?salon_id=eq.${salonId}&id=eq.${serviceId}&limit=1`, { headers: HEADERS });
  return r.data[0] || null;
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
  // ref = last 6 chars of booking ID
  const r = await axios.get(`${BASE}/sb_bookings?id=like.*${ref}&order=created_at.desc&limit=1`, { headers: HEADERS });
  return r.data[0];
}

async function getBookingById(id) {
  const r = await axios.get(`${BASE}/sb_bookings?id=eq.${id}&limit=1`, { headers: HEADERS });
  return r.data[0];
}

async function getBookingForSalon(salonId, ref) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&id=like.*${ref}&order=created_at.desc&limit=1`,
    { headers: HEADERS }
  );
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

async function getBookingsForRange(salonId, from, to) {
  let url = `${BASE}/sb_bookings?booking_date=gte.${from}&booking_date=lte.${to}&order=booking_date,booking_time`;
  if (salonId) url = `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=gte.${from}&booking_date=lte.${to}&order=booking_date,booking_time`;
  const r = await axios.get(url, { headers: HEADERS });
  return r.data;
}

async function getBookingsByPhone(salonId, phone, today) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&customer_phone=eq.${phone}&booking_date=gte.${today}&order=booking_date,booking_time`,
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

async function updateServiceById(serviceId, price, durationMinutes, name) {
  const updates = {};
  if (name !== undefined && name !== null) updates.name = String(name).trim();
  if (price !== undefined && price !== null) updates.price = Math.round(price);
  if (durationMinutes !== undefined && durationMinutes !== null) updates.duration_minutes = Math.round(durationMinutes);
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

module.exports = {
  getSalon, getSalonById, getSalonBySlug, resolveSalon, getSalonByPhoneId,
  getAllSalons, createSalon, createService, createServicesFromPreset,
  updateSalonStripe, updateSubscriptionStatus, logInvoice,
  getServices, getServiceById, getAvailableSlots,
  createBooking, createBookingIfFree, markSlotBooked,
  getBooking, getBookingById, getBookingForSalon, updateBookingStatus, updateBookingNotes, getCustomerEmailByPhone,
  getTodayBookings, getBookingsByDate, getBookingsForRange, getBookingsByPhone,
  getSlotsByDate, addManualBooking, getBookingByName, markSlotFree,
  updateServiceById, setServiceActive, updateService, deleteServiceById,
  addSlot, removeSlot, getPendingBookings,
  getKnowledge, addKnowledge, deleteKnowledge,
  getDailyStats, getBookedTimesForDate,
  logError, getRecentErrors, getRecentLogs, clearErrors,
  getSalonByAdminPhone, getSalonByOwnerEmail, getSalonByToken,
  updateSalonSettings,
  getMasterAdminByEmail, getMasterAdminByResetTokenHash, updateMasterAdmin
};
