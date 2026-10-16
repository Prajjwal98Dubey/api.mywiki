import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { optionalAuth } from './middleware/auth.js';
import { staticUploads } from './middleware/upload.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { buildRoutes } from './routes/index.js';

/** Builds the Express app. Tests call this directly with their own repos/config. */
export function createApp({ repos, config }) {
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.clientOrigin, credentials: true })); // only matters when not proxied
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (config.env !== 'test') app.use(morgan('dev'));

  app.use('/uploads', staticUploads(config));
  app.use('/api', optionalAuth(config, repos), buildRoutes({ repos, config }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
