import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPlainText,
  toFlatText,
  extractInternalLinks,
  extractCiteIds,
  truncateAtWord,
  collectInternalLinkSlugs,
} from '../src/lib/wikitext.js';

test('toPlainText strips markup', () => {
  const src =
    "'''Jane Doe''' is an ''Indian'' [[software engineer|engineer]] from [[Mumbai]].{{cite|r1}}\n\n" +
    '* Built [https://example.com X]\n# Led [https://y.example]\n\n<b>raw</b>';
  assert.equal(
    toPlainText(src),
    'Jane Doe is an Indian engineer from Mumbai.\n\nBuilt X Led https://y.example\n\n<b>raw</b>',
  );
});

test('toFlatText collapses to one line', () => {
  assert.equal(toFlatText('a\n\nb\nc'), 'a b c');
});

test('non-http external links stay literal', () => {
  assert.equal(toPlainText('[javascript:alert(1) click]'), '[javascript:alert(1) click]');
});

test('extractInternalLinks', () => {
  assert.deepEqual(extractInternalLinks('[[A]] and [[b c|label]] and [[ D ]] and [[|x]] [not]'), ['A', 'b c', 'D']);
});

test('extractCiteIds keeps order and duplicates', () => {
  assert.deepEqual(extractCiteIds('x{{cite|r1}} y{{cite|r2}} z{{cite|r1}} {{cite r3}}'), ['r1', 'r2', 'r1']);
});

test('truncateAtWord', () => {
  assert.equal(truncateAtWord('short', 300), 'short');
  const out = truncateAtWord('alpha beta gamma delta', 13);
  assert.equal(out, 'alpha beta…');
});

test('collectInternalLinkSlugs covers lead, sections, infobox and see also', () => {
  const slugs = collectInternalLinkSlugs({
    lead: '[[jane doe]]',
    sections: [{ content: '[[Mumbai|the city]]' }],
    infobox: { fields: [{ label: 'Alma mater', value: '[[IIT Bombay]]' }], birthPlace: '[[Pune]]' },
    seeAlso: ['John Doe', 'Mumbai'],
  });
  assert.deepEqual(slugs.sort(), ['iit-bombay', 'jane-doe', 'john-doe', 'mumbai', 'pune']);
});
