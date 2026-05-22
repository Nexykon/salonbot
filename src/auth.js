const crypto = require('crypto');

// ── JWT helpers (no external deps, HMAC-SHA256) ──────────────
const JWT_SECRET = process.env.JWT_SECRET || 'flowtiq-default-secret-change-me';
const JWT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = crypto.createHmac('sha256', JWT_SECRET)
                       .update(`${header}.${body}`)
                       .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET)
                           .update(`${header}.${body}`)
                           .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// OTP store stays in-memory (short-lived, only for login flow)
const otpStore = new Map();
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

// createSession now returns a signed JWT instead of random token stored in Map
function createSession(salonId, role = 'owner', identity = {}) {
  return signJwt({ salonId, role, ...identity, expiresAt: Date.now() + JWT_TTL_MS });
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
  return verifyJwt(cleanToken);
}

// clearSession is a no-op for JWT (stateless); kept for API compatibility
function clearSession(_token) {}

module.exports = {
  cleanPhone, createOtp, hashPassword, verifyPassword, hashToken,
  createSession, verifyOtp, getSession, clearSession
};
