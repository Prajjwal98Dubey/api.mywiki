/**
 * Raised by every storage driver when a unique index rejects a write.
 * `index` is the logical index name the services switch on:
 * users → "emailLower" | "usernameLower", pages → "slugKey", revisions → "pageRev".
 */
export class DuplicateKeyError extends Error {
  constructor(index, key) {
    super(`Duplicate key for unique index "${index}": ${key}`);
    this.name = 'DuplicateKeyError';
    this.index = index;
    this.key = key;
  }
}
