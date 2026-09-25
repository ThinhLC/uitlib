import { describe, expect, it } from 'vitest';
import { mapNullable, omitNil, omitUndefined, toNumberOrNull } from '@/lib/utils';

describe('nullable utils', () => {
  it('mapNullable maps values and passes null/undefined as null', () => {
    expect(mapNullable(2, (v) => v * 2)).toBe(4);
    expect(mapNullable(0, (v) => v + 1)).toBe(1);
    expect(mapNullable(null, (v: number) => v)).toBeNull();
    expect(mapNullable(undefined, (v: number) => v)).toBeNull();
  });

  it('toNumberOrNull converts string sums and keeps null', () => {
    expect(toNumberOrNull('150000')).toBe(150000);
    expect(toNumberOrNull(0)).toBe(0);
    expect(toNumberOrNull(null)).toBeNull();
  });

  it('omitNil drops null and undefined; omitUndefined keeps null (PATCH clears)', () => {
    expect(omitNil({ a: 1, b: null, c: undefined, d: 0, e: '' })).toEqual({ a: 1, d: 0, e: '' });
    expect(omitUndefined({ email: null, phone: undefined, name: 'x' })).toEqual({ email: null, name: 'x' });
  });
});
