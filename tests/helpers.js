import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { createRepositories } from '../src/repositories/index.js';
import { createApp } from '../src/app.js';

/**
 * `npm run test:mongo` sets TEST_STORAGE_DRIVER=mongo: every test file then gets its own
 * throwaway database (mywiki_test_<random>) on TEST_MONGODB_URI (or MONGODB_URI), dropped on cleanup.
 */
const USE_MONGO = process.env.TEST_STORAGE_DRIVER === 'mongo';

function mongoTestEnv() {
  const uri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('TEST_STORAGE_DRIVER=mongo needs TEST_MONGODB_URI or MONGODB_URI');
  return {
    STORAGE_DRIVER: 'mongo',
    MONGODB_URI: uri,
    DB_PASSWORD: process.env.DB_PASSWORD,
    MONGODB_DB_NAME: `mywiki_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

/** Builds an app backed by a fresh temp data/upload dir (or a fresh Mongo database). */
export async function createTestApp(overrides = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mywiki-test-'));
  const config = loadConfig(
    { NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret', ...(USE_MONGO ? mongoTestEnv() : {}) },
    {
      dataDir: path.join(tmp, 'data'),
      uploadDir: path.join(tmp, 'uploads'),
      bcryptRounds: 4, // fast tests; production uses 12
      rateLimit: { enabled: false },
      ...overrides,
    },
  );
  const repos = await createRepositories(config);
  const app = createApp({ repos, config });
  return {
    app,
    repos,
    config,
    tmp,
    agent: () => request.agent(app),
    cleanup: async () => {
      if (repos.driver === 'mongo') await repos.connection.dropDatabase();
      await repos.close();
      await fs.rm(tmp, { recursive: true, force: true });
    },
  };
}

let counter = 0;
/** Registers a fresh user on `agent` (cookie kept) and returns { user, credentials }. */
export async function registerUser(agent, overrides = {}) {
  counter += 1;
  const credentials = {
    username: `user_${counter}_${Math.random().toString(36).slice(2, 7)}`,
    email: `user${counter}_${Math.random().toString(36).slice(2, 7)}@example.com`,
    password: 'password123',
    ...overrides,
  };
  const res = await agent.post('/api/auth/register').send(credentials);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: res.body.user, credentials };
}

/** A valid PageInput resembling spec §7.7. */
export function samplePageInput(overrides = {}) {
  return {
    title: 'Jane Doe',
    shortDescription: 'Indian software engineer (born 1998)',
    infobox: {
      name: '',
      image: null,
      birthDate: '1998-03-15',
      birthPlace: 'Mumbai, India',
      deathDate: null,
      deathPlace: '',
      fields: [
        { label: 'Occupation', value: 'Software engineer' },
        { label: 'Alma mater', value: '[[IIT Bombay]]' },
      ],
    },
    lead: "'''Jane Doe''' (born 15 March 1998) is an Indian software engineer.{{cite|r1}}",
    sections: [
      { heading: 'Early life and education', level: 2, content: 'Doe was born in [[Mumbai]].{{cite|r1}}' },
      { heading: 'Career', level: 2, content: 'In 2020 she joined a startup.{{cite|r2}}\n\n* Built X\n* Led Y' },
      { heading: 'Open source', level: 3, content: 'She maintains tools.' },
    ],
    references: [
      { id: 'r1', type: 'web', title: 'Meet Jane Doe', url: 'https://example.com/jane', publisher: 'Example News', date: '2024-05-01', accessDate: '2026-10-15' },
      { id: 'r2', type: 'news', title: 'Startup hires', url: 'https://example.com/news', publisher: 'Daily Example', date: '2020-02-10', accessDate: '2026-10-15' },
    ],
    seeAlso: ['John_Doe'],
    externalLinks: [{ label: 'Official website', url: 'https://janedoe.dev' }],
    categories: ['Living people', '1998 births'],
    ...overrides,
  };
}

/** Content fields only (what PUT needs besides baseRevisionId/editSummary). */
export function contentOf(page) {
  const { title, shortDescription, infobox, lead, sections, references, seeAlso, externalLinks, categories } = page;
  return { title, shortDescription, infobox, lead, sections, references, seeAlso, externalLinks, categories };
}

export function sortedKeys(obj) {
  return Object.keys(obj).sort();
}
