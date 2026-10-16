import { slugify } from '../lib/slug.js';
import { canView } from '../lib/visibility.js';
import { notFound, unauthenticated, forbidden, PAGE_NOT_FOUND_MESSAGE } from '../lib/errors.js';

/** Resolves `:slug` → `req.page`, or 404. The param is slugified, so "Ram Singh" / "Ram_Singh" find "ram-singh". */
export function loadPage(repos) {
  return async (req, _res, next) => {
    const slug = slugify(req.params.slug);
    const page = slug ? await repos.pages.findBySlug(slug) : null;
    if (!page || !canView(page, req.user)) return next(notFound(PAGE_NOT_FOUND_MESSAGE));
    req.page = page;
    next();
  };
}

export function requireOwner(req, _res, next) {
  if (!req.user) return next(unauthenticated());
  if (req.page.ownerId !== req.user.id) return next(forbidden('Only the owner of this page can do that'));
  next();
}
