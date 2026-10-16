import { z } from 'zod';

const intParam = (def, max) => z.coerce.number().int().min(0).max(max).default(def);
const limitParam = (def, max) => z.coerce.number().int().min(1).max(max).default(def);

export const listPagesQuery = z.object({
  sort: z.enum(['recent', 'updated', 'title']).default('recent'),
  limit: limitParam(10, 50),
  offset: intParam(0, 1_000_000),
});

export const slugCheckQuery = z.object({
  title: z.string().trim().max(200).default(''),
});

export const revisionsQuery = z.object({
  limit: limitParam(50, 500),
  offset: intParam(0, 1_000_000),
});

export const suggestQuery = z.object({
  q: z.string().trim().max(200).default(''),
  limit: limitParam(8, 10),
});

export const searchQuery = z.object({
  q: z.string().trim().max(200).default(''),
  limit: limitParam(20, 100),
  offset: intParam(0, 1_000_000),
});
