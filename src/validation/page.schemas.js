import { z } from 'zod';
import { extractCiteIds } from '../lib/wikitext.js';
import { VISIBILITIES, FUTURE_VISIBILITIES, DEFAULT_VISIBILITY } from '../lib/visibility.js';

// Limits — spec §6.2. Keep in sync with the client's zod schemas.
export const LIMITS = Object.freeze({
  title: 100,
  shortDescription: 120,
  lead: 10_000,
  sections: 50,
  sectionHeading: 100,
  sectionContent: 20_000,
  infoboxFields: 30,
  infoboxLabel: 40,
  infoboxValue: 500,
  infoboxName: 100,
  infoboxPlace: 200,
  imageAlt: 200,
  imageCaption: 300,
  references: 200,
  referenceText: 300,
  seeAlso: 30,
  seeAlsoEntry: 100,
  externalLinks: 30,
  externalLinkLabel: 200,
  categories: 20,
  category: 60,
  url: 2000,
  editSummary: 255,
});

export const REFERENCE_ID = /^[A-Za-z0-9_-]{1,32}$/;
const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}(-\d{2}-\d{2})?$/;
const REF_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9._-]+$/;

const isHttpUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const isRealDate = (value) => {
  if (value.length === 4) return true;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const text = (max) => z.string().trim().max(max, `Must be at most ${max} characters`);
const optionalText = (max) => text(max).default('');
const httpUrl = text(LIMITS.url).refine(isHttpUrl, 'Must be an http:// or https:// URL');

/** "" and undefined become null; otherwise YYYY or YYYY-MM-DD. */
const nullableDate = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z
    .string()
    .trim()
    .regex(DATE, 'Use YYYY-MM-DD or YYYY')
    .refine(isRealDate, 'Not a valid calendar date')
    .nullable(),
);

const imageSchema = z.object({
  url: text(LIMITS.url).refine(
    (v) => UPLOAD_PATH.test(v) || isHttpUrl(v),
    'Image URL must be an uploaded image (/uploads/…) or an http(s) URL',
  ),
  alt: optionalText(LIMITS.imageAlt),
  caption: optionalText(LIMITS.imageCaption),
});

const infoboxSchema = z.object({
  name: optionalText(LIMITS.infoboxName),
  image: imageSchema.nullable().default(null),
  birthDate: nullableDate,
  birthPlace: optionalText(LIMITS.infoboxPlace),
  deathDate: nullableDate,
  deathPlace: optionalText(LIMITS.infoboxPlace),
  fields: z
    .array(
      z.object({
        label: text(LIMITS.infoboxLabel).min(1, 'Label is required'),
        value: text(LIMITS.infoboxValue).min(1, 'Value is required'),
      }),
    )
    .max(LIMITS.infoboxFields, `At most ${LIMITS.infoboxFields} infobox rows`)
    .default([]),
});

const sectionSchema = z.object({
  id: z.string().trim().regex(SECTION_ID, 'Invalid section id').optional(),
  heading: text(LIMITS.sectionHeading).min(1, 'Heading is required'),
  level: z.union([z.literal(2), z.literal(3)], { error: 'Level must be 2 or 3' }),
  content: z.string().max(LIMITS.sectionContent, `Must be at most ${LIMITS.sectionContent} characters`).default(''),
});

const referenceSchema = z.object({
  id: z.string().trim().regex(REFERENCE_ID, 'Reference id must match ^[A-Za-z0-9_-]{1,32}$'),
  type: z.enum(['web', 'book', 'news', 'other']).default('web'),
  title: text(LIMITS.referenceText).min(1, 'Reference title is required'),
  url: z.union([z.literal(''), httpUrl]).default(''),
  author: optionalText(LIMITS.referenceText),
  publisher: optionalText(LIMITS.referenceText),
  date: z.union([z.literal(''), z.string().trim().regex(REF_DATE, 'Use YYYY, YYYY-MM or YYYY-MM-DD')]).default(''),
  accessDate: z
    .union([z.literal(''), z.string().trim().regex(REF_DATE, 'Use YYYY, YYYY-MM or YYYY-MM-DD')])
    .default(''),
});

const contentShape = {
  title: text(LIMITS.title).min(1, 'Title is required'),
  shortDescription: optionalText(LIMITS.shortDescription),
  infobox: infoboxSchema.default(() => infoboxSchema.parse({})),
  lead: z.string().max(LIMITS.lead, `Must be at most ${LIMITS.lead} characters`).default(''),
  sections: z.array(sectionSchema).max(LIMITS.sections, `At most ${LIMITS.sections} sections`).default([]),
  references: z
    .array(referenceSchema)
    .max(LIMITS.references, `At most ${LIMITS.references} references`)
    .default([]),
  seeAlso: z
    .array(text(LIMITS.seeAlsoEntry).min(1, 'Entry is required'))
    .max(LIMITS.seeAlso, `At most ${LIMITS.seeAlso} entries`)
    .default([]),
  externalLinks: z
    .array(z.object({ label: text(LIMITS.externalLinkLabel).min(1, 'Label is required'), url: httpUrl }))
    .max(LIMITS.externalLinks, `At most ${LIMITS.externalLinks} external links`)
    .default([]),
  categories: z
    .array(text(LIMITS.category).min(1, 'Category is required'))
    .max(LIMITS.categories, `At most ${LIMITS.categories} categories`)
    .default([]),
};

/** Cross-field rules: first section level 2, unique ids, citation integrity. */
function checkContent(data, ctx) {
  if (data.sections.length > 0 && data.sections[0].level !== 2) {
    ctx.addIssue({ code: 'custom', path: ['sections', 0, 'level'], message: 'The first section must be level 2' });
  }

  const sectionIds = new Set();
  data.sections.forEach((s, i) => {
    if (!s.id) return;
    if (sectionIds.has(s.id)) {
      ctx.addIssue({ code: 'custom', path: ['sections', i, 'id'], message: 'Duplicate section id' });
    }
    sectionIds.add(s.id);
  });

  const refIds = new Set();
  data.references.forEach((r, i) => {
    if (refIds.has(r.id)) {
      ctx.addIssue({ code: 'custom', path: ['references', i, 'id'], message: `Duplicate reference id "${r.id}"` });
    }
    refIds.add(r.id);
  });

  const checkCites = (value, path) => {
    for (const id of extractCiteIds(value)) {
      if (!refIds.has(id)) {
        ctx.addIssue({ code: 'custom', path, message: `Citation "${id}" does not match any reference id` });
      }
    }
  };
  checkCites(data.lead, ['lead']);
  data.sections.forEach((s, i) => checkCites(s.content, ['sections', i, 'content']));
}

const editSummary = optionalText(LIMITS.editSummary);

export const pageContentSchema = z.object(contentShape).superRefine(checkContent);

/** "public" | "unlisted" (spec §6.5). "private" is reserved for future custom access. */
export const visibilitySchema = z.string().superRefine((value, ctx) => {
  if (VISIBILITIES.includes(value)) return;
  ctx.addIssue({
    code: 'custom',
    message: FUTURE_VISIBILITIES.includes(value)
      ? `"${value}" visibility is not available yet`
      : `Visibility must be one of: ${VISIBILITIES.join(', ')}`,
  });
});

// No `slug`: the server assigns it (spec §6.4); unknown keys are stripped.
export const createPageSchema = z
  .object({
    ...contentShape,
    visibility: visibilitySchema.default(DEFAULT_VISIBILITY),
    editSummary,
  })
  .superRefine(checkContent);

/** PATCH /pages/:slug/settings. Future custom-access fields go here too. */
export const pageSettingsSchema = z.object({
  visibility: z.string({ error: 'visibility is required' }).pipe(visibilitySchema),
});

export const updatePageSchema = z
  .object({
    ...contentShape,
    baseRevisionId: z.string({ error: 'baseRevisionId is required' }).trim().min(1, 'baseRevisionId is required'),
    editSummary,
  })
  .superRefine(checkContent);

export const restoreSchema = z.object({ editSummary }).default({ editSummary: '' });
