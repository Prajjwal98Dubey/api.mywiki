import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// The sign-in "transaction" (spec §7.2.1): a short-lived, signed, httpOnly cookie that
// carries `state`, the PKCE verifier, the OIDC nonce and `returnTo` from /start to /callback.

export const TX_COOKIE = 'oauth_tx';
const COOKIE_PATH = '/api/auth/oauth';
const AUDIENCE = 'mywiki-oauth-tx';
const TTL_SECONDS = 10 * 60;

const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');

/** Fresh state, nonce and PKCE pair (RFC 7636, S256). */
export function createAuthRequest() {
  const codeVerifier = random(32);
  return {
    state: random(24),
    nonce: random(24),
    codeVerifier,
    codeChallenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'),
  };
}

const cookieOptions = (config) => ({
  httpOnly: true,
  sameSite: 'lax', // must survive the top-level redirect back from the provider
  secure: config.isProduction,
  path: COOKIE_PATH,
});

export function setTxCookie(res, { provider, state, nonce, codeVerifier, returnTo }, config) {
  const token = jwt.sign({ provider, state, nonce, codeVerifier, returnTo }, config.jwtSecret, {
    algorithm: 'HS256',
    audience: AUDIENCE,
    expiresIn: TTL_SECONDS,
  });
  res.cookie(TX_COOKIE, token, { ...cookieOptions(config), maxAge: TTL_SECONDS * 1000 });
}

/** The verified transaction, or null when missing, tampered with or expired. */
export function readTxCookie(req, config) {
  const token = req.cookies?.[TX_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], audience: AUDIENCE });
  } catch {
    return null;
  }
}

export function clearTxCookie(res, config) {
  res.clearCookie(TX_COOKIE, cookieOptions(config));
}

export function statesMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Only same-site paths ("/x?y"), never "//host" or "/\host" — prevents open redirects. */
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 500) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  return value;
}
