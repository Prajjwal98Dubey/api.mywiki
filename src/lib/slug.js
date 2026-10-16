// Slug rules — spec §6.4. slugify/RESERVED_SLUGS must stay identical to the client implementation.
import crypto from 'node:crypto';

/** Max length of the base slug (code points). A suffix adds "-" + 9 chars. */
export const SLUG_MAX_LENGTH = 80;
export const SLUG_SUFFIX_LENGTH = 9;
/** Base used when a title has no usable characters: "page-1rqdasr3r". */
export const EMPTY_SLUG_BASE = 'page';

/**
 * App routes — pages live at the site root (mywiki.com/ram-singh), so these can never
 * be page slugs. A title that slugifies to one of these always gets a random suffix.
 */
export const RESERVED_SLUGS = new Set([
  'api', 'uploads', 'wiki', 'create', 'search', 'random', 'login', 'logout', 'register',
  'my-pages', 'settings', 'help', 'about', 'admin', 'assets', 'static', 'src', 'node_modules',
]);

/**
 * lowercase → NFC-normalize → drop apostrophes → every run of characters that are not
 * letters/marks/digits becomes "-" → trim "-" from both ends → max 80 code points.
 *   "Ram Singh" → "ram-singh",  "Jane_Doe" → "jane-doe",  "O'Brien (actor)" → "obrien-actor"
 *   "प्रज्ज्वल दुबे" → "प्रज्ज्वल-दुबे"
 */
export function slugify(input) {
  if (typeof input !== 'string') return '';
  const s = input
    .toLowerCase()
    .normalize('NFC')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(s).slice(0, SLUG_MAX_LENGTH).join('').replace(/-+$/, '');
}

/** Internal link targets (`[[ram singh]]`) are normalized with the same function. */
export const normalizeTarget = slugify;

/** Lookup key. Slugs are lowercase, so lookups are case-insensitive. */
export function slugKey(slug) {
  return String(slug ?? '').toLowerCase();
}

export const isReservedSlug = (slug) => RESERVED_SLUGS.has(slug);

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 9 random [a-z0-9] chars, e.g. "1rqdasr3r". */
export function randomSlugSuffix(length = SLUG_SUFFIX_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i++) out += SUFFIX_ALPHABET[crypto.randomInt(SUFFIX_ALPHABET.length)];
  return out;
}

/** `base-<random>` that `isTaken` reports as free. */
export async function suggestFreeSlug(base, isTaken) {
  for (;;) {
    const candidate = `${base}-${randomSlugSuffix()}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}

/** `base` itself when free and not reserved, otherwise `base-<random>` ("page-<random>" for an empty base). */
export async function uniqueSlug(base, isTaken) {
  if (!base) return suggestFreeSlug(EMPTY_SLUG_BASE, isTaken);
  if (!isReservedSlug(base) && !(await isTaken(base))) return base;
  return suggestFreeSlug(base, isTaken);
}
