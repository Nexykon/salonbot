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

/*
  Konec lokalnega dneva (YYYY-MM-DD) kot trenutek v UTC.

  Potrebno povsod, kjer se datum iz urnika primerja s časovnim žigom iz baze:
  created_at je UTC, "do konca tega dne" pa je mišljeno po slovenskem času.
  Poleti sta to dve uri razlike — rezervacija, narejena ob 1:30 ponoči, je v
  UTC še prejšnji dan in bi ob naivni primerjavi padla na napačno stran meje.

  Odmik se vzame za tisti trenutek, ne nasploh, zato poletni in zimski čas
  nista posebna primera. Prehod na poletni čas je ob 2. uri zjutraj, torej
  nikoli ob 23:59, ki jo računamo tu.
*/
function konecDnevaUtc(ymd) {
  const priblizek = new Date(ymd + 'T23:59:59Z');
  const deli = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(priblizek)
    .filter((d) => d.type !== 'literal')
    .reduce((m, d) => { m[d.type] = Number(d.value); return m; }, {});
  const lokalnoKotUtc = Date.UTC(deli.year, deli.month - 1, deli.day, deli.hour % 24, deli.minute, deli.second);
  const odmikMs = lokalnoKotUtc - priblizek.getTime();
  return new Date(priblizek.getTime() - odmikMs).toISOString();
}

module.exports = { TZ, todayStr, nowTimeStr, nowTimeHMS, todayDow, dateOffsetStr, konecDnevaUtc };
