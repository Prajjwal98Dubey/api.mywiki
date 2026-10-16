import { pageBodyText } from '../lib/wikitext.js';
import { snapshotSize, toSnapshot } from '../lib/serialize.js';
import { DISCOVERABLE } from '../lib/visibility.js';

export const SNIPPET_LENGTH = 160;
const BODY_HITS_CAP = 10;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeQuery = (q) => q.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const tokenize = (q) => [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];

/** Splits text into [{ text, match }] segments for every regex hit. */
export function toSegments(text, regex) {
  const segments = [];
  const push = (t, match) => {
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last && last.match === match) last.text += t;
    else segments.push({ text: t, match });
  };
  let pos = 0;
  for (const m of text.matchAll(regex)) {
    if (!m[0]) continue;
    push(text.slice(pos, m.index), false);
    push(m[0], true);
    pos = m.index + m[0].length;
  }
  push(text.slice(pos), false);
  return segments;
}

/** ~160 chars of `body` around the first hit, cut at word boundaries. */
export function buildSnippet(body, regex, maxLength = SNIPPET_LENGTH) {
  if (!body) return [];
  const first = regex ? new RegExp(regex.source, regex.flags.replace('g', '')).exec(body) : null;

  let start = 0;
  if (first && first.index + first[0].length > maxLength) {
    start = Math.max(0, first.index - Math.floor(maxLength / 3));
    const nextSpace = body.indexOf(' ', start);
    if (nextSpace !== -1 && nextSpace < first.index) start = nextSpace + 1;
  }
  let end = Math.min(body.length, start + maxLength);
  if (end < body.length) {
    const lastSpace = body.lastIndexOf(' ', end);
    const minEnd = first ? first.index + first[0].length : start + 1;
    if (lastSpace >= minEnd) end = lastSpace;
  }

  let text = body.slice(start, end).trim();
  if (start > 0) text = '…' + text;
  if (end < body.length) text += '…';
  return regex ? toSegments(text, regex) : [{ text, match: false }];
}

export function createSearchService({ repos }) {
  // pageId → { updatedAt, body }; recomputed when the page changes.
  const bodyCache = new Map();

  function bodyOf(page) {
    const cached = bodyCache.get(page.id);
    if (cached && cached.updatedAt === page.updatedAt) return cached.body;
    const body = pageBodyText(page);
    bodyCache.set(page.id, { updatedAt: page.updatedAt, body });
    return body;
  }

  async function suggest(q, limit) {
    const query = normalizeQuery(q);
    if (!query) return { results: [] };
    const pages = await repos.pages.searchCandidates(query, { visibility: DISCOVERABLE });
    const rankOf = (title) => {
      if (title.startsWith(query)) return 0;
      if (title.split(/[\s(]+/).some((w) => w.startsWith(query))) return 1;
      return 2;
    };
    const results = pages
      .map((p) => ({ page: p, title: p.title.toLowerCase() }))
      .filter(({ title }) => title.includes(query))
      .map((x) => ({ ...x, rank: rankOf(x.title) }))
      .sort((a, b) => a.rank - b.rank || a.page.title.localeCompare(b.page.title))
      .slice(0, limit)
      .map(({ page }) => ({
        slug: page.slug,
        title: page.title,
        shortDescription: page.shortDescription,
        thumbnail: page.infobox?.image?.url ?? null,
      }));
    return { results };
  }

  async function search(q, limit, offset) {
    const query = normalizeQuery(q);
    const words = tokenize(query);
    if (!query || words.length === 0) return { results: [], total: 0 };

    const wordRegexes = words.map((w) => new RegExp(escapeRegExp(w), 'giu'));
    const anyWord = new RegExp(
      [...words].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'),
      'giu',
    );

    const pages = await repos.pages.searchCandidates(query, { visibility: DISCOVERABLE });
    const scored = [];
    for (const page of pages) {
      const title = page.title.toLowerCase();
      const desc = (page.shortDescription ?? '').toLowerCase();
      const body = bodyOf(page);

      let score = 0;
      if (title === query) score += 100;
      else if (title.startsWith(query)) score += 50;
      else if (title.includes(query)) score += 25;
      words.forEach((w, i) => {
        if (title.includes(w)) score += 10;
        if (desc.includes(w)) score += 5;
        let hits = 0;
        for (const _ of body.matchAll(wordRegexes[i])) if (++hits >= BODY_HITS_CAP) break;
        score += hits;
      });
      if (score > 0) scored.push({ page, score, body });
    }

    scored.sort((a, b) => b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt));

    const results = scored.slice(offset, offset + limit).map(({ page, body }) => ({
      slug: page.slug,
      title: page.title,
      shortDescription: page.shortDescription,
      snippet: buildSnippet(body, anyWord),
      size: snapshotSize(toSnapshot(page)),
      updatedAt: page.updatedAt,
    }));
    return { results, total: scored.length };
  }

  return { suggest, search };
}
