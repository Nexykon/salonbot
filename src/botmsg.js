// ─── Prilagodljiva sporočila bota ────────────────────────────
// Lastnik lahko v nastavitvah povozi katerokoli sporočilo;
// prazna vrednost pomeni privzeto besedilo spodaj.
// Oznake: {ime} {ref} {minute} {naslov} se zamenjajo ob pošiljanju.

const DEFAULTS = {
  mode_question:      '🛒 Skoraj končano!\n\nKako želite prevzeti naročilo?',
  note_question:      '📝 Ali imate kakšno posebno željo?\n_(npr. brez gob, bolj pikantno, alergija na orehe...)_\n\nNapišite opombo ali pošljite *NE* za nadaljevanje brez opombe.',
  name_question:      '👤 Prosim vnesite vaše *ime in priimek*:',
  address_question:   '📍 Na kateri naslov dostavimo?\n_(ulica, hišna številka, kraj)_',
  submitted_delivery: '✅ Naročilo oddano, {ime}!\n\n🔑 Ref: *#{ref}*\n\n⏳ Prosimo, počakajte na *potrditveno sporočilo* — vaše naročilo je sprejeto šele, ko ga prejmete. Takrat vas obvestimo tudi o času dostave. 🍕',
  submitted_pickup:   '✅ Naročilo oddano, {ime}!\n\n🔑 Ref: *#{ref}*\n\n⏳ Prosimo, počakajte na *potrditveno sporočilo* — vaše naročilo je sprejeto šele, ko ga prejmete. Takrat vas obvestimo, kdaj bo pripravljeno za prevzem. 🏃',
  autoconfirmed:      '✅ Naročilo potrjeno, {ime}!\n\n🔑 Ref: *#{ref}*\n\nŽe ga pripravljamo. Hvala za naročilo! 😊',
  accepted_delivery:  '🍕 Vaše naročilo je potrjeno!\n\n⏱️ Dostava v pribl. *{minute} minutah*\n\nHvala za naročilo! 😊',
  accepted_pickup:    '🏃 Vaše naročilo je potrjeno!\n\n⏱️ Pripravljeno za prevzem v pribl. *{minute} minutah*{naslov}\n\nHvala za naročilo! 😊',
  rejected:           '😔 Žal vašega naročila nismo mogli sprejeti. Pokličite nas za več informacij.',
  bot_offline:        '⏸️ Trenutno žal ne sprejemamo naročil. Poskusite malo kasneje. Hvala za razumevanje! 🙏'
};

const KEYS = Object.keys(DEFAULTS);

function overrides(salon) {
  const bm = salon && salon.bot_messages;
  if (!bm) return {};
  if (typeof bm === 'string') {
    try { return JSON.parse(bm) || {}; } catch (_) { return {}; }
  }
  return bm;
}

function botMsg(salon, key, vars = {}) {
  const raw = String(overrides(salon)[key] || '').trim() || DEFAULTS[key] || '';
  return raw
    .replace(/\{ime\}/g, vars.ime !== undefined ? String(vars.ime) : '')
    .replace(/\{ref\}/g, vars.ref !== undefined ? String(vars.ref) : '')
    .replace(/\{minute\}/g, vars.minute !== undefined ? String(vars.minute) : '')
    .replace(/\{naslov\}/g, vars.naslov !== undefined ? String(vars.naslov) : '');
}

module.exports = { botMsg, DEFAULTS, KEYS };
