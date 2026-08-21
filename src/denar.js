// ─── Zapis zneskov ────────────────────────────────────────────────────────
// Vse, kar stranka prebere, naj bo v slovenskem zapisu: "15,40 €", ne
// "15.4 €" in ne "15.40 €". En sam vir, da se ne razhaja po datotekah.
//
// Sprejme število ali niz s piko ali vejico — v kodi so zneski oboje.

function stevilo(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  return parseFloat(String(v == null ? '' : v).replace(/[€\s]/g, '').replace(',', '.'));
}

// "15,40" — brez enote
function znesek(v) {
  const n = stevilo(v);
  return isNaN(n) ? '' : n.toFixed(2).replace('.', ',');
}

// "15,40 €"
function evri(v) {
  const z = znesek(v);
  return z ? z + ' €' : '';
}

module.exports = { evri, znesek, stevilo };
