// Optional shared-password gate for the whole site.
//
// Set APP_PASSWORD to require a password before anyone can use the site.
// The site runs on the owner's voice credits, so gating it is the honest
// way to share the link without opening the credits to the whole internet.
//
// How it works (stateless, so it also works on serverless hosts where
// instances come and go): after a correct password, the server sets an
// HttpOnly cookie holding HMAC-SHA256(APP_PASSWORD, "easyall-session-v1").
// Only someone who knows the password can mint that cookie, and the server
// verifies it by recomputing — nothing is stored server-side. The password
// itself is never put in a cookie and never logged.

const crypto = require('crypto');
const path = require('path');

const config = require('./config');

const COOKIE_NAME = 'easyall_session';
const SESSION_LABEL = 'easyall-session-v1';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function sessionToken(password) {
  return crypto.createHmac('sha256', password).update(SESSION_LABEL).digest('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function passwordMatches(candidate) {
  if (typeof candidate !== 'string' || !config.appPassword) return false;
  const a = sha256(candidate);
  const b = sha256(config.appPassword);
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  if (!config.appPassword) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const expected = sessionToken(config.appPassword);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${COOKIE_NAME}=${sessionToken(config.appPassword)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
}

// Express middleware: when a password is set, unauthenticated visitors get
// the login page for page requests and a 401 for API requests. The login
// endpoints themselves are always reachable.
function middleware(publicDir) {
  return (req, res, next) => {
    if (!config.appPassword) return next();
    if (req.path === '/api/login' || req.path === '/api/logout') return next();
    if (isAuthed(req)) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Please sign in to use EasyAll.' });
    }
    return res.sendFile(path.join(publicDir, 'login.html'));
  };
}

module.exports = { middleware, isAuthed, passwordMatches, setSessionCookie, clearSessionCookie };
