// npm run migrate:json-to-mongo
//
// Copies users, identities, pages and revisions from the JSON files in DATA_DIR into the MongoDB
// database at MONGODB_URI / MONGODB_DB_NAME, keeping every id. Idempotent: documents whose
// id already exists in Mongo are skipped, so it is safe to run more than once.
// Works whatever STORAGE_DRIVER is set to; only MONGODB_URI needs to be filled in.

import { loadConfig } from '../src/config/env.js';
import { createRepositories } from '../src/repositories/index.js';
import { redactUri } from '../src/repositories/mongo/connection.js';

const config = loadConfig({ ...process.env, STORAGE_DRIVER: 'mongo' });
const source = await createRepositories({ ...config, storageDriver: 'json' });
const target = await createRepositories(config);

console.log(`Migrating ${config.dataDir}`);
console.log(`       → ${redactUri(config.mongodbUri)} (db "${config.mongodbDbName}")`);

let failed = false;
try {
  // Users first (then their identities), then pages, then revisions, so references always point at existing docs.
  for (const name of ['users', 'identities', 'pages', 'revisions']) {
    const docs = [...source[name].collection.values()].map((d) => structuredClone(d));
    const { inserted, skipped, conflicts } = await target[name].bulkImport(docs);
    console.log(`  ${name.padEnd(9)} ${docs.length} in JSON → ${inserted} inserted, ${skipped} already present`);
    for (const c of conflicts) {
      failed = true;
      console.error(`    ! ${name} ${c.id}: ${c.message}`);
    }
  }
} finally {
  await Promise.all([source.close(), target.close()]);
}

if (failed) {
  console.error('Some documents clash with different documents already in Mongo (same email/username/slug). They were not copied.');
  process.exit(1);
}
console.log('Done.');
