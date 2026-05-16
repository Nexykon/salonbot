// In-memory session store (persists while server runs)
// For multi-instance deploy, replace with Redis or Supabase table

const sessions = new Map();

function get(phone) {
  return sessions.get(phone) || { step: 0 };
}

function set(phone, data) {
  sessions.set(phone, data);
}

function clear(phone) {
  sessions.set(phone, { step: 0 });
}

module.exports = { get, set, clear };
