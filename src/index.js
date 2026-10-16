import { loadConfig } from './config/env.js';
import { createRepositories } from './repositories/index.js';
import { createApp } from './app.js';

const config = loadConfig();
const repos = await createRepositories(config);
const app = createApp({ repos, config });

const server = app.listen(config.port, () => {
  console.log(`MyWiki API listening on http://localhost:${config.port} (storage: ${repos.driver}, env: ${config.env})`);
  if (!process.env.JWT_SECRET) console.warn('Warning: JWT_SECRET is not set — using an insecure development secret.');
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down…`);
  server.close();
  await repos.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
