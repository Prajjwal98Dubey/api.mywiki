import { fromDoc, toDoc, mapDuplicateKey, bulkInsertMissing } from './util.js';

const INDEX_NAMES = { _id: 'id', provider: 'providerUser' };

/** External sign-in identities (spec §6.6): one per (provider, providerUserId). */
export function createIdentitiesMongoRepo(Identity) {
  return {
    create: async (identity) => {
      await mapDuplicateKey(() => Identity.create(toDoc(identity)), INDEX_NAMES);
      return structuredClone(identity);
    },
    findByProviderUser: async (provider, providerUserId) =>
      fromDoc(await Identity.findOne({ provider, providerUserId }).lean()),
    update: async (id, patch) => {
      // eslint-disable-next-line no-unused-vars
      const { id: _id, ...fields } = structuredClone(patch);
      return fromDoc(
        await Identity.findOneAndUpdate({ _id: id }, { $set: fields }, { returnDocument: 'after' }).lean(),
      );
    },
    listByUser: async (userId) => (await Identity.find({ userId }).sort({ createdAt: 1 }).lean()).map(fromDoc),
    bulkImport: (identities) => bulkInsertMissing(Identity, identities.map((i) => toDoc(i))),
  };
}
