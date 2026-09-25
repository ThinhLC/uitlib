import { UTCDate } from '@date-fns/utc';
import { format, isValid, parse, parseISO } from 'date-fns';
import { isNil } from '@/lib/utils';

/** MySQL `DATETIME(3)` text, always UTC (the pool uses `timezone: 'Z'` and `dateStrings`). */
const DB_FORMAT = 'yyyy-MM-dd HH:mm:ss.SSS';
const DB_FORMAT_NO_MS = 'yyyy-MM-dd HH:mm:ss';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A UTC instant as `DATETIME(3)` text: `YYYY-MM-DD HH:mm:ss.SSS` (procedure `p_now`). */
export function toDbTime(d: Date): string {
  return format(new UTCDate(d), DB_FORMAT);
}

/**
 * `DATETIME` text from the database as ISO 8601 with `Z`. `DATE` values (`YYYY-MM-DD`) pass
 * through unchanged.
 */
export function fromDbTime(s: string): string;
export function fromDbTime(s: string | null | undefined): string | null;
export function fromDbTime(s: string | null | undefined): string | null {
  if (isNil(s)) return null;
  if (DATE_ONLY.test(s)) return s;
  const ref = new UTCDate(0);
  const d = s.includes('.') ? parse(s, DB_FORMAT, ref) : parse(s, DB_FORMAT_NO_MS, ref);
  if (isValid(d)) return d.toISOString();
  throw new Error(`Not a DATETIME value: ${s}`);
}

/** An ISO 8601 instant from a client (`Z` or an offset) as `DATETIME(3)` UTC text. */
export function isoToDbTime(iso: string): string {
  const d = parseISO(iso);
  if (isValid(d)) return toDbTime(d);
  throw new Error(`Invalid instant: ${iso}`);
}
