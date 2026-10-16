import { JsonCollection } from './JsonCollection.js';
import { toRevisionMeta } from '../../lib/serialize.js';

export async function createRevisionsJsonRepo(dataDir) {
  const col = await new JsonCollection({
    dir: dataDir,
    name: 'revisions',
    uniqueIndexes: { pageRev: (r) => `${r.pageId}#${r.revNumber}` },
  }).init();

  const forPage = (pageId) =>
    [...col.values()].filter((r) => r.pageId === pageId).sort((a, b) => b.revNumber - a.revNumber);

  return {
    collection: col,
    create: async (revision) => col.insert(revision),
    findById: async (id) => col.get(id),
    /** Newest first, without snapshots. */
    listByPage: async (pageId, { limit = 50, offset = 0 } = {}) => {
      const all = forPage(pageId);
      return {
        items: all.slice(offset, offset + limit).map((r) => structuredClone(toRevisionMeta(r))),
        total: all.length,
      };
    },
    deleteByPage: async (pageId) => {
      await col.deleteWhere((r) => r.pageId === pageId);
    },
  };
}
