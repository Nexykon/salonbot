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

async function getBookedTimesForDate(salonId, date) {
  const r = await axios.get(
    `${BASE}/sb_bookings?salon_id=eq.${salonId}&booking_date=eq.${date}&status=neq.cancelled&select=booking_time`,
    { headers: HEADERS }
  );
  return r.data.map(b => (b.booking_time || '').substring(0, 5));
}

module.exports = {
  getSalon, getServices, getAvailableSlots, createBooking, markSlotBooked,
  getBooking, updateBookingStatus, getTodayBookings,
  getBookingsByDate, getSlotsByDate, addManualBooking, getBookingByName,
  markSlotFree, updateService, addSlot, removeSlot, getBookedTimesForDate
};
