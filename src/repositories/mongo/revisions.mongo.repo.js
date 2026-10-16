import { fromDoc, toDoc, mapDuplicateKey, bulkInsertMissing } from './util.js';

const INDEX_NAMES = { _id: 'id', pageId: 'pageRev' };

export function createRevisionsMongoRepo(Revision) {
  return {
    create: async (revision) => {
      await mapDuplicateKey(() => Revision.create(toDoc(revision)), INDEX_NAMES);
      return structuredClone(revision);
    },
    findById: async (id) => fromDoc(await Revision.findById(id).lean()),
    /** Newest first, without snapshots. */
    listByPage: async (pageId, { limit = 50, offset = 0 } = {}) => {
      const [items, total] = await Promise.all([
        Revision.find({ pageId }, { snapshot: 0 }).sort({ revNumber: -1 }).skip(offset).limit(limit).lean(),
        Revision.countDocuments({ pageId }),
      ]);
      return { items: items.map(fromDoc), total };
    },
    deleteByPage: async (pageId) => {
      await Revision.deleteMany({ pageId });
    },
    bulkImport: (revisions) => bulkInsertMissing(Revision, revisions.map((r) => toDoc(r))),
  };
}
