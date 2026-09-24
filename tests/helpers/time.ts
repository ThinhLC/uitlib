/**
 * Convert a library-local time (Asia/Ho_Chi_Minh, UTC+07:00, no DST) to the UTC DATETIME(3)
 * string stored by the database. Example: vn('2026-09-30 23:59:59.900') → '2026-09-30 16:59:59.900'.
 */
export function vn(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(local);
  if (!m) throw new Error(`vn(): cannot parse ${local}`);
  const [, y, mo, d, h = '00', mi = '00', s = '00', ms = '0'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h - 7, +mi, +s, +ms.padEnd(3, '0'));
  return toDbTime(new Date(utc));
}

/** Format a Date as the DATETIME(3) string used by the database (UTC). */
export function toDbTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}
