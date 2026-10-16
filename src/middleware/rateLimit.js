import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../lib/errors.js';

const passThrough = (_req, _res, next) => next();

function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', message)),
  });
}

/** Login: 10 / 15 min / IP. Register: 5 / hour / IP. Overridable via config.rateLimit. */
export function createAuthRateLimiters(config) {
  const rl = config.rateLimit ?? {};
  if (rl.enabled === false) return { login: passThrough, register: passThrough };
  return {
    login: limiter({
      windowMs: 15 * 60 * 1000,
      limit: rl.loginMax ?? 10,
      message: 'Too many login attempts. Please try again in a few minutes.',
    }),
    register: limiter({
      windowMs: 60 * 60 * 1000,
      limit: rl.registerMax ?? 5,
      message: 'Too many accounts created from this address. Please try again later.',
    }),
  };
}
