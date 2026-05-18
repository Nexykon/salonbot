const crypto = require('crypto');

const otpStore = new Map();
const sessions = new Map();

function cleanPhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function createOtp(phone, salonId) {
  const clean = cleanPhone(phone);
  const code = String(crypto.randomInt(100000, 1000000));
  otpStore.set(clean, {
    salonId,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0
  });
  return code;
}

function verifyOtp(phone, code) {
  const clean = cleanPhone(phone);
  const record = otpStore.get(clean);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    otpStore.delete(clean);
    return null;
  }
  record.attempts += 1;
  if (record.attempts > 5) {
    otpStore.delete(clean);
    return null;
  }
  if (String(code || '').trim() !== record.code) return null;
  otpStore.delete(clean);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    salonId: record.salonId,
    phone: clean,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
  });
  return token;
}

function getSession(token) {
  const cleanToken = String(token || '').replace(/^Bearer\s+/i, '').trim();
  const session = sessions.get(cleanToken);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(cleanToken);
    return null;
  }
  return session;
}

function clearSession(token) {
  sessions.delete(String(token || '').replace(/^Bearer\s+/i, '').trim());
}

module.exports = { cleanPhone, createOtp, verifyOtp, getSession, clearSession };
