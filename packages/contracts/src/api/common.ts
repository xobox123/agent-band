import { z } from 'zod';

export const Id = z.uuid();
export const IsoDate = z.string();

/** `cursor` is the latest outbox event id at read time; open SSE with `Last-Event-ID: <cursor>`. */
export function listOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), cursor: z.number().int().nonnegative() });
}

export const PageCursor = z.object({ at: z.iso.datetime({ offset: true }), id: Id });
export const PagingQuery = z.object({
  pageCursor: z
    .string()
    .refine((value) => {
      try {
        return PageCursor.safeParse(JSON.parse(value)).success;
      } catch {
        return false;
      }
    }, 'Invalid page cursor')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const IdParams = z.object({ id: Id });

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string(),
  requestId: z.string(),
  details: z.unknown().optional(),
});
export type Problem = z.infer<typeof Problem>;

export const Labels = z
  .array(z.string().trim().min(1).max(63))
  .max(32)
  .refine((l) => new Set(l).size === l.length, 'labels must be unique');

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
export const QueryBool = bool;
