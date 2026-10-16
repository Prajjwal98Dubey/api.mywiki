import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createImageUpload } from '../middleware/upload.js';

export function uploadsRoutes({ uploadsController, config }) {
  const router = Router();
  router.post('/image', requireAuth, createImageUpload(config), uploadsController.image);
  return router;
}
