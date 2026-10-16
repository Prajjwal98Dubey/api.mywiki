import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  slugKey,
  suggestFreeSlug,
  uniqueSlug,
  randomSlugSuffix,
  isReservedSlug,
  SLUG_MAX_LENGTH,
} from '../src/lib/slug.js';

// Keep these cases identical to the client's slugify tests (spec §6.4).
const CASES = [
  ['Ram Singh', 'ram-singh'],
  ['ram  singh', 'ram-singh'],
  ['  Ram Singh  ', 'ram-singh'],
  ['Ram\t\nSingh', 'ram-singh'],
  ['Jane_Doe', 'jane-doe'],
  ['jane-doe', 'jane-doe'],
  ['Jean-Luc Picard', 'jean-luc-picard'],
  ["O'Brien (actor)", 'obrien-actor'],
  ['O’Brien', 'obrien'],
  ['Dr. Jane Doe, Jr.', 'dr-jane-doe-jr'],
  ['Jane <script>Doe', 'jane-script-doe'],
  ['Jane/Doe?#&', 'jane-doe'],
  ['--Ram -- Singh--', 'ram-singh'],
  ['Élodie Dupont', 'élodie-dupont'],
  ['café', 'café'], // decomposed é → NFC
  ['प्रज्ज्वल दुबे', 'प्रज्ज्वल-दुबे'],
  ['Louis XIV 1638', 'louis-xiv-1638'],
  ['!!!', ''],
  ['', ''],
  ['x'.repeat(150), 'x'.repeat(SLUG_MAX_LENGTH)],
  [`${'a'.repeat(SLUG_MAX_LENGTH - 1)} b`, 'a'.repeat(SLUG_MAX_LENGTH - 1)], // no trailing "-" after the cut
];

for (const [input, expected] of CASES) {
  test(`slugify(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
    assert.equal(slugify(input), expected);
  });
}

test('slugify is idempotent on its output (so suffixed slugs survive lookups)', () => {
  for (const [input] of CASES) assert.equal(slugify(slugify(input)), slugify(input));
  assert.equal(slugify('ram-singh-1rqdasr3r'), 'ram-singh-1rqdasr3r');
});

test('slugKey is case-insensitive', () => {
  assert.equal(slugKey('Ram-Singh'), slugKey('ram-singh'));
});

test('randomSlugSuffix: 9 chars of [a-z0-9]', () => {
  for (let i = 0; i < 50; i++) assert.match(randomSlugSuffix(), /^[a-z0-9]{9}$/);
});

test('uniqueSlug: base when free, base-<suffix> when taken or reserved', async () => {
  const taken = new Set(['ram-singh']);
  const isTaken = (s) => taken.has(s);
  assert.equal(await uniqueSlug('sita-devi', isTaken), 'sita-devi');
  assert.match(await uniqueSlug('ram-singh', isTaken), /^ram-singh-[a-z0-9]{9}$/);
  assert.match(await uniqueSlug('login', isTaken), /^login-[a-z0-9]{9}$/);
  assert.match(await uniqueSlug('', isTaken), /^page-[a-z0-9]{9}$/);
  assert.match(await suggestFreeSlug('ram-singh', isTaken), /^ram-singh-[a-z0-9]{9}$/);
});

test('reserved slugs cover the frontend routes', () => {
  // Exactly the list in spec §6.4.
  const spec = 'api uploads wiki create search random login logout register my-pages settings help about admin assets static src node_modules';
  for (const s of spec.split(' ')) {
    assert.ok(isReservedSlug(s), s);
  }
  assert.ok(!isReservedSlug('ram-singh'));
});
