import jwt from 'jsonwebtoken';

export const TOKEN_COOKIE = 'token';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function signToken(userId, config) {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

/** Returns the user id, or null when the token is missing/invalid/expired. */
export function verifyToken(token, config) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  };
}

export function setAuthCookie(res, token, config) {
  res.cookie(TOKEN_COOKIE, token, { ...cookieOptions(config), maxAge: SEVEN_DAYS_MS });
}

export function clearAuthCookie(res, config) {
  res.clearCookie(TOKEN_COOKIE, cookieOptions(config));
}
