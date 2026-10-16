import crypto from 'node:crypto';
import { conflict, notFound, PAGE_NOT_FOUND_MESSAGE } from '../lib/errors.js';
import { slugify, slugKey, isReservedSlug, uniqueSlug } from '../lib/slug.js';
import { collectInternalLinkSlugs, toFlatText, truncateAtWord } from '../lib/wikitext.js';
import { toOwner, toPageSummary, toPublicPage, toSnapshot, snapshotSize } from '../lib/serialize.js';
import { createKeyedMutex } from '../lib/keyedMutex.js';
import { DuplicateKeyError } from '../repositories/index.js';
import { DISCOVERABLE, DEFAULT_VISIBILITY } from '../lib/visibility.js';

export const EXCERPT_LENGTH = 300;

export function createPagesService({ repos }) {
  // Serializes check-then-write sequences per page (edit conflicts) and per slug (creation).
  const withLock = createKeyedMutex();

  // ---- helpers --------------------------------------------------------------

  /** `{ slug: boolean }` for every internal link target in the content. */
  async function computeLinkStatus(content) {
    const slugs = collectInternalLinkSlugs(content);
    if (slugs.length === 0) return {};
    const existing = await repos.pages.existingSlugs(slugs);
    return Object.fromEntries(slugs.map((s) => [s, existing.has(s)]));
  }

  async function isSlugTaken(slug) {
    return Boolean(await repos.pages.findBySlug(slug));
  }

  /** Validated input → content with section ids assigned. */
  function normalizeContent(input) {
    const content = toSnapshot(input);
    content.sections = content.sections.map((s) => ({
      id: s.id || `s-${crypto.randomUUID()}`,
      heading: s.heading,
      level: s.level,
      content: s.content,
    }));
    content.categories = [...new Set(content.categories)];
    return content;
  }

  async function pageResponse(page, viewer) {
    return {
      page: toPublicPage(page),
      linkStatus: await computeLinkStatus(page),
      canEdit: Boolean(viewer && viewer.id === page.ownerId),
    };
  }

  /**
   * Writes new content as a revision. Returns the updated page, or the
   * unchanged page when the content is identical (null edit).
   * Callers must hold the page lock.
   */
  async function commitRevision(page, content, author, editSummary) {
    const snapshot = toSnapshot(content);
    const current = page.currentRevisionId ? await repos.revisions.findById(page.currentRevisionId) : null;
    if (current && JSON.stringify(current.snapshot) === JSON.stringify(snapshot)) return page;

    const size = snapshotSize(snapshot);
    const now = new Date().toISOString();
    const revision = await repos.revisions.create({
      id: crypto.randomUUID(),
      pageId: page.id,
      revNumber: (current?.revNumber ?? 0) + 1,
      authorId: author.id,
      authorUsername: author.username,
      editSummary,
      size,
      sizeDelta: current ? size - current.size : size,
      snapshot,
      createdAt: now,
    });
    return repos.pages.update(page.id, {
      ...snapshot,
      currentRevisionId: revision.id,
      revisionCount: (page.revisionCount ?? 0) + 1,
      updatedAt: now,
    });
  }

  // ---- reads ----------------------------------------------------------------

  async function get(page, viewer) {
    const owner = await repos.users.findById(page.ownerId);
    return { ...(await pageResponse(page, viewer)), owner: toOwner(owner, page.ownerId) };
  }

  // Explore (recent / count / random) only ever sees discoverable pages (spec §6.5).
  async function list({ sort, limit, offset }) {
    const { items, total } = await repos.pages.list({ sort, limit, offset, visibility: DISCOVERABLE });
    return { pages: items.map(toPageSummary), total };
  }

  /** All of the owner's pages, whatever their visibility. */
  async function listMine(user) {
    const pages = await repos.pages.listByOwner(user.id);
    return { pages: pages.map(toPageSummary) };
  }

  async function count() {
    return { count: await repos.pages.count({ visibility: DISCOVERABLE }) };
  }

  async function random() {
    const page = await repos.pages.random({ visibility: DISCOVERABLE });
    return page ? { slug: page.slug } : null;
  }

  function summary(page) {
    return {
      slug: page.slug,
      title: page.title,
      shortDescription: page.shortDescription,
      excerpt: truncateAtWord(toFlatText(page.lead), EXCERPT_LENGTH),
      thumbnail: page.infobox?.image?.url ?? null,
    };
  }

  /** `available: false` when the base slug is taken, reserved or empty (create will add a suffix). */
  async function slugCheck(title) {
    const slug = slugify(title);
    const available = Boolean(slug) && !isReservedSlug(slug) && !(await isSlugTaken(slug));
    return { slug, available };
  }

  // ---- writes ---------------------------------------------------------------

  /**
   * The server assigns the slug (spec §6.4): slugify(title), or `<base>-<random>` when
   * that is taken/reserved/empty — a second "Ram Singh" becomes "ram-singh-1rqdasr3r".
   */
  async function create(input, user) {
    const base = slugify(input.title);
    const content = normalizeContent(input);

    const page = await withLock(`slug:${slugKey(base)}`, async () => {
      for (let attempt = 0; ; attempt++) {
        const slug = await uniqueSlug(base, isSlugTaken);
        const now = new Date().toISOString();
        let created;
        try {
          created = await repos.pages.create({
            id: crypto.randomUUID(),
            slug,
            ownerId: user.id,
            visibility: input.visibility ?? DEFAULT_VISIBILITY,
            ...content,
            currentRevisionId: null,
            revisionCount: 0,
            createdAt: now,
            updatedAt: now,
          });
        } catch (err) {
          if (!(err instanceof DuplicateKeyError) || attempt >= 3) throw err;
          continue; // lost a race on a suffixed slug: draw a new suffix
        }
        return withLock(`page:${created.id}`, () =>
          commitRevision(created, content, user, input.editSummary || 'Created page'),
        );
      }
    });

    return pageResponse(page, user);
  }

  /**
   * Page settings (spec §6.5): currently `visibility`. Not content, so no revision is
   * created and `updatedAt` (last content edit) is left alone.
   */
  async function updateSettings(page, { visibility }) {
    const updated = await withLock(`page:${page.id}`, async () => {
      const result = await repos.pages.update(page.id, { visibility });
      if (!result) throw notFound(PAGE_NOT_FOUND_MESSAGE);
      return result;
    });
    return { page: toPublicPage(updated) };
  }

  async function update(page, input, user) {
    const updated = await withLock(`page:${page.id}`, async () => {
      const fresh = await repos.pages.findById(page.id);
      if (!fresh) throw notFound(PAGE_NOT_FOUND_MESSAGE);
      if (input.baseRevisionId !== fresh.currentRevisionId) {
        throw conflict('EDIT_CONFLICT', 'Someone else has edited this page since you started editing it', {
          currentRevisionId: fresh.currentRevisionId,
        });
      }
      return commitRevision(fresh, normalizeContent(input), user, input.editSummary);
    });
    return pageResponse(updated, user);
  }

  /** Applies an existing snapshot as a new revision (restore). No baseRevisionId check. */
  async function applySnapshot(page, snapshot, user, editSummary) {
    const updated = await withLock(`page:${page.id}`, async () => {
      const fresh = await repos.pages.findById(page.id);
      if (!fresh) throw notFound(PAGE_NOT_FOUND_MESSAGE);
      return commitRevision(fresh, toSnapshot(snapshot), user, editSummary);
    });
    return pageResponse(updated, user);
  }

  async function remove(page) {
    await withLock(`page:${page.id}`, async () => {
      await repos.revisions.deleteByPage(page.id);
      await repos.pages.delete(page.id);
    });
  }

  return {
    computeLinkStatus,
    get,
    list,
    listMine,
    count,
    random,
    summary,
    slugCheck,
    create,
    update,
    updateSettings,
    applySnapshot,
    remove,
  };
}
