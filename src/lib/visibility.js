// Page visibility — spec §6.5. The one place that decides who can find or open a page.

/** Values the API accepts today. */
export const VISIBILITIES = Object.freeze(['public', 'unlisted']);
/** Reserved for future custom access (owner + people they grant); rejected for now. */
export const FUTURE_VISIBILITIES = Object.freeze(['private']);
/** Visibilities that appear in explore (recent / count / random) and search. */
export const DISCOVERABLE = Object.freeze(['public']);

export const DEFAULT_VISIBILITY = 'public';

/** Pages stored before the field existed are public. */
export const visibilityOf = (page) => page?.visibility ?? DEFAULT_VISIBILITY;

export const isDiscoverable = (page) => DISCOVERABLE.includes(visibilityOf(page));

/**
 * Whether `viewer` (user doc or null) may open the page by URL.
 * Public and unlisted pages are open to anyone with the link. Future custom access
 * ("private" + an allow-list) only needs to extend this function: loadPage turns
 * `false` into a 404, so a hidden page's existence isn't revealed.
 */
export function canView(page, _viewer) {
  return VISIBILITIES.includes(visibilityOf(page));
}
