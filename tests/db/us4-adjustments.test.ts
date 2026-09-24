import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { call, closeTestPools, expectRule, ownerQuery } from '../helpers/db';
import { account, adjust, checkout, declareLost, lendingWorld, pay, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

/** A lost fine of 150,000 with 50,000 already paid. */
async function lostFinePartlyPaid() {
  const w = await lendingWorld();
  const [li] = await checkout(w.staff, vn('2026-09-26 10:00'), w.readerId, [w.copies[0]]);
  const fines = await declareLost(w.staff, vn('2026-10-05 10:00'), li.loanItemId); // not late
  const fineId = Number(fines[0].fine_id);
  await pay(w.staff, vn('2026-10-06 10:00'), w.readerId, 50000, [{ fineId, amount: 50000 }]);
  return { w, fineId, copyId: w.copies[0], loanItemId: li.loanItemId };
}

const remaining = async (fineId: number) =>
  Number((await ownerQuery(`SELECT fn_fine_remaining(?) r`, [fineId]))[0].r);

describe('US4 adjustments (T064)', () => {
  it('US4-8 R-17a: −100,000 with a reason settles the fine; −120,000 or no reason is FINE_RULE', async () => {
    const { w, fineId } = await lostFinePartlyPaid();
    await expectRule(adjust(w.staff, vn('2026-10-07 10:00'), fineId, -120000, 'found'), 'FINE_RULE');
    await expectRule(adjust(w.staff, vn('2026-10-07 10:00'), fineId, -100000, '  '), 'FINE_RULE');
    await expectRule(adjust(w.staff, vn('2026-10-07 10:00'), fineId, 0, 'zero'), 'FINE_RULE');
    await expectRule(adjust(await account(['reader']), vn('2026-10-07 10:00'), fineId, -100000, 'found'), 'FORBIDDEN');
    await adjust(w.staff, vn('2026-10-07 10:00'), fineId, -100000, 'copy found, unpaid part waived');
    expect(await remaining(fineId)).toBe(0);
    const [a] = await ownerQuery(`SELECT amount_vnd, reason, adjusted_by_user_id FROM fine_adjustments`);
    expect(a).toEqual({ amount_vnd: -100000, reason: 'copy found, unpaid part waived', adjusted_by_user_id: w.staff });
  });

  it('R-17b: adjustments are append-only', async () => {
    const { w, fineId } = await lostFinePartlyPaid();
    const id = await adjust(w.staff, vn('2026-10-07 10:00'), fineId, -10000, 'discount');
    await expectRule(ownerQuery(`UPDATE fine_adjustments SET amount_vnd = -1 WHERE id = ?`, [id]), 'APPEND_ONLY');
    await expectRule(ownerQuery(`DELETE FROM fine_adjustments WHERE id = ?`, [id]), 'APPEND_ONLY');
  });

  it('D9 lost-then-found: the copy returns to circulation, the item stays lost, the unpaid part is adjusted', async () => {
    const { w, fineId, copyId, loanItemId } = await lostFinePartlyPaid();
    await call('sp_change_copy_status', [w.staff, vn('2026-10-08 10:00'), copyId, 'available', 'good']);
    await adjust(w.staff, vn('2026-10-08 10:00'), fineId, -100000, 'copy found');
    const [row] = await ownerQuery(
      `SELECT li.status, c.circulation_status FROM loan_items li JOIN book_copies c ON c.id = li.copy_id WHERE li.id = ?`,
      [loanItemId]);
    expect(row).toEqual({ status: 'lost', circulation_status: 'available' });
    expect(await remaining(fineId)).toBe(0);
  });
});
