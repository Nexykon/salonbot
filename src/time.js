// ─── Časovni pas salona ──────────────────────────────────────
// Strežnik (Railway) teče v UTC, saloni pa so v Sloveniji (UTC+1/+2).
// Vse "danes / zdaj / jutri" izračune delamo v Europe/Ljubljana,
// sicer so termini in opomniki zamaknjeni do 2 uri.

const TZ = process.env.SALON_TZ || 'Europe/Ljubljana';

// YYYY-MM-DD v lokalnem času (sv-SE locale vrne ISO format)
function todayStr(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d);
}

// HH:MM v lokalnem času
function nowTimeStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
}

// HH:MM:SS v lokalnem času
function nowTimeHMS(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d);
}

// Dan v tednu za lokalni čas (0 = nedelja, 1 = ponedeljek, ...)
function todayDow(d = new Date()) {
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d)];
}

// Premik datuma (YYYY-MM-DD) za N dni — brez timezone pasti (računamo v UTC opoldne)
function dateOffsetStr(baseYmd, days) {
  const d = new Date(baseYmd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

module.exports = { TZ, todayStr, nowTimeStr, nowTimeHMS, todayDow, dateOffsetStr };
