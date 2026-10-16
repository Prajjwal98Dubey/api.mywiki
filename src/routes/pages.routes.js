import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loadPage, requireOwner } from '../middleware/loadPage.js';
import { createPageSchema, updatePageSchema, pageSettingsSchema } from '../validation/page.schemas.js';
import { listPagesQuery, slugCheckQuery } from '../validation/query.schemas.js';

export function pagesRoutes({ pagesController, repos, revisionsRouter }) {
  const router = Router();
  const page = loadPage(repos);

  // Fixed paths first — they must win over /:slug.
  router.get('/', validate({ query: listPagesQuery }), pagesController.list);
  router.get('/mine', requireAuth, pagesController.mine);
  router.get('/count', pagesController.count);
  router.get('/random', pagesController.random);
  router.get('/slug-check', validate({ query: slugCheckQuery }), pagesController.slugCheck);
  router.post('/', requireAuth, validate({ body: createPageSchema }), pagesController.create);

  router.get('/:slug', page, pagesController.get);
  router.get('/:slug/summary', page, pagesController.summary);
  router.put('/:slug', page, requireOwner, validate({ body: updatePageSchema }), pagesController.update);
  router.patch('/:slug/settings', page, requireOwner, validate({ body: pageSettingsSchema }), pagesController.settings);
  router.delete('/:slug', page, requireOwner, pagesController.remove);

  router.use('/:slug/revisions', page, revisionsRouter);

  return router;
}
