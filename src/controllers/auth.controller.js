import { setAuthCookie, clearAuthCookie } from '../lib/jwt.js';
import { toPublicUser } from '../lib/serialize.js';

export function createAuthController({ authService, config }) {
  return {
    async register(req, res) {
      const { user, token } = await authService.register(req.valid.body);
      setAuthCookie(res, token, config);
      res.status(201).json({ user: toPublicUser(user, { includeEmail: true }) });
    },

    async login(req, res) {
      const { user, token } = await authService.login(req.valid.body);
      setAuthCookie(res, token, config);
      res.json({ user: toPublicUser(user, { includeEmail: true }) });
    },

    logout(_req, res) {
      clearAuthCookie(res, config);
      res.status(204).end();
    },

    me(req, res) {
      res.set('Cache-Control', 'no-store');
      res.json({ user: toPublicUser(req.user, { includeEmail: true }) });
    },
  };
}
