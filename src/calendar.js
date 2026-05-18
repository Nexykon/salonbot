const db = require('./supabase');

function generateWorkingTimes(startTime, endTime, intervalMin = 30) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const times = [];
  let mins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  while (mins < endMins) {
    times.push(String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'));
    mins += intervalMin;
  }
  return times;
}

const toMins = t => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + m; };

function fitsBeforeEnd(candidateTime, candidateDuration, endTime) {
  return toMins(candidateTime) + candidateDuration <= toMins(endTime);
}

// Preveri ali se kandidatni termin (čas + trajanje) ne prekriva z obstoječimi
function isSlotFree(candidateTime, candidateDuration, bookedSlots) {
  const candStart = toMins(candidateTime);
  const candEnd = candStart + candidateDuration;
  for (const slot of bookedSlots) {
    const slotStart = toMins(slot.time);
    const slotEnd = slotStart + (slot.duration || 60);
    // Prekrivanje: obstoječi termin se začne pred koncem novega IN konča po začetku novega
    if (slotStart < candEnd && slotEnd > candStart) return false;
  }
  return true;
}

// serviceDuration = trajanje izbrane storitve v minutah (null = interval salona)
async function getFreeDates(salon, maxDays = 30, serviceDuration = null) {
  const workingDays = (salon.working_days || '1,2,3,4,5,6').split(',').map(Number);
  const startTime = (salon.working_hours_start || '08:00').substring(0, 5);
  const endTime = (salon.working_hours_end || '19:00').substring(0, 5);
  const interval = salon.booking_interval_minutes || 30;
  const duration = serviceDuration || interval;
  const allTimes = generateWorkingTimes(startTime, endTime, interval);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const freeDates = [];
  const cur = new Date(todayStr + 'T12:00:00');
  const maxDay = salon.max_advance_days || 30;

  for (let i = 0; i < Math.min(maxDays, maxDay); i++) {
    const dateStr = cur.toISOString().split('T')[0];
    const dayOfWeek = cur.getDay();

    if (workingDays.includes(dayOfWeek)) {
      const bookedSlots = await db.getBookedTimesForDate(salon.id, dateStr);
      let freeTimes = allTimes.filter(t => {
        if (dateStr === todayStr && t <= currentTime) return false;
        if (!fitsBeforeEnd(t, duration, endTime)) return false;
        return isSlotFree(t, duration, bookedSlots);
      });
      if (freeTimes.length > 0) freeDates.push({ date: dateStr, count: freeTimes.length });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return freeDates;
}

async function getFreeTimesForDate(salon, date, serviceDuration = null) {
  const startTime = (salon.working_hours_start || '08:00').substring(0, 5);
  const endTime = (salon.working_hours_end || '19:00').substring(0, 5);
  const interval = salon.booking_interval_minutes || 30;
  const duration = serviceDuration || interval;
  const allTimes = generateWorkingTimes(startTime, endTime, interval);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const bookedSlots = await db.getBookedTimesForDate(salon.id, date);
  return allTimes.filter(t => {
    if (date === todayStr && t <= currentTime) return false;
    if (!fitsBeforeEnd(t, duration, endTime)) return false;
    return isSlotFree(t, duration, bookedSlots);
  });
}

module.exports = { getFreeDates, getFreeTimesForDate, generateWorkingTimes, isSlotFree, fitsBeforeEnd, toMins };
