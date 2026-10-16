// Shapes returned by the API (spec §6–7). Never return raw storage docs for users.
import { visibilityOf } from './visibility.js';

export const CONTENT_FIELDS = [
  'title',
  'shortDescription',
  'infobox',
  'lead',
  'sections',
  'references',
  'seeAlso',
  'externalLinks',
  'categories',
];

/** Public user: { id, username, createdAt } (+ email for the current user on /api/auth/*). */
export function toPublicUser(user, { includeEmail = false } = {}) {
  if (!user) return null;
  const out = { id: user.id, username: user.username, createdAt: user.createdAt };
  if (includeEmail) out.email = user.email;
  return out;
}

export function toOwner(user, fallbackId) {
  return user ? { id: user.id, username: user.username } : { id: fallbackId, username: null };
}

/** Page document as returned by the API (drops any internal fields). */
export function toPublicPage(page) {
  return {
    id: page.id,
    slug: page.slug,
    ownerId: page.ownerId,
    visibility: visibilityOf(page),
    ...toSnapshot(page),
    currentRevisionId: page.currentRevisionId,
    revisionCount: page.revisionCount,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

export function toPageSummary(page) {
  return {
    slug: page.slug,
    title: page.title,
    shortDescription: page.shortDescription,
    thumbnail: page.infobox?.image?.url ?? null,
    visibility: visibilityOf(page),
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
  };
}

/** Content snapshot with a fixed key order, so JSON.stringify is comparable. */
export function toSnapshot(content) {
  const snap = {};
  for (const key of CONTENT_FIELDS) snap[key] = structuredClone(content[key]);
  return snap;
}

export function snapshotSize(snapshot) {
  return Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
}

export function toRevisionMeta(revision) {
  const { snapshot: _snapshot, ...meta } = revision;
  return meta;
}
