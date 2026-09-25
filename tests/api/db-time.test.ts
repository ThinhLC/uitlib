import { describe, expect, it } from 'vitest';
import { fromDbTime, isoToDbTime, toDbTime } from '@/lib/time/db-time';
import { localMonthBounds } from '@/lib/time/local-month';

describe('db-time', () => {
  it('formats a Date as DATETIME(3) UTC', () => {
    expect(toDbTime(new Date('2026-10-14T16:59:59.999Z'))).toBe('2026-10-14 16:59:59.999');
  });

  it('converts DATETIME text to ISO with Z', () => {
    expect(fromDbTime('2026-10-14 16:59:59.999')).toBe('2026-10-14T16:59:59.999Z');
    expect(fromDbTime('2026-10-14 16:59:59')).toBe('2026-10-14T16:59:59.000Z');
    expect(fromDbTime('2026-10-14')).toBe('2026-10-14');
    expect(fromDbTime(null)).toBeNull();
  });

  it('converts a client instant with an offset to UTC', () => {
    expect(isoToDbTime('2026-10-01T00:00:00+07:00')).toBe('2026-09-30 17:00:00.000');
  });

  it('keeps the local month bounds of spec 001', () => {
    expect(localMonthBounds('2026-10')).toEqual(['2026-09-30 17:00:00.000', '2026-10-31 17:00:00.000']);
    expect(localMonthBounds('2026-12')).toEqual(['2026-11-30 17:00:00.000', '2026-12-31 17:00:00.000']);
  });

  it('the named zone equals the fixed UTC+07:00 the database uses, for every month 2000–2040', () => {
    for (let y = 2000; y <= 2040; y++) {
      for (let mo = 1; mo <= 12; mo++) {
        const month = `${y}-${String(mo).padStart(2, '0')}`;
        const fixed = [new Date(Date.UTC(y, mo - 1, 1, -7)), new Date(Date.UTC(y, mo, 1, -7))].map(toDbTime);
        expect(localMonthBounds(month), month).toEqual(fixed);
      }
    }
  });

  it('rejects malformed values', () => {
    expect(() => fromDbTime('2026-13-40 99:00:00.000')).toThrow();
    expect(() => isoToDbTime('yesterday')).toThrow();
    expect(() => localMonthBounds('2026-13')).toThrow();
  });
});
