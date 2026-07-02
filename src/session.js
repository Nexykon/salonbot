// In-memory session store (persists while server runs)
// For multi-instance deploy, replace with Redis or Supabase table
//
// Ključ je "salonId:phone" (nastavi handler.js), da se seje iste stranke
// pri različnih salonih ne mešajo.

const sessions = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // seja poteče po 24h
const MAX_SESSIONS = 5000;          // varovalka proti puščanju pomnilnika

function get(key) {
  const rec = sessions.get(key);
  if (!rec) return { step: 0 };
  if (Date.now() - rec._ts > TTL_MS) {
    sessions.delete(key);
    return { step: 0 };
  }
  return rec.data;
}

function set(key, data) {
  if (sessions.size >= MAX_SESSIONS && !sessions.has(key)) {
    // odstrani najstarejših ~10 %, da ne raste v nedogled
    const oldest = [...sessions.entries()]
      .sort((a, b) => a[1]._ts - b[1]._ts)
      .slice(0, Math.ceil(MAX_SESSIONS / 10));
    for (const [k] of oldest) sessions.delete(k);
  }
  sessions.set(key, { data, _ts: Date.now() });
}

function clear(key) {
  sessions.delete(key);
}

module.exports = { get, set, clear };
