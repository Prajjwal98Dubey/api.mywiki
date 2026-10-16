import { createUsersJsonRepo } from './json/users.json.repo.js';
import { createPagesJsonRepo } from './json/pages.json.repo.js';
import { createRevisionsJsonRepo } from './json/revisions.json.repo.js';
import { createIdentitiesJsonRepo } from './json/identities.json.repo.js';

export { DuplicateKeyError } from './errors.js';

/**
 * Storage boundary (BACKEND_PLAN §4). Routes and services only see this
 * interface, so switching STORAGE_DRIVER needs no other code changes.
 *
 * Besides users/pages/revisions, every driver exposes:
 *   driver      "json" | "mongo"
 *   hasData()   true when any collection has documents (seed script)
 *   wipe()      deletes every user, identity, page and revision (seed --force, tests)
 *   close()     flushes / disconnects
 */
export async function createRepositories(config) {
  switch (config.storageDriver) {
    case 'json': {
      const [users, pages, revisions, identities] = await Promise.all([
        createUsersJsonRepo(config.dataDir),
        createPagesJsonRepo(config.dataDir),
        createRevisionsJsonRepo(config.dataDir),
        createIdentitiesJsonRepo(config.dataDir),
      ]);
      const all = [users, pages, revisions, identities];
      return {
        driver: 'json',
        users,
        pages,
        revisions,
        identities,
        hasData: async () => all.some((r) => r.collection.size > 0),
        wipe: async () => {
          await Promise.all(all.map((r) => r.collection.deleteWhere(() => true)));
        },
        close: async () => {
          await Promise.all(all.map((r) => r.collection.flush()));
        },
      };
    }
    case 'mongo': {
      // Imported lazily so the JSON driver never loads mongoose.
      const [
        { connectMongo },
        { createUsersMongoRepo },
        { createPagesMongoRepo },
        { createRevisionsMongoRepo },
        { createIdentitiesMongoRepo },
      ] = await Promise.all([
        import('./mongo/connection.js'),
        import('./mongo/users.mongo.repo.js'),
        import('./mongo/pages.mongo.repo.js'),
        import('./mongo/revisions.mongo.repo.js'),
        import('./mongo/identities.mongo.repo.js'),
      ]);
      const { conn, models } = await connectMongo({ uri: config.mongodbUri, dbName: config.mongodbDbName });
      const all = Object.values(models);
      return {
        driver: 'mongo',
        users: createUsersMongoRepo(models.User),
        pages: createPagesMongoRepo(models.Page),
        revisions: createRevisionsMongoRepo(models.Revision),
        identities: createIdentitiesMongoRepo(models.Identity),
        connection: conn,
        hasData: async () => (await Promise.all(all.map((m) => m.exists({})))).some(Boolean),
        wipe: async () => {
          await Promise.all(all.map((m) => m.deleteMany({})));
        },
        close: () => conn.close(),
      };
    }
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${config.storageDriver}"`);
  }
}
