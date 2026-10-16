import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireOwner } from '../middleware/loadPage.js';
import { revisionsQuery } from '../validation/query.schemas.js';
import { restoreSchema } from '../validation/page.schemas.js';

/** Mounted at /pages/:slug/revisions after loadPage, so `req.page` is set. */
export function revisionsRoutes({ revisionsController }) {
  const router = Router({ mergeParams: true });

  router.get('/', validate({ query: revisionsQuery }), revisionsController.list);
  router.get('/:revId', revisionsController.get);
  router.post('/:revId/restore', requireOwner, validate({ body: restoreSchema }), revisionsController.restore);

  return router;
}
