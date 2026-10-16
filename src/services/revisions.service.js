import { notFound } from '../lib/errors.js';
import { toOwner } from '../lib/serialize.js';

export function createRevisionsService({ repos, pagesService }) {
  async function findForPage(page, revId) {
    const revision = await repos.revisions.findById(revId);
    if (!revision || revision.pageId !== page.id) throw notFound('This revision does not exist for this page');
    return revision;
  }

  async function list(page, { limit, offset }) {
    const { items, total } = await repos.revisions.listByPage(page.id, { limit, offset });
    return { revisions: items, total };
  }

  async function get(page, revId) {
    const revision = await findForPage(page, revId);
    const owner = await repos.users.findById(page.ownerId);
    return {
      revision,
      isCurrent: revision.id === page.currentRevisionId,
      linkStatus: await pagesService.computeLinkStatus(revision.snapshot),
      owner: toOwner(owner, page.ownerId),
    };
  }

  async function restore(page, revId, user, editSummary) {
    const revision = await findForPage(page, revId);
    const summary = editSummary || `Restored revision ${revision.revNumber} by ${revision.authorUsername}`;
    return pagesService.applySnapshot(page, revision.snapshot, user, summary);
  }

  return { list, get, restore };
}
