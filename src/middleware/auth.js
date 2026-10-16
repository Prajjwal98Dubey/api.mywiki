import { TOKEN_COOKIE, verifyToken, clearAuthCookie } from '../lib/jwt.js';
import { unauthenticated } from '../lib/errors.js';

/** Sets `req.user` (full user doc) or null. Invalid/expired tokens clear the cookie. */
export function optionalAuth(config, repos) {
  return async (req, res, next) => {
    req.user = null;
    const token = req.cookies?.[TOKEN_COOKIE];
    if (!token) return next();
    const userId = verifyToken(token, config);
    const user = userId ? await repos.users.findById(userId) : null;
    if (user) req.user = user;
    else clearAuthCookie(res, config);
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthenticated());
  next();
}
