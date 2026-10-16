import mongoose from 'mongoose';
import { defineModels } from './models.js';

/**
 * Opens a dedicated connection (not the mongoose global one, so tests and
 * scripts can hold several), registers the models and makes sure every index
 * exists before the app accepts writes — unique indexes back the
 * EMAIL_TAKEN / USERNAME_TAKEN / slug guarantees.
 */
export async function connectMongo({ uri, dbName }) {
  const conn = mongoose.createConnection(uri, {
    dbName,
    autoIndex: false, // indexes are created explicitly below
    ignoreUndefined: true, // like JSON.stringify: undefined fields are omitted, not stored as null
    serverSelectionTimeoutMS: 10_000,
    appName: 'mywiki-server',
  });
  try {
    await conn.asPromise();
  } catch (err) {
    await conn.close().catch(() => {});
    throw new Error(`Could not connect to MongoDB (${redactUri(uri)}, db "${dbName}"): ${err.message}`, { cause: err });
  }

  const models = defineModels(conn);
  await Promise.all(Object.values(models).map((m) => m.createIndexes()));
  return { conn, models };
}

/** Hides the password when a URI is printed. */
export function redactUri(uri) {
  return String(uri).replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
}
