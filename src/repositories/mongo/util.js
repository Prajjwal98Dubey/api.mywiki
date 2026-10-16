import { DuplicateKeyError } from '../errors.js';

/** Stored doc → the plain object the services expect: `_id` becomes `id`, internal fields dropped. */
export function fromDoc(doc) {
  if (!doc) return null;
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, emailLower, usernameLower, slugKey, plainText, ...rest } = doc;
  return { id: _id, ...rest };
}

/** App object → stored doc (`id` becomes `_id`). `extra` adds internal fields. */
export function toDoc(obj, extra = {}) {
  const { id, ...rest } = structuredClone(obj);
  return { _id: id, ...rest, ...extra };
}

/**
 * Runs `fn`, converting a Mongo E11000 into the driver-neutral DuplicateKeyError.
 * `indexNames` maps the first field of the violated index to its logical name.
 */
export async function mapDuplicateKey(fn, indexNames) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const field = Object.keys(err.keyPattern ?? {})[0] ?? '_id';
    throw new DuplicateKeyError(indexNames[field] ?? field, JSON.stringify(err.keyValue ?? {}));
  }
}

/**
 * Idempotent bulk insert used by the JSON → Mongo migration: inserts docs whose `_id`
 * is new, leaves existing ones untouched. Docs that clash on another unique index
 * (e.g. same email, different id) are reported, not inserted.
 */
export async function bulkInsertMissing(model, docs, batchSize = 500) {
  const result = { inserted: 0, skipped: 0, conflicts: [] };
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const ops = batch.map(({ _id, ...rest }) => ({
      updateOne: { filter: { _id }, update: { $setOnInsert: rest }, upsert: true },
    }));
    let res;
    try {
      res = await model.collection.bulkWrite(ops, { ordered: false });
    } catch (err) {
      if (!err.result || !err.writeErrors) throw err;
      res = err.result;
      for (const we of [].concat(err.writeErrors)) {
        result.conflicts.push({ id: batch[we.index]?._id, message: we.errmsg ?? we.err?.errmsg ?? String(we) });
      }
    }
    result.inserted += res.upsertedCount ?? 0;
    result.skipped += res.matchedCount ?? 0;
  }
  return result;
}
