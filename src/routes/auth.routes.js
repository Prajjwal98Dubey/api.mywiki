import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { createAuthRateLimiters } from '../middleware/rateLimit.js';
import { registerSchema, loginSchema } from '../validation/auth.schemas.js';

export function authRoutes({ authController, oauthController, config }) {
  const router = Router();
  const limit = createAuthRateLimiters(config);

  router.post('/register', limit.register, validate({ body: registerSchema }), authController.register);
  router.post('/login', limit.login, validate({ body: loginSchema }), authController.login);
  router.post('/logout', authController.logout);
  router.get('/me', authController.me);

  // External sign-in (Google, …): see src/oauth/.
  router.get('/providers', oauthController.list);
  router.get('/oauth/:provider/start', oauthController.start);
  router.get('/oauth/:provider/callback', limit.login, oauthController.callback);

  return router;
}
