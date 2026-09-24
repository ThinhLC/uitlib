import { afterAll, describe, expect, it } from 'vitest';
import { call, closeTestPools, ownerQuery } from '../helpers/db';
import { expectNoViolations, race, repeat20 } from '../helpers/concurrency';
import { checkout, lendingWorld, otherReader, renew } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'ok' : ((r as PromiseRejectedResult).reason.key ?? String((r as any).reason.errno));

async function reserve(actor: number, now: string, readerId: number, bookId: number): Promise<number> {
  const { out } = await call('sp_reserve', [actor, now, readerId, bookId], { outParams: ['p_reservation_id'] });
  return Number((out as any).p_reservation_id);
}

describe('Renewal vs reservation concurrency (T093)', () => {
  it('CT-12 R-14g: renewal × new reservation — renewal succeeds only if it serialized first (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld({ copies: 1 });
      const [c] = w.copies;
      const r1 = (await otherReader(w)).readerId;
      const [li] = await checkout(w.staff, vn('2026-09-01 10:00'), w.readerId, [c]); // due 09-15, not overdue

      const now = vn('2026-09-10 10:00');
      // Renew locks R0 → book → loan item; reserve locks R1 → book: gate on the book row.
      const res = await race({ table: 'books', id: w.bookId },
        () => renew(w.staff, now, li.loanItemId),
        () => reserve(w.staff, now, r1, w.bookId));
      const [rn, rsv] = res.map(outcome);
      // The reservation always succeeds: the only copy is on loan to another reader either way.
      expect(rsv).toBe('ok');

      const [item] = await ownerQuery(`SELECT renewal_count FROM loan_items WHERE id = ?`, [li.loanItemId]);
      const renewals = await ownerQuery(`SELECT id FROM loan_renewals WHERE loan_item_id = ?`, [li.loanItemId]);
      const [rv] = await ownerQuery(`SELECT status FROM reservations WHERE book_id = ?`, [w.bookId]);
      expect(rv.status).toBe('waiting');
      if (rn === 'ok') {
        // renewal serialized before the reservation existed
        expect(Number(item.renewal_count)).toBe(1);
        expect(renewals).toHaveLength(1);
      } else {
        // reservation first → a `waiting` reservation blocks renewal
        expect(rn).toBe('RENEWAL_REJECTED');
        expect((res[0] as PromiseRejectedResult).reason.detail).toBe('reserved');
        expect(Number(item.renewal_count)).toBe(0);
        expect(renewals).toEqual([]);
      }
      await expectNoViolations();
    });
  });
});
