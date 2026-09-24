import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { call, closeTestPools, expectRule, ownerQuery } from '../helpers/db';
import {
  account, card, checkout, declareLost, lendingWorld, policy, reader, renew, returnItem, truncateAll,
} from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const item = async (id: number) => (await ownerQuery(`SELECT * FROM loan_items WHERE id = ?`, [id]))[0];
const copyStatus = async (id: number) =>
  (await ownerQuery(`SELECT circulation_status s, physical_condition c FROM book_copies WHERE id = ?`, [id]))[0];
const BORROW = vn('2026-09-26 10:00'); // with 14 loan days → due 2026-10-10 23:59:59.999 local

describe('US3 return, renew, lost (T046)', () => {
  it('US3-4 R-11a: a loan item keeps its snapshot after the policy is replaced', async () => {
    const w = await lendingWorld({ policy: { loanDays: 14, maxRenewals: 2, dailyFee: 2000 } });
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0]]);
    const now = vn('2026-09-28 09:00');
    await call('sp_close_policy_version', [w.staff, now, w.policyId, vn('2026-10-01 00:00')]);
    await policy(w.staff, now, 'STUDENT', { validFrom: vn('2026-10-01 00:00'), dailyFee: 5000, loanDays: 7 });
    expect(await item(li.loanItemId)).toMatchObject({
      applied_daily_fee_vnd: 2000, applied_loan_days: 14, applied_max_renewals: 2, policy_id: w.policyId });
    await expectRule(ownerQuery(`UPDATE loan_items SET applied_daily_fee_vnd = 5000 WHERE id = ?`, [li.loanItemId]),
      'SNAPSHOT_IMMUTABLE');
    // its late fee still uses 2,000 VND/day: returned 3 local days late → 6,000
    const fines = await returnItem(w.staff, vn('2026-10-13 09:00'), li.loanItemId);
    expect(fines.map((f: any) => [f.fine_type, Number(f.assessed_amount_vnd)])).toEqual([['late', 6000]]);
  });

  it('US3-5 R-13a: renewal adds applied loan days to the old due time and is recorded', async () => {
    const w = await lendingWorld({ policy: { loanDays: 14, maxRenewals: 2 } });
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0]]);
    expect(li.dueAt).toBe(vn('2026-10-10 23:59:59.999'));
    const newDue = await renew(w.staff, vn('2026-10-05 09:00'), li.loanItemId);
    expect(newDue).toBe(vn('2026-10-24 23:59:59.999'));
    expect(await item(li.loanItemId)).toMatchObject({ due_at: newDue, renewal_count: 1 });
    const [r] = await ownerQuery(`SELECT * FROM loan_renewals WHERE loan_item_id = ?`, [li.loanItemId]);
    expect(r).toMatchObject({ old_due_at: li.dueAt, new_due_at: newDue, performed_by_user_id: w.staff,
      renewed_at: vn('2026-10-05 09:00') });
  });

  it('US3-6: renewal is rejected when overdue or at the limit, and nothing changes', async () => {
    const w = await lendingWorld({ policy: { loanDays: 14, maxRenewals: 1 }, copies: 2 });
    const [a, b] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0], w.copies[1]]);
    const overdue = await expectRule(renew(w.staff, vn('2026-10-11 09:00'), a.loanItemId), 'RENEWAL_REJECTED');
    expect(overdue.message).toContain('overdue');
    await renew(w.staff, vn('2026-10-05 09:00'), b.loanItemId);
    const limit = await expectRule(renew(w.staff, vn('2026-10-06 09:00'), b.loanItemId), 'RENEWAL_REJECTED');
    expect(limit.message).toContain('limit');
    expect(await item(a.loanItemId)).toMatchObject({ due_at: a.dueAt, renewal_count: 0 });
    expect(await item(b.loanItemId)).toMatchObject({ renewal_count: 1 });
    await expectRule(renew(await account(['reader']), vn('2026-10-05 09:00'), a.loanItemId), 'FORBIDDEN');
  });

  it('US3-13 R-10a R-11c: the loan closes with its last item; terminal items cannot reopen', async () => {
    const w = await lendingWorld({ copies: 2 });
    const [a, b] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0], w.copies[1]]);
    const loanStatus = async () => (await ownerQuery(`SELECT status FROM loans WHERE id = ?`, [a.loanId]))[0].status;
    await returnItem(w.staff, vn('2026-10-01 09:00'), a.loanItemId);
    expect(await loanStatus()).toBe('open');
    await declareLost(w.staff, vn('2026-10-02 09:00'), b.loanItemId);
    expect(await loanStatus()).toBe('closed');
    expect((await copyStatus(w.copies[0])).s).toBe('available');
    expect((await copyStatus(w.copies[1])).s).toBe('lost');
    await expectRule(ownerQuery(
      `UPDATE loan_items SET status = 'on_loan', returned_at = NULL, return_condition = NULL WHERE id = ?`,
      [a.loanItemId]), 'INVALID_TRANSITION');
    await expectRule(returnItem(w.staff, vn('2026-10-03 09:00'), a.loanItemId), 'INVALID_TRANSITION');
    await expectRule(call('sp_return_item', [w.staff, vn('2026-10-03 09:00'), 999999, 'good', null, null]), 'NOT_FOUND');
  });

  it('a damaged return puts the copy in repair and records the damaged fine', async () => {
    const w = await lendingWorld();
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0]]);
    const fines = await returnItem(w.staff, vn('2026-10-01 09:00'), li.loanItemId, 'damaged', 40_000, 'torn cover');
    expect(fines.map((f: any) => [f.fine_type, Number(f.assessed_amount_vnd)])).toEqual([['damaged', 40000]]);
    expect(await copyStatus(w.copies[0])).toEqual({ s: 'in_repair', c: 'damaged' });
    expect(await item(li.loanItemId)).toMatchObject({ status: 'returned', return_condition: 'damaged' });
  });

  it('R-20: return and lost need loan.return', async () => {
    const w = await lendingWorld();
    const [li] = await checkout(w.staff, BORROW, w.readerId, [w.copies[0]]);
    const readerAcct = await account(['reader']);
    await expectRule(returnItem(readerAcct, vn('2026-10-01 09:00'), li.loanItemId), 'FORBIDDEN');
    await expectRule(declareLost(readerAcct, vn('2026-10-01 09:00'), li.loanItemId), 'FORBIDDEN');
    // an unrelated reader still borrows normally afterwards
    const other = await reader();
    await card(w.staff, w.now, other);
    expect((await item(li.loanItemId)).status).toBe('on_loan');
  });
});
