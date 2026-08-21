const db = require('./supabase');
const t = require('./time');
const urnik = require('./urnik');

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
  const interval = salon.booking_interval_minutes || 30;
  const duration = serviceDuration || interval;

  const todayStr = t.todayStr();
  const currentTime = t.nowTimeStr();

  const freeDates = [];
  const cur = new Date(todayStr + 'T12:00:00');
  const maxDay = salon.max_advance_days || 30;

  for (let i = 0; i < Math.min(maxDays, maxDay); i++) {
    const dateStr = cur.toISOString().split('T')[0];
    // Vsak dan ima lahko svoj odpiralni čas; null pomeni zaprto.
    const dan = urnik.zaDan(salon, cur.getDay());

    if (dan) {
      const allTimes = generateWorkingTimes(dan.od, dan.do, interval);
      const bookedSlots = await db.getBookedTimesForDate(salon.id, dateStr);
      let freeTimes = allTimes.filter(t => {
        if (dateStr === todayStr && t <= currentTime) return false;
        if (!fitsBeforeEnd(t, duration, dan.do)) return false;
        return isSlotFree(t, duration, bookedSlots);
      });
      if (freeTimes.length > 0) freeDates.push({ date: dateStr, count: freeTimes.length });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return freeDates;
}

async function getFreeTimesForDate(salon, date, serviceDuration = null) {
  const dan = urnik.zaDatum(salon, date);
  if (!dan) return [];                      // na ta dan je zaprto
  const interval = salon.booking_interval_minutes || 30;
  const duration = serviceDuration || interval;
  const allTimes = generateWorkingTimes(dan.od, dan.do, interval);

  const todayStr = t.todayStr();
  const currentTime = t.nowTimeStr();

  const bookedSlots = await db.getBookedTimesForDate(salon.id, date);
  return allTimes.filter(t => {
    if (date === todayStr && t <= currentTime) return false;
    if (!fitsBeforeEnd(t, duration, dan.do)) return false;
    return isSlotFree(t, duration, bookedSlots);
  });
}

module.exports = { getFreeDates, getFreeTimesForDate, generateWorkingTimes, isSlotFree, fitsBeforeEnd, toMins };
