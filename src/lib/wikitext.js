// Server-side helpers for WikiLite markup (spec §5). The server never renders
// markup; it only derives plain text, internal link targets and citation ids.

import { normalizeTarget } from './slug.js';

const INTERNAL_LINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*?))?\]\]/g;
const EXTERNAL_LINK = /\[(https?:\/\/[^\s\]]+)(?:[ \t]+([^\]\n]*))?\]/g;
const CITE = /\{\{cite\|([^{}|\n]*)\}\}/g;

/** Converts WikiLite to plain text: markup removed, paragraphs separated by "\n\n". */
export function toPlainText(text) {
  if (!text) return '';
  let s = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(CITE, '')
    .replace(INTERNAL_LINK, (_m, target, label) => (label !== undefined && label.trim() ? label : target).trim())
    .replace(EXTERNAL_LINK, (_m, url, label) => (label && label.trim() ? label.trim() : url))
    .replace(/'''(.+?)'''/g, '$1')
    .replace(/''(.+?)''/g, '$1');

  s = s
    .split('\n')
    .map((line) => line.replace(/^[*#] /, '').trim())
    .join('\n');

  return s
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Single-line version, handy for excerpts, snippets and search. */
export function toFlatText(text) {
  return toPlainText(text).replace(/\s+/g, ' ').trim();
}

/** Raw targets of every `[[Target]]` / `[[Target|label]]`, in order of appearance. */
export function extractInternalLinks(text) {
  if (!text) return [];
  return Array.from(String(text).matchAll(INTERNAL_LINK), (m) => m[1].trim()).filter(Boolean);
}

/** Every `{{cite|id}}` id, in order of appearance (duplicates kept). */
export function extractCiteIds(text) {
  if (!text) return [];
  return Array.from(String(text).matchAll(CITE), (m) => m[1]);
}

/** Truncates at a word boundary, appending "…" when shortened. */
export function truncateAtWord(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.]+$/, '') + '…';
}

/** All content strings of a page/snapshot that may contain internal links. */
export function collectLinkSources(content) {
  return [
    content.lead,
    ...(content.sections ?? []).map((s) => s.content),
    ...(content.infobox?.fields ?? []).map((f) => f.value),
    content.infobox?.birthPlace,
    content.infobox?.deathPlace,
    content.infobox?.image?.caption,
  ].filter(Boolean);
}

/** Unique normalized slugs of every internal link target in a page/snapshot (incl. See also). */
export function collectInternalLinkSlugs(content) {
  const slugs = new Set();
  for (const source of collectLinkSources(content)) {
    for (const target of extractInternalLinks(source)) {
      const slug = normalizeTarget(target);
      if (slug) slugs.add(slug);
    }
  }
  for (const entry of content.seeAlso ?? []) {
    const slug = normalizeTarget(entry);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

/** Plain text of the whole article body (lead + sections + infobox values) for search. */
export function pageBodyText(content) {
  const parts = [
    content.lead,
    ...(content.sections ?? []).flatMap((s) => [s.heading, s.content]),
    ...(content.infobox?.fields ?? []).map((f) => f.value),
  ];
  return parts.map(toFlatText).filter(Boolean).join(' ');
}
