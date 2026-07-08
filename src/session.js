// Session store: in-memory + Supabase backup
// Ob restartu Railway se seja obnovi iz DB (brez izgube košarice/ime/naslov)

const sessions = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_SESSIONS = 5000;

// Lazy require — prepreči krožno odvisnost pri zagonu
let db = null;
function getDb() {
  if (!db) { try { db = require('./supabase'); } catch (_) {} }
  return db;
}

function parseKey(key) {
  const idx = key.indexOf(':');
  return idx > 0 ? [key.slice(0, idx), key.slice(idx + 1)] : [key, key];
}

function get(key) {
  const rec = sessions.get(key);
  if (!rec) return { step: 0 };
  if (Date.now() - rec._ts > TTL_MS) { sessions.delete(key); return { step: 0 }; }
  return rec.data;
}

// Async get — če memoria prazna, poizkusi obnoviti iz Supabase
async function getOrRestore(key) {
  const mem = get(key);
  if (mem && mem.step > 0) return mem;
  const d = getDb();
  if (!d) return mem;
  const [salonId, phone] = parseKey(key);
  const dbData = await d.loadAiSession(salonId, phone).catch(() => null);
  if (dbData && dbData.step > 0) {
    // Obnovi v memory (brez ponovnega DB klica)
    if (sessions.size >= MAX_SESSIONS && !sessions.has(key)) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1]._ts - b[1]._ts).slice(0, Math.ceil(MAX_SESSIONS / 10));
      for (const [k] of oldest) sessions.delete(k);
    }
    sessions.set(key, { data: dbData, _ts: Date.now() });
    return dbData;
  }
  return mem;
}

function set(key, data) {
  if (sessions.size >= MAX_SESSIONS && !sessions.has(key)) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1]._ts - b[1]._ts).slice(0, Math.ceil(MAX_SESSIONS / 10));
    for (const [k] of oldest) sessions.delete(k);
  }
  sessions.set(key, { data, _ts: Date.now() });
  // Shrani v Supabase (fire-and-forget)
  const d = getDb();
  if (d) {
    const [salonId, phone] = parseKey(key);
    d.saveAiSession(salonId, phone, data).catch(() => {});
  }
}

function clear(key) {
  sessions.delete(key);
  const d = getDb();
  if (d) {
    const [salonId, phone] = parseKey(key);
    d.clearAiSession(salonId, phone).catch(() => {});
  }
}

module.exports = { get, getOrRestore, set, clear };
