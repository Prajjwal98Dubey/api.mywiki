import { Router } from 'express';

export function healthRoutes({ repos }) {
  const router = Router();
  router.get('/', (_req, res) => res.json({ ok: true, storage: repos.driver }));
  return router;
}
