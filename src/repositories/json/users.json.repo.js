import { JsonCollection } from './JsonCollection.js';

export async function createUsersJsonRepo(dataDir) {
  const col = await new JsonCollection({
    dir: dataDir,
    name: 'users',
    uniqueIndexes: {
      emailLower: (u) => u.email.toLowerCase(),
      usernameLower: (u) => u.username.toLowerCase(),
    },
  }).init();

  return {
    collection: col,
    create: async (user) => col.insert(user),
    findById: async (id) => col.get(id),
    findByEmail: async (email) => col.findByIndex('emailLower', String(email).toLowerCase()),
    findByUsername: async (username) => col.findByIndex('usernameLower', String(username).toLowerCase()),
  };
}
