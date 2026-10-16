import { fromDoc, toDoc, mapDuplicateKey, bulkInsertMissing } from './util.js';

const INDEX_NAMES = { _id: 'id', emailLower: 'emailLower', usernameLower: 'usernameLower' };

const internalFields = (u) => ({
  emailLower: String(u.email).toLowerCase(),
  usernameLower: String(u.username).toLowerCase(),
});

export function createUsersMongoRepo(User) {
  return {
    create: async (user) => {
      await mapDuplicateKey(() => User.create(toDoc(user, internalFields(user))), INDEX_NAMES);
      return structuredClone(user);
    },
    findById: async (id) => fromDoc(await User.findById(id).lean()),
    findByEmail: async (email) => fromDoc(await User.findOne({ emailLower: String(email).toLowerCase() }).lean()),
    findByUsername: async (username) =>
      fromDoc(await User.findOne({ usernameLower: String(username).toLowerCase() }).lean()),
    bulkImport: (users) => bulkInsertMissing(User, users.map((u) => toDoc(u, internalFields(u)))),
  };
}
