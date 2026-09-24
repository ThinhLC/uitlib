import { afterAll, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { race, repeat20 } from '../helpers/concurrency';
import { card, checkout, lendingWorld, reader } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

const T = vn('2026-09-10 10:00');
const fulfilled = (xs: PromiseSettledResult<unknown>[]) => xs.filter((x) => x.status === 'fulfilled');
const rejected = (xs: PromiseSettledResult<unknown>[]) =>
  xs.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];

describe('Checkout concurrency (T047)', () => {
  it('CT-1 US3-1 R-12b: two checkouts of the same copy — exactly one wins (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld();
      const other = await reader();
      await card(w.staff, w.now, other);
      const res = await race({ table: 'book_copies', id: w.copies[0] },
        () => checkout(w.staff, T, w.readerId, [w.copies[0]]),
        () => checkout(w.staff, T, other, [w.copies[0]]));
      expect(fulfilled(res)).toHaveLength(1);
      expect(rejected(res)[0].reason.key).toBe('COPY_NOT_AVAILABLE');
      const [n] = await ownerQuery(`SELECT (SELECT COUNT(*) FROM loans) loans, (SELECT COUNT(*) FROM loan_items) items`);
      expect([Number(n.loans), Number(n.items)]).toEqual([1, 1]);
    });
  });

  it('CT-2 US3-3 R-12b: one reader at limit − 1 checks out two copies at once — exactly one wins (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld({ copies: 3, policy: { maxItems: 2 } });
      await checkout(w.staff, T, w.readerId, [w.copies[0]]);
      const res = await race({ table: 'readers', id: w.readerId },
        () => checkout(w.staff, T, w.readerId, [w.copies[1]]),
        () => checkout(w.staff, T, w.readerId, [w.copies[2]]));
      expect(fulfilled(res)).toHaveLength(1);
      expect(rejected(res)[0].reason.key).toBe('LIMIT_REACHED');
    });
  });

  it('CT-3 R-12b D13: multi-copy checkouts {A,B} × {B,A} — no deadlock reaches the caller (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld({ copies: 2 });
      const other = await reader();
      await card(w.staff, w.now, other);
      const [a, b] = w.copies;
      const res = await race({ table: 'books', id: w.bookId },
        () => checkout(w.staff, T, w.readerId, [a, b]),
        () => checkout(w.staff, T, other, [b, a]));
      expect(fulfilled(res)).toHaveLength(1);
      const err = rejected(res)[0].reason;
      expect(err.errno === 1213 ? 'DEADLOCK' : err.key).toBe('COPY_NOT_AVAILABLE');
      const [n] = await ownerQuery(`SELECT COUNT(*) n FROM loan_items`);
      expect(Number(n.n)).toBe(2);
    });
  });
});
