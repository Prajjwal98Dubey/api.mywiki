import { JsonCollection } from './JsonCollection.js';
import { slugKey } from '../../lib/slug.js';
import { visibilityOf } from '../../lib/visibility.js';

const SORTERS = {
  recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
};

export async function createPagesJsonRepo(dataDir) {
  const col = await new JsonCollection({
    dir: dataDir,
    name: 'pages',
    uniqueIndexes: { slugKey: (p) => slugKey(p.slug) },
  }).init();

  const copy = (doc) => structuredClone(doc);
  /** Live docs whose visibility is in `visibility` (all docs when omitted). */
  const matching = (visibility) => {
    const all = [...col.values()];
    return visibility ? all.filter((p) => visibility.includes(visibilityOf(p))) : all;
  };

  return {
    collection: col,
    create: async (page) => col.insert(page),
    findById: async (id) => col.get(id),
    findBySlug: async (slug) => col.findByIndex('slugKey', slugKey(slug)),
    update: async (id, patch) => col.update(id, patch),
    delete: async (id) => {
      await col.delete(id);
    },
    list: async ({ sort = 'recent', limit = 10, offset = 0, visibility } = {}) => {
      const all = matching(visibility).sort(SORTERS[sort] ?? SORTERS.recent);
      return { items: all.slice(offset, offset + limit).map(copy), total: all.length };
    },
    listByOwner: async (ownerId) =>
      [...col.values()].filter((p) => p.ownerId === ownerId).sort(SORTERS.updated).map(copy),
    count: async ({ visibility } = {}) => (visibility ? matching(visibility).length : col.size),
    random: async ({ visibility } = {}) => {
      const all = matching(visibility);
      return all.length ? copy(all[Math.floor(Math.random() * all.length)]) : null;
    },
    /** Returns the subset of `slugs` (as given) that exist. */
    existingSlugs: async (slugs) =>
      new Set(slugs.filter((s) => col.hasIndexKey('slugKey', slugKey(s)))),
    /** JSON driver: full scan; the search service ranks the results. */
    searchCandidates: async (_q, { visibility } = {}) => matching(visibility).map(copy),
  };
}
