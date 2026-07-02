const crypto = require('crypto');

const otpStore = new Map();
const sessions = new Map();
const PASSWORD_PREFIX = 'scrypt';

function cleanPhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function createOtp(phone, salonId, role = 'owner') {
  const clean = cleanPhone(phone);
  const code = String(crypto.randomInt(100000, 1000000));
  otpStore.set(clean, {
    salonId,
    role,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0
  });
  return code;
}

function hashPassword(password) {
  const clean = String(password || '');
  if (clean.length < 8) {
    const err = new Error('Geslo mora imeti vsaj 8 znakov');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clean, salt, 64).toString('hex');
  return `${PASSWORD_PREFIX}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== PASSWORD_PREFIX) return false;
  const [, salt, expectedHex] = parts;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(String(password || ''), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SUPABASE_KEY || 'flowtiq-fallback-secret';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 dni

function createSession(salonId, role = 'owner', identity = {}) {
  const payload = JSON.stringify({ salonId, role, ...identity, expiresAt: Date.now() + SESSION_TTL });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  const token = `${payloadB64}.${sig}`;
  // Ohrani tudi in-memory za backward compatibility
  sessions.set(token, { salonId, role, ...identity, expiresAt: Date.now() + SESSION_TTL });
  return token;
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
  return createSession(record.salonId, record.role || 'owner', { phone: clean });
}

function getSession(token) {
  const cleanToken = String(token || '').replace(/^Bearer\s+/i, '').trim();

  // Preskusi HMAC token (novi format: payload.sig)
  const dotIdx = cleanToken.lastIndexOf('.');
  if (dotIdx > 0) {
    const payloadB64 = cleanToken.slice(0, dotIdx);
    const sig = cleanToken.slice(dotIdx + 1);
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      try {
        const session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        if (session.expiresAt < Date.now()) return null;
        return session;
      } catch { return null; }
    }
  }

  // Fallback: stari in-memory token
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

module.exports = {
  cleanPhone, createOtp, hashPassword, verifyPassword, hashToken,
  createSession, verifyOtp, getSession, clearSession
};
