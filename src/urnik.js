// ─── Urnik lokala: en odpiralni interval na dan, dan lahko zaprt ─────────
//
// Do zdaj je lokal imel eno samo območje ur (working_hours_start/_end) in
// seznam delovnih dni (working_days). To za restavracijo ne zadošča: vsak dan
// ima lahko svoj čas, kak dan pa je zaprto. Restavracijski bot delovnih dni
// sploh ni videl, zato je v zaprtem ponedeljku mirno sprejemal naročila.
//
// Nov stolpec sb_salons.working_hours (JSONB) hrani urnik po dnevih:
//
//   { "0": null,                          ← nedelja zaprto
//     "1": { "od": "10:00", "do": "22:00" },
//     ... }
//
// Ključi so števke, kot jih vrne Date#getDay(): 0 = nedelja, 1 = ponedeljek.
// Manjkajoč ključ ali null pomeni zaprto.
//
// Dokler urnika ni vpisanega, se bere star model — zato po uvedbi nobenemu
// lokalu ne ugasne bot in ni treba migrirati podatkov.

const t = require('./time');

const KRATKI = ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'];
const IMENA   = ['nedeljo', 'ponedeljek', 'torek', 'sredo', 'četrtek', 'petek', 'soboto'];
// Prikazujemo od ponedeljka do nedelje, hranimo pa po getDay().
const PRIKAZ = [1, 2, 3, 4, 5, 6, 0];

// '8:0' → '08:00', '08:00:00' → '08:00', smeti → null
function hhmm(v) {
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

const vMinute = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

// Star model: '1,2,3,4,5,6,7' → Set {1,2,3,4,5,6,0}
// Sedmica je podatkovna napaka (JS ima nedeljo kot 0); brez tega popravka
// je bila nedelja pri Test Piceriji tiho zaprta.
function legacyDnevi(salon) {
  const niz = (salon && salon.working_days) || '1,2,3,4,5,6';
  const s = new Set();
  for (const del of String(niz).split(',')) {
    const n = parseInt(del, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 7) s.add(n === 7 ? 0 : n);
  }
  return s.size ? s : new Set([1, 2, 3, 4, 5, 6]);
}

// Preveri in počisti urnik, kot ga pošlje vmesnik. Vrne objekt s ključi 0–6
// (null = zaprto) ali null, če v poslanem ni nič uporabnega — takrat se ne
// zapiše nič in ostane star model.
function varenUrnik(vhod) {
  let o = vhod;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  let veljavnih = 0;
  for (let d = 0; d <= 6; d++) {
    const v = o[d] !== undefined ? o[d] : o[String(d)];
    if (!v || v.zaprto === true) { out[d] = null; continue; }
    const od = hhmm(v.od !== undefined ? v.od : v.start);
    const doo = hhmm(v.do !== undefined ? v.do : v.end);
    if (!od || !doo || od === doo) { out[d] = null; continue; }
    out[d] = { od, do: doo };
    veljavnih++;
  }
  return veljavnih ? out : null;
}

// Urnik lokala kot polje po getDay(): {od,do} ali null (zaprto).
function urnik(salon) {
  const nov = varenUrnik(salon && salon.working_hours);
  if (nov) return [0, 1, 2, 3, 4, 5, 6].map(d => nov[d]);
  // rezerva: staro enotno območje + seznam delovnih dni
  const od = hhmm(salon && salon.working_hours_start) || '08:00';
  const doo = hhmm(salon && salon.working_hours_end) || '19:00';
  const dnevi = legacyDnevi(salon);
  return [0, 1, 2, 3, 4, 5, 6].map(d => (dnevi.has(d) ? { od, do: doo } : null));
}

const zaDan = (salon, dow) => urnik(salon)[((dow % 7) + 7) % 7] || null;

// Dan v tednu za 'YYYY-MM-DD' brez timezone pasti (opoldne v UTC).
const dowZaDatum = ymd => new Date(String(ymd) + 'T12:00:00Z').getUTCDay();
const zaDatum = (salon, ymd) => zaDan(salon, dowZaDatum(ymd));

const jeOdprtDan = (salon, dow) => !!zaDan(salon, dow);
const odprtiDnevi = salon => new Set(urnik(salon).map((v, d) => (v ? d : -1)).filter(d => d >= 0));

// Ali je lokal odprt zdaj (v slovenskem času). Interval, ki se konča pred
// začetkom (npr. 18:00–01:00), šteje kot prehod v naslednji dan.
function jeOdprto(salon, d = new Date()) {
  const dow = t.todayDow(d);
  const zdaj = vMinute(t.nowTimeStr(d));
  const danes = zaDan(salon, dow);
  if (danes) {
    const a = vMinute(danes.od), b = vMinute(danes.do);
    if (b > a ? (zdaj >= a && zdaj < b) : (zdaj >= a || zdaj < b)) {
      return { odprto: true, danes, dow };
    }
  }
  // morda je še odprt sinočnji interval, ki gre čez polnoč
  const vceraj = zaDan(salon, (dow + 6) % 7);
  if (vceraj && vMinute(vceraj.do) <= vMinute(vceraj.od) && zdaj < vMinute(vceraj.do)) {
    return { odprto: true, danes: vceraj, dow: (dow + 6) % 7 };
  }
  return { odprto: false, danes, dow };
}

// Kdaj spet odprejo. Vrne { dow, od, kdaj } — kdaj je 'danes' | 'jutri' | ime dneva.
function naslednjeOdprtje(salon, d = new Date()) {
  const dow = t.todayDow(d);
  const zdaj = vMinute(t.nowTimeStr(d));
  const danes = zaDan(salon, dow);
  if (danes && vMinute(danes.od) > zdaj) return { dow, od: danes.od, kdaj: 'danes' };
  for (let i = 1; i <= 7; i++) {
    const dn = (dow + i) % 7;
    const u = zaDan(salon, dn);
    if (u) return { dow: dn, od: u.od, kdaj: i === 1 ? 'jutri' : ('v ' + IMENA[dn]) };
  }
  return null;
}

// Človeško besedilo urnika, z združenimi zaporednimi enakimi dnevi:
//   "Pon–Pet 10:00–22:00, Sob 12:00–23:00, Ned zaprto"
function besedilo(salon) {
  const u = urnik(salon);
  const kljuc = v => (v ? v.od + '–' + v.do : 'zaprto');
  const skupine = [];
  for (const d of PRIKAZ) {
    const k = kljuc(u[d]);
    const zadnja = skupine[skupine.length - 1];
    if (zadnja && zadnja.k === k) zadnja.dnevi.push(d);
    else skupine.push({ k, dnevi: [d] });
  }
  if (skupine.length === 1 && skupine[0].k === 'zaprto') return 'zaprto';
  return skupine.map(g => {
    const ime = g.dnevi.length === 1 ? KRATKI[g.dnevi[0]]
      : g.dnevi.length === 2 ? KRATKI[g.dnevi[0]] + ', ' + KRATKI[g.dnevi[1]]
      : KRATKI[g.dnevi[0]] + '–' + KRATKI[g.dnevi[g.dnevi.length - 1]];
    return ime + ' ' + g.k;
  }).join(', ');
}

// Urnik za vmesnik: vedno vseh sedem dni, tudi kadar se bere star model.
function zaVmesnik(salon) {
  const u = urnik(salon);
  return PRIKAZ.map(d => ({ dan: d, kratko: KRATKI[d], zaprto: !u[d], od: u[d] ? u[d].od : '', do: u[d] ? u[d].do : '' }));
}

module.exports = {
  KRATKI, IMENA, PRIKAZ,
  hhmm, varenUrnik, urnik, zaDan, zaDatum, dowZaDatum,
  jeOdprtDan, odprtiDnevi, jeOdprto, naslednjeOdprtje, besedilo, zaVmesnik
};
