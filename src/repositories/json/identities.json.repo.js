import { JsonCollection } from './JsonCollection.js';

/** External sign-in identities (spec §6.6): one per (provider, providerUserId). */
export async function createIdentitiesJsonRepo(dataDir) {
  const col = await new JsonCollection({
    dir: dataDir,
    name: 'identities',
    uniqueIndexes: { providerUser: (i) => `${i.provider}#${i.providerUserId}` },
  }).init();

  return {
    collection: col,
    create: async (identity) => col.insert(identity),
    findByProviderUser: async (provider, providerUserId) =>
      col.findByIndex('providerUser', `${provider}#${providerUserId}`),
    update: async (id, patch) => col.update(id, patch),
    listByUser: async (userId) =>
      [...col.values()].filter((i) => i.userId === userId).map((i) => structuredClone(i)),
  };
}
