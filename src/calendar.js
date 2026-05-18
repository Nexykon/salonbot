const db = require('./supabase');

function generateWorkingTimes(startTime, endTime, intervalMin = 60) {
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

async function getFreeDates(salon, maxDays = 30) {
  const workingDays = (salon.working_days || '1,2,3,4,5,6').split(',').map(Number);
  const startTime = (salon.working_hours_start || '08:00').substring(0, 5);
  const endTime = (salon.working_hours_end || '19:00').substring(0, 5);
  const allTimes = generateWorkingTimes(startTime, endTime, 60);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const freeDates = [];
  const cur = new Date(todayStr + 'T12:00:00');

  for (let i = 0; i < maxDays; i++) {
    const dateStr = cur.toISOString().split('T')[0];
    const dayOfWeek = cur.getDay();

    if (workingDays.includes(dayOfWeek)) {
      const bookedTimes = await db.getBookedTimesForDate(salon.id, dateStr);
      let freeTimes = allTimes.filter(t => !bookedTimes.includes(t));
      if (dateStr === todayStr) freeTimes = freeTimes.filter(t => t > currentTime);
      if (freeTimes.length > 0) freeDates.push({ date: dateStr, count: freeTimes.length });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return freeDates;
}

async function getFreeTimesForDate(salon, date) {
  const startTime = (salon.working_hours_start || '08:00').substring(0, 5);
  const endTime = (salon.working_hours_end || '19:00').substring(0, 5);
  const allTimes = generateWorkingTimes(startTime, endTime, 60);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const bookedTimes = await db.getBookedTimesForDate(salon.id, date);
  let freeTimes = allTimes.filter(t => !bookedTimes.includes(t));
  if (date === todayStr) freeTimes = freeTimes.filter(t => t > currentTime);
  return freeTimes;
}

module.exports = { getFreeDates, getFreeTimesForDate, generateWorkingTimes };
