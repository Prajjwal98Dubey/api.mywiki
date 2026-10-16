import { slugKey } from '../../lib/slug.js';
import { pageBodyText } from '../../lib/wikitext.js';
import { CONTENT_FIELDS } from '../../lib/serialize.js';
import { DEFAULT_VISIBILITY } from '../../lib/visibility.js';
import { fromDoc, toDoc, mapDuplicateKey, bulkInsertMissing } from './util.js';

const INDEX_NAMES = { _id: 'id', slugKey: 'slugKey' };
const HIDE_INTERNAL = { plainText: 0 };

const SORTS = {
  recent: { createdAt: -1, _id: 1 },
  updated: { updatedAt: -1, _id: 1 },
  title: { title: 1, _id: 1 },
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenize = (q) => [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];

const internalFields = (p) => ({ slugKey: slugKey(p.slug), plainText: pageBodyText(p) });

/**
 * `{ visibility: { $in: [...] } }`, or `{}` when no filter is given. Pages stored before the
 * field existed have none and count as the default ("public"); `$in: [null]` matches them.
 */
function visibilityFilter(visibility) {
  if (!visibility) return {};
  const values = visibility.includes(DEFAULT_VISIBILITY) ? [...visibility, null] : [...visibility];
  return { visibility: { $in: values } };
}

export function createPagesMongoRepo(Page) {
  return {
    create: async (page) => {
      await mapDuplicateKey(() => Page.create(toDoc(page, internalFields(page))), INDEX_NAMES);
      return structuredClone(page);
    },
    findById: async (id) => fromDoc(await Page.findById(id, HIDE_INTERNAL).lean()),
    findBySlug: async (slug) => fromDoc(await Page.findOne({ slugKey: slugKey(slug) }, HIDE_INTERNAL).lean()),
    update: async (id, patch) => {
      // eslint-disable-next-line no-unused-vars
      const { id: _id, ...fields } = structuredClone(patch);
      const set = { ...fields };
      if ('slug' in fields) set.slugKey = slugKey(fields.slug);
      if (CONTENT_FIELDS.some((k) => k in fields)) {
        const current = await Page.findById(id, HIDE_INTERNAL).lean();
        if (!current) return null;
        set.plainText = pageBodyText({ ...current, ...fields });
      }
      const doc = await mapDuplicateKey(
        () =>
          Page.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after', projection: HIDE_INTERNAL }).lean(),
        INDEX_NAMES,
      );
      return fromDoc(doc);
    },
    delete: async (id) => {
      await Page.deleteOne({ _id: id });
    },
    list: async ({ sort = 'recent', limit = 10, offset = 0, visibility } = {}) => {
      const filter = visibilityFilter(visibility);
      let query = Page.find(filter, HIDE_INTERNAL).sort(SORTS[sort] ?? SORTS.recent).skip(offset).limit(limit);
      if (sort === 'title') query = query.collation({ locale: 'en', strength: 1 });
      const [items, total] = await Promise.all([query.lean(), Page.countDocuments(filter)]);
      return { items: items.map(fromDoc), total };
    },
    listByOwner: async (ownerId) =>
      (await Page.find({ ownerId }, HIDE_INTERNAL).sort(SORTS.updated).lean()).map(fromDoc),
    count: async ({ visibility } = {}) => Page.countDocuments(visibilityFilter(visibility)),
    random: async ({ visibility } = {}) => {
      const [doc] = await Page.aggregate([
        { $match: visibilityFilter(visibility) },
        { $sample: { size: 1 } },
        { $project: HIDE_INTERNAL },
      ]);
      return fromDoc(doc ?? null);
    },
    /** Returns the subset of `slugs` (as given) that exist. */
    existingSlugs: async (slugs) => {
      const keys = [...new Set(slugs.map(slugKey))];
      const found = await Page.find({ slugKey: { $in: keys } }, { slugKey: 1 }).lean();
      const existing = new Set(found.map((d) => d.slugKey));
      return new Set(slugs.filter((s) => existing.has(slugKey(s))));
    },
    /**
     * Pages containing the whole query or any of its words in the title, short
     * description or body (case-insensitive substring, like the JSON driver).
     * The search service ranks them.
     */
    searchCandidates: async (q, { visibility } = {}) => {
      const terms = [...new Set([String(q).toLowerCase(), ...tokenize(String(q))])].filter(Boolean);
      if (terms.length === 0) return [];
      const or = terms.flatMap((t) => {
        const re = new RegExp(escapeRegExp(t), 'i');
        return [{ title: re }, { shortDescription: re }, { plainText: re }];
      });
      const filter = { $and: [visibilityFilter(visibility), { $or: or }] };
      return (await Page.find(filter, HIDE_INTERNAL).lean()).map(fromDoc);
    },
    bulkImport: (pages) => bulkInsertMissing(Page, pages.map((p) => toDoc(p, internalFields(p)))),
  };
}
