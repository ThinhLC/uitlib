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

async function expireHolds(actor: number, now: string): Promise<number> {
  const { out } = await call('sp_expire_holds', [actor, now], { outParams: ['p_count'] });
  return Number((out as any).p_count);
}

const reservationRow = async (id: number) =>
  (await ownerQuery(`SELECT * FROM reservations WHERE id = ?`, [id]))[0];
const copyStatus = async (id: number) =>
  String((await ownerQuery(`SELECT circulation_status s FROM book_copies WHERE id = ?`, [id]))[0].s);

describe('Reservation hold concurrency (T093)', () => {
  it('CT-9 R-14e R-14f: checkout by the holder × hold expiry — fulfilled or expired, never both (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld({ copies: 1 });
      const [c] = w.copies;
      const r1 = (await otherReader(w)).readerId;
      const r2 = (await otherReader(w)).readerId;
      const [li] = await checkout(w.staff, vn('2026-09-01 10:00'), w.readerId, [c]);
      const res1 = await reserve(w.staff, vn('2026-09-02 10:00'), r1, w.bookId);
      const res2 = await reserve(w.staff, vn('2026-09-02 11:00'), r2, w.bookId);
      // R0 returns: promotion makes R1 `ready` on the copy, hold until 09-08 10:00.
      await returnItem(w.staff, vn('2026-09-05 10:00'), li.loanItemId);
      expect((await reservationRow(res1)).status).toBe('ready');
      expect(await copyStatus(c)).toBe('on_hold');

      // sp_checkout itself expires an overdue hold before lending, so a checkout clocked after the
      // expiry would always lose to its own expiry. To race the two transactions for real, the
      // checkout runs with a clock before the expiry (09-07) and the batch with a clock after it
      // (09-09). Both lock the book row first (checkout: reader → cards → book; expiry: book), so
      // the gate sits on the book.
      const res = await race({ table: 'books', id: w.bookId },
        () => checkout(w.staff, vn('2026-09-07 10:00'), r1, [c]),
        () => expireHolds(w.staff, vn('2026-09-09 10:00')));
      const [co, ex] = res.map(outcome);
      expect(ex).toBe('ok');
      const expired = (res[1] as PromiseFulfilledResult<number>).value;

      const h1 = await reservationRow(res1);
      const h2 = await reservationRow(res2);
      if (co === 'ok') {
        // checkout serialized first: the hold was collected, nothing left to expire
        const [loan] = (res[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof checkout>>>).value;
        expect(expired).toBe(0);
        expect(h1.status).toBe('fulfilled');
        expect(Number(h1.fulfilled_loan_item_id)).toBe(loan.loanItemId);
        expect(h2.status).toBe('waiting');
        expect(await copyStatus(c)).toBe('on_loan');
      } else {
        // expiry serialized first: R1 expired, R2 promoted, R1 may no longer borrow the copy
        expect(co).toBe('COPY_NOT_AVAILABLE');
        expect(expired).toBe(1);
        expect(h1.status).toBe('expired');
        expect(h1.closed_by_kind).toBe('system');
        expect(h1.fulfilled_loan_item_id).toBeNull();
        expect(h2.status).toBe('ready');
        expect(Number(h2.assigned_copy_id)).toBe(c);
        expect(await copyStatus(c)).toBe('on_hold');
        const [n] = await ownerQuery(`SELECT COUNT(*) n FROM loan_items WHERE copy_id = ? AND status = 'on_loan'`, [c]);
        expect(Number(n.n)).toBe(0);
      }
      await expectNoViolations();
    });
  });
});
