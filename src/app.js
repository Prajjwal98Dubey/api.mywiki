import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { optionalAuth } from './middleware/auth.js';
import { createImageStore } from './images/imageStore.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { buildRoutes } from './routes/index.js';

/** Builds the Express app. Tests call this directly with their own repos/config. */
export function createApp({ repos, config }) {
  const imageStore = createImageStore(config);

  const app = express();
  app.locals.imageStore = imageStore;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.clientOrigin, credentials: true })); // only matters when not proxied
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (config.env !== 'test') app.use(morgan('dev'));

  app.use('/uploads', imageStore.serve); // local disk or S3, same URLs
  app.use('/api', optionalAuth(config, repos), buildRoutes({ repos, config, imageStore }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
