// ─── Strošek dostave po kraju ─────────────────────────────────────────────
//
// Lokal ima lahko ceno dostave določeno po krajih (sb_salons.delivery_zones),
// npr. Vodice 2 €, Šenčur 3 €, Kamnik 5 €. Iz naslova, ki ga stranka napiše,
// poiščemo kraj in vzamemo njegovo ceno.
//
// Dva načina, ki se IZKLJUČUJETA — enako kot pri embalaži:
//   1) delivery_zones ima vsaj en kraj → cena po kraju
//   2) prazno                          → enotna delivery_fee na naročilo
//
// Kadar kraja ni mogoče določiti, cene NE ugibamo: naročilo gre skozi, ceno
// dostave pa določi lastnik. Napačna cena je slabša od nedoločene.

const VEZNE = new Set(['pri', 'nad', 'pod', 'v', 'na', 'ob', 'za', 'in', 'ter', 'do']);

// Okrajšave s tabel in naslovov. Ključ je normalizirana beseda.
const OKRAJSAVE = {
  sp: 'spodnji', spod: 'spodnji',
  zg: 'zgornji', zgor: 'zgornji',
  sr: 'srednji',
  st: 'stari', nov: 'novi',
  sv: 'sveti'
};

// Brez šumnikov, male črke, vse nečrkovno v presledek. Hišno številko, zlepljeno
// z imenom, ločimo: "Dvorje15" → "dvorje 15". Brez tega tipkarska napaka ob
// zlepljeni številki ni ujeta — v pravih naročilih se je pojavil "Dvprje15".
function normaliziraj(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .trim();
}

// Besede, ki nosijo pomen: brez veznih besed in brez samih številk
// (hišne številke, poštne številke).
function besede(s) {
  return normaliziraj(s).split(' ')
    .filter(Boolean)
    .map(w => OKRAJSAVE[w] || w)
    .filter(w => !VEZNE.has(w) && !/^\d+$/.test(w));
}

// Levenshtein razdalja
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

const skupniZacetek = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

// Ali je beseda iz naslova ista kot beseda kraja? Slovenski skloni so tu
// glavni izziv: Vodice → v Vodicah, Mengeš → v Mengšu, Homec → v Homcu.
// Namenoma NE uporabljamo vsebovanosti podnizov (kot wordMatch v ai-order.js):
// s tem bi "Dol" ujel "Dolsko" in Dol pri Ljubljani bi dobil ceno Dolskega.
function besedaUjema(a, b) {
  if (a === b) return true;
  // Prva črka se mora ujemati. Sklon je skoraj nikoli ne spremeni, dva
  // različna kraja pa se prav po njej ločita: "Vojsko" (5 €) in "Dolsko"
  // (6 €) se razlikujeta v dveh črkah in bi se brez tega ujela.
  if (a[0] !== b[0]) return false;
  const dolzina = Math.max(a.length, b.length);
  const meja = dolzina <= 3 ? 0 : dolzina === 4 ? 1 : 2;
  if (lev(a, b) <= meja) return true;
  // Skupen začetek petih črk: "vodic|e" ~ "vodic|ah". Pet in ne štiri, da
  // "cerk|lje" ne ujame "cerk|nice".
  return skupniZacetek(a, b) >= 5;
}

// Koliko besed kraja se pojavi v naslovu. Vse morajo, sicer 0.
function ujemanje(besedeNaslova, besedeKraja) {
  if (!besedeKraja.length) return 0;
  let zadetkov = 0;
  for (const kw of besedeKraja) {
    if (!besedeNaslova.some(aw => besedaUjema(aw, kw))) return 0;
    zadetkov++;
  }
  return zadetkov;
}

// Preveri in počisti kraje, kot jih pošlje vmesnik. Vrne polje ali null, če
// ni nič uporabnega (takrat velja enotna cena lokala).
const MAX_KRAJEV = 300;
function varneZone(vhod) {
  let o = vhod;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!Array.isArray(o)) return null;
  const out = [];
  const videni = new Set();
  for (const v of o) {
    if (!v || typeof v !== 'object') continue;
    const kraj = String(v.kraj !== undefined ? v.kraj : v.name || '').trim().slice(0, 60);
    if (!kraj) continue;
    const kljuc = normaliziraj(kraj);
    if (!kljuc || videni.has(kljuc)) continue;      // podvojene strnemo
    const cena = parseFloat(String(v.cena !== undefined ? v.cena : v.price).replace(',', '.'));
    if (isNaN(cena) || cena < 0 || cena > 100) continue;
    videni.add(kljuc);
    out.push({ kraj, cena: Math.round(cena * 100) / 100 });
    if (out.length >= MAX_KRAJEV) break;
  }
  return out.length ? out : null;
}

// Kraji lokala ali null.
const zoneLokala = salon => varneZone(salon && salon.delivery_zones);

// Ali lokal uporablja ceno po krajih?
const poKrajih = salon => !!zoneLokala(salon);

/*
  Poišči kraj v naslovu.

  Vrne:
    { kraj, cena }        kraj je določen
    { dvoumno: [imena] }  več krajev z RAZLIČNO ceno se ujema enako dobro
    null                  ni ujemanja (ali ni naslova ali ni krajev)
*/
function najdiKraj(zone, naslov) {
  const seznam = Array.isArray(zone) ? zone : varneZone(zone);
  if (!seznam || !seznam.length) return null;
  const bn = besede(naslov);
  if (!bn.length) return null;

  let najboljse = 0;
  let zmagovalci = [];
  for (const z of seznam) {
    const n = ujemanje(bn, besede(z.kraj));
    if (!n) continue;
    if (n > najboljse) { najboljse = n; zmagovalci = [z]; }
    else if (n === najboljse) zmagovalci.push(z);
  }
  if (!zmagovalci.length) return null;

  // Enako dobro ujemanje z isto ceno ni dvoumnost — samo dve poimenovanji.
  const cene = new Set(zmagovalci.map(z => z.cena.toFixed(2)));
  if (cene.size > 1) return { dvoumno: zmagovalci.map(z => z.kraj) };
  return { kraj: zmagovalci[0].kraj, cena: zmagovalci[0].cena };
}

/*
  Strošek dostave za naročilo.

  Vrne { cena, kraj, neznana }:
    neznana = true pomeni, da cene ne moremo določiti — naročilo gre skozi,
    ceno pa določi lastnik.
*/
function strosek(salon, naslov) {
  const zone = zoneLokala(salon);
  if (!zone) {
    // stari način: enotna cena na naročilo
    const c = parseFloat(salon && salon.delivery_fee || 0);
    return { cena: (isNaN(c) || c < 0) ? 0 : c, kraj: null, neznana: false };
  }
  if (!naslov || !String(naslov).trim()) return { cena: 0, kraj: null, neznana: true };
  const najden = najdiKraj(zone, naslov);
  if (!najden || najden.dvoumno) {
    return { cena: 0, kraj: null, neznana: true, dvoumno: najden ? najden.dvoumno : null };
  }
  return { cena: najden.cena, kraj: najden.kraj, neznana: false };
}

/* ── Kraji, ki jih v ceniku ni ────────────────────────────────────────────
   Lastnik se pri vpisu lahko zmoti (napačno zapisan kraj ni nikoli ujet) ali
   pa kraja preprosto ni na listu. Oboje se pokaže enako: naročilo dobi oznako
   "kraj ni na seznamu". Ker šifranta slovenskih krajev nimamo, imena ni s čim
   primerjati — zato izhajamo iz PRAVIH naslovov iz naročil. Kar se v njih
   ponavlja in ni pokrito, je kandidat za vpis.
*/

// Besede, ki označujejo ulico in ne kraja.
const ULICNE = new Set(['ulica', 'ul', 'cesta', 'pot', 'trg', 'naselje',
  'nabrezje', 'drevored', 'steza', 'obala', 'park', 'sp', 'st']);
// Pridevniške končnice ulic (Vojkova, Ljubljanska, Tržaška) — kraji jih redko imajo.
const ULICNI_KONEC = /(ova|eva|ska|cka|zka)$/;

// Najboljša domneva, kateri del naslova je kraj. Vrne besedo, kot je zapisana
// (s šumniki), ali null. Domneva je lahko napačna — zato jo lastnik potrdi.
function kandidatKraja(naslov) {
  const deli = String(naslov == null ? '' : naslov).split(',').map(s => s.trim()).filter(Boolean);
  const izDela = del => {
    const surove = del.split(/\s+/).filter(Boolean);
    const kandidati = surove.filter(w => {
      const n = normaliziraj(w);
      return n && !/\d/.test(n) && !ULICNE.has(n) && !VEZNE.has(n);
    });
    return kandidati.length ? kandidati[kandidati.length - 1] : null;
  };
  // Kraj je najpogosteje v zadnjem delu za vejico; če je videti kot ulica,
  // poskusimo prejšnji del.
  for (let i = deli.length - 1; i >= 0; i--) {
    const w = izDela(deli[i]);
    if (!w) continue;
    if (i > 0 && ULICNI_KONEC.test(normaliziraj(w))) continue;
    return w.replace(/[.,;:]+$/, '');
  }
  for (let i = deli.length - 1; i >= 0; i--) {
    const w = izDela(deli[i]);
    if (w) return w.replace(/[.,;:]+$/, '');
  }
  return null;
}

// Naslov dostave iz zapisa naročila (form_answers ali opomba).
function naslovNarocila(booking) {
  if (!booking) return null;
  let fa = booking.form_answers;
  if (typeof fa === 'string') { try { fa = JSON.parse(fa); } catch { fa = null; } }
  let naslov = (fa && fa.naslov) || null;
  if (!naslov && booking.notes) {
    const m = String(booking.notes).match(/Naslov:\s*([^|]+)/);
    if (m) naslov = m[1].trim();
  }
  if (!naslov) return null;
  naslov = String(naslov).trim();
  if (!naslov || /osebni prevzem/i.test(naslov)) return null;
  return naslov;
}

/*
  Iz naročil izbere naslove, pri katerih kraja ni bilo mogoče določiti, in jih
  strne po domnevnem kraju.

  Vrne [{ kraj, naročil, naslovi: [..], zadnje }] — od najpogostejšega.
*/
function neznaniKraji(salon, bookings, najvec) {
  if (!zoneLokala(salon)) return [];
  const skupine = new Map();
  for (const b of (bookings || [])) {
    const naslov = naslovNarocila(b);
    if (!naslov) continue;
    const r = strosek(salon, naslov);
    if (!r.neznana) continue;
    const kandidat = kandidatKraja(naslov) || naslov;
    const k = normaliziraj(kandidat);
    if (!k) continue;
    if (!skupine.has(k)) skupine.set(k, { kraj: kandidat, narocil: 0, naslovi: [], zadnje: null });
    const g = skupine.get(k);
    g.narocil++;
    if (g.naslovi.length < 5 && g.naslovi.indexOf(naslov) < 0) g.naslovi.push(naslov);
    const kdaj = b.created_at || b.booking_date || null;
    if (kdaj && (!g.zadnje || String(kdaj) > String(g.zadnje))) g.zadnje = kdaj;
  }
  return [...skupine.values()]
    .sort((a, b) => b.narocil - a.narocil || String(b.zadnje).localeCompare(String(a.zadnje)))
    .slice(0, najvec || 20);
}

// Kraji, strnjeni po ceni — za prikaz in za nadzor nad vpisanim cenikom.
function poCenah(salon) {
  const zone = zoneLokala(salon) || [];
  const skupine = new Map();
  for (const z of zone) {
    const k = z.cena.toFixed(2);
    if (!skupine.has(k)) skupine.set(k, []);
    skupine.get(k).push(z.kraj);
  }
  return [...skupine.entries()]
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([cena, kraji]) => ({ cena: parseFloat(cena), kraji }));
}

module.exports = {
  normaliziraj, besede, lev, besedaUjema,
  varneZone, zoneLokala, poKrajih, najdiKraj, strosek, poCenah,
  kandidatKraja, naslovNarocila, neznaniKraji,
  MAX_KRAJEV
};
