import fs from 'node:fs/promises';
import path from 'node:path';
import { DuplicateKeyError } from '../errors.js';

export { DuplicateKeyError };

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A collection of documents kept in memory (Map id → doc) and persisted to
 * `<dir>/<name>.json`.
 *
 * - Mutations apply to memory synchronously, so checks + writes cannot interleave.
 * - Persistence is serialized through a promise queue and coalesced: a burst of
 *   writes produces as few file writes as possible, and each mutation's promise
 *   resolves only once its change is on disk.
 * - Files are written atomically (tmp file + rename, retried on Windows locks).
 * - Optional unique indexes: { name: (doc) => key | null }.
 *
 * Reads return deep copies, never references into the store.
 */
export class JsonCollection {
  constructor({ dir, name, uniqueIndexes = {} }) {
    this.dir = dir;
    this.name = name;
    this.file = path.join(dir, `${name}.json`);
    this.docs = new Map();
    this.indexDefs = uniqueIndexes;
    this.indexes = new Map(Object.keys(uniqueIndexes).map((k) => [k, new Map()]));
    this._chain = Promise.resolve();
    this._dirty = false;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this._writeFile('[]\n');
      raw = '[]';
    }
    let list;
    try {
      list = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Corrupt data file ${this.file}: ${err.message}`);
    }
    if (!Array.isArray(list)) throw new Error(`Data file ${this.file} must contain a JSON array`);

    this.docs.clear();
    for (const idx of this.indexes.values()) idx.clear();
    for (const doc of list) {
      this._checkUnique(doc, null);
      this.docs.set(doc.id, doc);
      this._index(doc);
    }
    return this;
  }

  // ---- reads (copies) -------------------------------------------------------

  get(id) {
    const doc = this.docs.get(id);
    return doc ? structuredClone(doc) : null;
  }

  findByIndex(index, key) {
    const id = this.indexes.get(index)?.get(key);
    return id ? this.get(id) : null;
  }

  hasIndexKey(index, key) {
    return this.indexes.get(index)?.has(key) ?? false;
  }

  /** Iterates live docs without copying. Callers must not mutate them. */
  values() {
    return this.docs.values();
  }

  get size() {
    return this.docs.size;
  }

  // ---- writes ---------------------------------------------------------------

  async insert(doc) {
    if (!doc?.id) throw new Error('Document must have an id');
    if (this.docs.has(doc.id)) throw new DuplicateKeyError('id', doc.id);
    const stored = structuredClone(doc);
    this._checkUnique(stored, null);
    this.docs.set(stored.id, stored);
    this._index(stored);
    await this._persist();
    return structuredClone(stored);
  }

  async update(id, patch) {
    const current = this.docs.get(id);
    if (!current) return null;
    const next = { ...current, ...structuredClone(patch), id };
    this._checkUnique(next, id);
    this._unindex(current);
    this.docs.set(id, next);
    this._index(next);
    await this._persist();
    return structuredClone(next);
  }

  async delete(id) {
    const current = this.docs.get(id);
    if (!current) return false;
    this._unindex(current);
    this.docs.delete(id);
    await this._persist();
    return true;
  }

  async deleteWhere(predicate) {
    let removed = 0;
    for (const doc of [...this.docs.values()]) {
      if (predicate(doc)) {
        this._unindex(doc);
        this.docs.delete(doc.id);
        removed++;
      }
    }
    if (removed) await this._persist();
    return removed;
  }

  /** Resolves when every queued write has hit the disk. */
  flush() {
    return this._chain;
  }

  // ---- internals ------------------------------------------------------------

  _checkUnique(doc, selfId) {
    for (const [name, keyOf] of Object.entries(this.indexDefs)) {
      const key = keyOf(doc);
      if (key == null) continue;
      const owner = this.indexes.get(name).get(key);
      if (owner && owner !== selfId) throw new DuplicateKeyError(name, key);
    }
  }

  _index(doc) {
    for (const [name, keyOf] of Object.entries(this.indexDefs)) {
      const key = keyOf(doc);
      if (key != null) this.indexes.get(name).set(key, doc.id);
    }
  }

  _unindex(doc) {
    for (const [name, keyOf] of Object.entries(this.indexDefs)) {
      const key = keyOf(doc);
      if (key != null && this.indexes.get(name).get(key) === doc.id) this.indexes.get(name).delete(key);
    }
  }

  _persist() {
    this._dirty = true;
    const p = this._chain.then(() => this._flushIfDirty());
    this._chain = p.catch(() => {});
    return p;
  }

  async _flushIfDirty() {
    if (!this._dirty) return;
    this._dirty = false;
    const json = JSON.stringify([...this.docs.values()], null, 2) + '\n';
    try {
      await this._writeFile(json);
    } catch (err) {
      this._dirty = true; // retry on the next write
      throw err;
    }
  }

  async _writeFile(contents) {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, contents, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, this.file);
        return;
      } catch (err) {
        if (!RETRYABLE_RENAME_CODES.has(err.code) || attempt >= 5) throw err;
        await sleep(20 * 2 ** attempt);
      }
    }
  }
}
