import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { suggestQuery, searchQuery } from '../validation/query.schemas.js';

export function searchRoutes({ searchController }) {
  const router = Router();
  router.get('/suggest', validate({ query: suggestQuery }), searchController.suggest);
  router.get('/', validate({ query: searchQuery }), searchController.search);
  return router;
}
