import { TZDate } from '@date-fns/tz';
import { addMonths } from 'date-fns';
import { isNil } from '@/lib/utils';
import { toDbTime } from './db-time';
import { LIBRARY_TIME_ZONE } from './zone';

/** UTC bounds of a library-local month: [first day 00:00 local, first day of next month 00:00 local). */
export function localMonthBounds(month: string): [string, string] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (isNil(m)) throw new Error(`month must be YYYY-MM, got ${month}`);
  const start = new TZDate(Number(m[1]), Number(m[2]) - 1, 1, LIBRARY_TIME_ZONE);
  return [toDbTime(start), toDbTime(addMonths(start, 1))];
}
