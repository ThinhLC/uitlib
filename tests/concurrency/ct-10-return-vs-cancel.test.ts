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

const cancelReservation = (actor: number, now: string, reservationId: number, reason: string | null) =>
  call('sp_cancel_reservation', [actor, now, reservationId, reason]);

const reservationRow = async (id: number) =>
  (await ownerQuery(`SELECT * FROM reservations WHERE id = ?`, [id]))[0];

describe('Reservation promotion concurrency (T093)', () => {
  it('CT-10 R-14e: return (promotes the queue head) × cancel of the queue head — I-2/I-3 hold (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld({ copies: 1 });
      const [c] = w.copies;
      const r1 = (await otherReader(w)).readerId;
      const r2 = (await otherReader(w)).readerId;
      const [li] = await checkout(w.staff, vn('2026-09-01 10:00'), w.readerId, [c]);
      const res1 = await reserve(w.staff, vn('2026-09-02 10:00'), r1, w.bookId);
      const res2 = await reserve(w.staff, vn('2026-09-02 11:00'), r2, w.bookId);

      const now = vn('2026-09-05 10:00');
      // Return locks R0 → book; cancel locks R1 → book: the book row is the first shared lock.
      const res = await race({ table: 'books', id: w.bookId },
        () => returnItem(w.staff, now, li.loanItemId),
        () => cancelReservation(w.staff, now, res1, 'reader asked at the desk'));
      // return first → R1 `ready`, cancelling it re-runs promotion; cancel first → return promotes R2.
      expect(res.map(outcome)).toEqual(['ok', 'ok']);

      const h1 = await reservationRow(res1);
      const h2 = await reservationRow(res2);
      expect(h1.status).toBe('cancelled');
      expect(h1.fulfilled_loan_item_id).toBeNull();
      expect(h2.status).toBe('ready');
      expect(Number(h2.assigned_copy_id)).toBe(c);
      expect(h2.hold_expires_at).toBe(vn('2026-09-08 10:00'));
      const [cp] = await ownerQuery(`SELECT circulation_status s FROM book_copies WHERE id = ?`, [c]);
      expect(cp.s).toBe('on_hold');
      const ready = await ownerQuery(`SELECT id FROM reservations WHERE assigned_copy_id = ? AND status = 'ready'`, [c]);
      expect(ready.map((r: any) => Number(r.id))).toEqual([res2]);
      await expectNoViolations();
    });
  });
});
