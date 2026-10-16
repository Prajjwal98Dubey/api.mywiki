/**
 * In-process lock per key. Used to make read-check-write sequences atomic
 * (e.g. the baseRevisionId check + revision creation for one page).
 */
export function createKeyedMutex() {
  const tails = new Map();

  return async function withLock(key, fn) {
    const prev = tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => (release = resolve));
    const tail = prev.then(() => current);
    tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
