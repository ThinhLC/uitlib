import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, expectErrno, expectRule, ownerQuery } from '../helpers/db';
import { checkout, declareLost, lendingWorld, lateFine, pay, returnItem, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const BORROW = vn('2026-09-26 10:00'); // 14 days → due 2026-10-10 23:59:59.999 local
const summary = (fines: any[]) => fines.map((f) => [f.fine_type, Number(f.assessed_amount_vnd)]);

describe('US4 fines (T057)', () => {
  it('US4-1: returned 3 local days late at 2,000/day → one late fine of 6,000', async () => {
    const w = await lendingWorld({ policy: { dailyFee: 2000, loanDays: 14 } });
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0]]);
    expect(summary(await returnItem(w.staff, vn('2026-10-13 09:00'), li.loanItemId))).toEqual([['late', 6000]]);
  });

  it('US4-2: returned on the due date → no fine', async () => {
    const w = await lendingWorld();
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0]]);
    expect(await returnItem(w.staff, vn('2026-10-10 23:00'), li.loanItemId)).toEqual([]);
  });

  it('US4-3: declared lost 10 days late → late 20,000 + lost 150,000; item and copy lost', async () => {
    const w = await lendingWorld({ policy: { dailyFee: 2000, loanDays: 14 } });
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0]]);
    const fines = await declareLost(w.staff, vn('2026-10-20 09:00'), li.loanItemId);
    expect(summary(fines)).toEqual([['late', 20000], ['lost', 150000]]);
    const [row] = await ownerQuery(
      `SELECT li.status, c.circulation_status FROM loan_items li JOIN book_copies c ON c.id = li.copy_id WHERE li.id = ?`,
      [li.loanItemId]);
    expect(row).toEqual({ status: 'lost', circulation_status: 'lost' });
  });

  it('US4-4 R-15a/b: a second late fine is rejected; damaged and lost cannot coexist', async () => {
    const f = await lateFine({ days: 3 });
    await expectErrno(ownerQuery(
      `INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, assessed_at, assessed_by_user_id)
       VALUES (?, 'late', 1000, 1000, ?, ?)`, [f.loanItemId, vn('2026-10-21 09:00'), f.world.staff]), 1062);
    const w = f.world;
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[3]]);
    await returnItem(w.staff, vn('2026-10-01 09:00'), li.loanItemId, 'damaged', 40_000, 'water damage');
    await expectRule(ownerQuery(
      `INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
       VALUES (?, 'lost', 150000, 150000, NULL, ?, ?)`, [li.loanItemId, vn('2026-10-02 09:00'), w.staff]), 'FINE_RULE');
  });

  it('US4-9: a returned item can still owe its fine', async () => {
    const f = await lateFine({ days: 5 });
    const [row] = await ownerQuery(
      `SELECT li.status, fn_fine_remaining(?) remaining FROM loan_items li WHERE li.id = ?`, [f.fineId, f.loanItemId]);
    expect(row).toEqual({ status: 'returned', remaining: 10000 });
  });

  it('US4-10 R-15c/d: damaged fine within 0…replacement cost with a reason; otherwise FINE_RULE', async () => {
    const w = await lendingWorld({ copies: 3 });
    const [a, b, c] = await checkout(w.staff, BORROW, w.readerId, w.copies);
    expect(summary(await returnItem(w.staff, vn('2026-10-01 09:00'), a.loanItemId, 'damaged', 40_000, 'torn')))
      .toEqual([['damaged', 40000]]);
    await expectRule(returnItem(w.staff, vn('2026-10-01 09:00'), b.loanItemId, 'damaged', 200_000, 'torn'), 'FINE_RULE');
    await expectRule(returnItem(w.staff, vn('2026-10-01 09:00'), c.loanItemId, 'damaged', 40_000, null), 'FINE_RULE');
    // the rejected returns left nothing behind
    const [row] = await ownerQuery(`SELECT COUNT(*) n FROM loan_items WHERE status = 'on_loan'`);
    expect(Number(row.n)).toBe(2);
    // CHECK: an overridden amount needs a reason even when inserted directly
    await expectErrno(ownerQuery(
      `INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
       VALUES (?, 'lost', 150000, 90000, NULL, ?, ?)`, [b.loanItemId, vn('2026-10-02 09:00'), w.staff]), 3819);
  });

  it('US4-11 R-17b B-4: money rows are append-only, even for the owner', async () => {
    const f = await lateFine({ days: 5 });
    const { paymentId } = await pay(f.world.staff, vn('2026-10-21 09:00'), f.world.readerId, 5000,
      [{ fineId: f.fineId, amount: 5000 }]);
    for (const sql of [
      `UPDATE fines SET assessed_amount_vnd = 0 WHERE id = ${f.fineId}`,
      `DELETE FROM fines WHERE id = ${f.fineId}`,
      `UPDATE fine_payments SET amount_vnd = 1 WHERE id = ${paymentId}`,
      `DELETE FROM fine_payments WHERE id = ${paymentId}`,
      `UPDATE fine_payment_allocations SET amount_vnd = 1 WHERE payment_id = ${paymentId}`,
      `DELETE FROM fine_payment_allocations WHERE payment_id = ${paymentId}`,
    ]) {
      await expectRule(ownerQuery(sql), 'APPEND_ONLY');
    }
  });
});
