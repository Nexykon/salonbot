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

module.exports = { getSalon, getServices, getAvailableSlots, createBooking, markSlotBooked, getBooking, updateBookingStatus, getTodayBookings };
