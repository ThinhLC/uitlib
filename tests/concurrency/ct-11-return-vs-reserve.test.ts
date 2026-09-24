import { afterAll, describe, expect, it } from 'vitest';
import { call, closeTestPools, ownerQuery } from '../helpers/db';
import { expectNoViolations, race, repeat20 } from '../helpers/concurrency';
import { checkout, lendingWorld, otherReader, returnItem } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'ok' : ((r as PromiseRejectedResult).reason.key ?? String((r as any).reason.errno));

async function reserve(actor: number, now: string, readerId: number, bookId: number): Promise<number> {
  const { out } = await call('sp_reserve', [actor, now, readerId, bookId], { outParams: ['p_reservation_id'] });
  return Number((out as any).p_reservation_id);
}

describe('Reservation create concurrency (T093)', () => {
  it('CT-11 R-14g R-14e: return of the last loaned copy × new reservation — held or rejected, I-3 holds (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld({ copies: 1 });
      const [c] = w.copies;
      const r1 = (await otherReader(w)).readerId;
      const [li] = await checkout(w.staff, vn('2026-09-01 10:00'), w.readerId, [c]);

      const now = vn('2026-09-05 10:00');
      // Return locks R0 → book; reserve locks R1 → book: gate on the book row.
      const res = await race({ table: 'books', id: w.bookId },
        () => returnItem(w.staff, now, li.loanItemId),
        () => reserve(w.staff, now, r1, w.bookId));
      const [ret, rsv] = res.map(outcome);
      expect(ret).toBe('ok');

      const rows = await ownerQuery(`SELECT * FROM reservations WHERE book_id = ?`, [w.bookId]);
      const [cp] = await ownerQuery(`SELECT circulation_status s FROM book_copies WHERE id = ?`, [c]);
      if (rsv === 'ok') {
        // reservation serialized first (copy still on loan) → the return promoted it
        const id = (res[1] as PromiseFulfilledResult<number>).value;
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].id)).toBe(id);
        expect(Number(rows[0].reader_id)).toBe(r1);
        expect(rows[0].status).toBe('ready');
        expect(Number(rows[0].assigned_copy_id)).toBe(c);
        expect(cp.s).toBe('on_hold');
      } else {
        // return serialized first → an `available` copy exists, so the reservation is refused
        expect(rsv).toBe('VALIDATION');
        expect(rows).toEqual([]);
        expect(cp.s).toBe('available');
      }
      await expectNoViolations();
    });
  });
});
