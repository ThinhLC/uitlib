import { z } from 'zod';

/** A surrogate id: a positive integer (spec 001 BIGINT keys stay below 2^53). Coerces path/query text. */
export const Id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** `{ id }` path parameters are declared per endpoint; this is a helper for one id. */
export const IdParam = (name: string) => z.object({ [name]: Id });

/** An instant sent by a client: ISO 8601 with `Z` or an offset. The server converts it to UTC. */
export const InstantInput = z.iso.datetime({ offset: true });

/** An instant in a response: ISO 8601 UTC with milliseconds, e.g. `2026-10-14T16:59:59.999Z`. */
export type Instant = string;

/** A calendar date `YYYY-MM-DD`. */
export const DateOnly = z.iso.date();

/** A library-local month (UTC+07:00), e.g. `2026-10`. */
export const LocalMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');

/** Money in whole đồng, never negative. */
export const Money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** A signed, non-zero amount in đồng (fine adjustments). */
export const SignedMoney = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .refine((v) => v !== 0, 'must not be 0');

/** Paging for lists that can grow without bound (FR-016). */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.output<typeof PageQuery>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** A bounded list returned whole. */
export interface Items<T> {
  items: T[];
}

/** An array of distinct values. */
export const distinct = <T extends z.ZodType>(item: T, min: number, max: number) =>
  z
    .array(item)
    .min(min)
    .max(max)
    .refine((xs) => new Set(xs.map((x) => JSON.stringify(x))).size === xs.length, 'values must be distinct');

/** Optional trimmed text of at most `max` characters; blank becomes undefined. */
export const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? undefined : s))
    .optional();
