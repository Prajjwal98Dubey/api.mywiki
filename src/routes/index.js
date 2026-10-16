import { Router } from 'express';
import { createAuthService } from '../services/auth.service.js';
import { createPagesService } from '../services/pages.service.js';
import { createRevisionsService } from '../services/revisions.service.js';
import { createSearchService } from '../services/search.service.js';
import { createOAuthService } from '../services/oauth.service.js';
import { createOAuthProviders } from '../oauth/index.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createOAuthController } from '../controllers/oauth.controller.js';
import { createPagesController } from '../controllers/pages.controller.js';
import { createRevisionsController } from '../controllers/revisions.controller.js';
import { createSearchController } from '../controllers/search.controller.js';
import { createUploadsController } from '../controllers/uploads.controller.js';
import { authRoutes } from './auth.routes.js';
import { pagesRoutes } from './pages.routes.js';
import { revisionsRoutes } from './revisions.routes.js';
import { searchRoutes } from './search.routes.js';
import { uploadsRoutes } from './uploads.routes.js';
import { healthRoutes } from './health.routes.js';

export function createServices({ repos, config }) {
  const pagesService = createPagesService({ repos });
  return {
    authService: createAuthService({ repos, config }),
    oauthService: createOAuthService({ repos, config }),
    pagesService,
    revisionsService: createRevisionsService({ repos, pagesService }),
    searchService: createSearchService({ repos }),
  };
}

/** Builds the /api router. */
export function buildRoutes({ repos, config }) {
  const services = createServices({ repos, config });

  const authController = createAuthController({ authService: services.authService, config });
  const oauthController = createOAuthController({
    oauthService: services.oauthService,
    providers: createOAuthProviders(config),
    config,
  });
  const pagesController = createPagesController(services);
  const revisionsController = createRevisionsController(services);
  const searchController = createSearchController(services);
  const uploadsController = createUploadsController();

  const router = Router();
  router.use('/health', healthRoutes({ repos }));
  router.use('/auth', authRoutes({ authController, oauthController, config }));
  router.use(
    '/pages',
    pagesRoutes({ pagesController, repos, revisionsRouter: revisionsRoutes({ revisionsController }) }),
  );
  router.use('/search', searchRoutes({ searchController }));
  router.use('/uploads', uploadsRoutes({ uploadsController, config }));
  return router;
}
