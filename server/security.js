/* eslint-disable @typescript-eslint/no-require-imports */
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');

const SESSION_COOKIE = 'pve-session';
const SESSION_SECONDS = 2 * 60 * 60 - 60;

function sessionKey() {
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'production') {
    process.env.SESSION_SECRET = randomBytes(48).toString('base64url');
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return createHash('sha256').update(secret).digest();
}

function seal(value, purpose = 'session') {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(), nonce);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

function unseal(value, purpose = 'session') {
  if (typeof value !== 'string' || value.length > 12000) return null;
  try {
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const nonce = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (nonce.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', sessionKey(), nonce);
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseSession(value) {
  const session = unseal(value);
  if (!session || typeof session.ticket !== 'string' || !session.ticket.startsWith('PVE:') || session.ticket.startsWith('PVE:!tfa!') || /[\r\n;]/.test(session.ticket)
    || typeof session.csrfToken !== 'string' || !session.csrfToken || /[\r\n]/.test(session.csrfToken)
    || typeof session.username !== 'string' || !session.username.includes('@')
    || !Number.isFinite(session.issuedAt) || session.issuedAt > Date.now() + 30000
    || session.expiresAt - session.issuedAt > SESSION_SECONDS * 1000) return null;
  return session;
}

function isAllowedOrigin(origin, host, secure = false) {
  if (typeof origin !== 'string' || origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    if (process.env.APP_ORIGIN) return origin === new URL(process.env.APP_ORIGIN).origin;
    if (process.env.NODE_ENV === 'production' || !host) return false;
    return origin === `${secure ? 'https' : 'http'}://${host}`;
  } catch {
    return false;
  }
}

function validateConfiguration() {
  sessionKey();
  const target = new URL(process.env.PROXMOX_HOST || '');
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('PROXMOX_HOST must be an HTTPS origin without credentials, path, query, or fragment');
  }
  if (process.env.NODE_ENV === 'production') {
    const origin = new URL(process.env.APP_ORIGIN || '');
    if (origin.protocol !== 'https:' || origin.origin !== process.env.APP_ORIGIN) throw new Error('APP_ORIGIN must be the public HTTPS origin without a trailing slash');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Global TLS verification bypass is forbidden; configure NODE_EXTRA_CA_CERTS');
}

module.exports = { SESSION_COOKIE, SESSION_SECONDS, seal, unseal, parseSession, isAllowedOrigin, validateConfiguration };
