import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { call, closeTestPools, expectErrno, expectRule, ownerQuery } from '../helpers/db';
import {
  account, admin, book, card, checkout, copy, declareLost, lendingWorld, policy, reader, truncateAll,
} from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const T = vn('2026-09-10 10:00');
const count = async (table: string) => Number((await ownerQuery(`SELECT COUNT(*) n FROM ${table}`))[0].n);
const copyStatus = async (id: number) =>
  (await ownerQuery(`SELECT circulation_status s FROM book_copies WHERE id = ?`, [id]))[0].s;

describe('US3 checkout (T045, T050)', () => {
  it('US3-1 R-12b: a checkout writes a loan, an item with the policy snapshot, and marks the copy on_loan', async () => {
    const w = await lendingWorld({ policy: { loanDays: 14, maxRenewals: 2, dailyFee: 2000 } });
    const [item] = await checkout(w.staff, T, w.readerId, [w.copies[0]]);
    expect(item.dueAt).toBe(vn('2026-09-24 23:59:59.999'));
    const [row] = await ownerQuery(`SELECT * FROM loan_items WHERE id = ?`, [item.loanItemId]);
    expect(row).toMatchObject({
      status: 'on_loan', policy_id: w.policyId, borrowed_at: T, applied_loan_days: 14,
      applied_max_renewals: 2, applied_daily_fee_vnd: 2000, renewal_count: 0,
    });
    const [loan] = await ownerQuery(`SELECT status, reader_id, processed_by_user_id FROM loans WHERE id = ?`, [item.loanId]);
    expect(loan).toEqual({ status: 'open', reader_id: w.readerId, processed_by_user_id: w.staff });
    expect(await copyStatus(w.copies[0])).toBe('on_loan');
  });

  it('US3-2 R-12a B-1: a second open loan item for a copy is rejected, and the unique key exists', async () => {
    const w = await lendingWorld();
    const [item] = await checkout(w.staff, T, w.readerId, [w.copies[0]]);
    // The BEFORE INSERT guard fires first (copy is on_loan); the UNIQUE key is the second line of defence.
    await expect(ownerQuery(
      `INSERT INTO loan_items (loan_id, copy_id, policy_id, borrowed_at, due_at, status, renewal_count,
                               applied_loan_days, applied_max_renewals, applied_daily_fee_vnd)
       VALUES (?, ?, ?, ?, ?, 'on_loan', 0, 14, 2, 2000)`,
      [item.loanId, w.copies[0], w.policyId, T, item.dueAt])).rejects.toSatisfy(
      (e: any) => e.errno === 1062 || (e.sqlState === '45000' && e.message.startsWith('COPY_STATE')));
    const [idx] = await ownerQuery(
      `SELECT NON_UNIQUE nu, COLUMN_NAME col FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_items' AND INDEX_NAME = 'loan_items_open_copy_uq'`);
    expect(idx).toEqual({ nu: 0, col: 'open_copy_id' });
  });

  it('US3-10 R-12c: a loaned copy cannot be set available directly', async () => {
    const w = await lendingWorld();
    await checkout(w.staff, T, w.readerId, [w.copies[0]]);
    await expectRule(ownerQuery(`UPDATE book_copies SET circulation_status = 'available' WHERE id = ?`, [w.copies[0]]),
      'COPY_STATE');
  });

  it('US3-11 R-11b: due must be after borrow; return may not precede borrow (3819)', async () => {
    const w = await lendingWorld({ copies: 2 });
    const [item] = await checkout(w.staff, T, w.readerId, [w.copies[0]]);
    await expectErrno(ownerQuery(
      `INSERT INTO loan_items (loan_id, copy_id, policy_id, borrowed_at, due_at, status, renewal_count,
                               applied_loan_days, applied_max_renewals, applied_daily_fee_vnd)
       VALUES (?, ?, ?, ?, ?, 'on_loan', 0, 14, 2, 2000)`,
      [item.loanId, w.copies[1], w.policyId, T, T]), 3819);
    await expectErrno(ownerQuery(
      `UPDATE loan_items SET status = 'returned', returned_at = ?, return_condition = 'good' WHERE id = ?`,
      [vn('2026-09-01 00:00'), item.loanItemId]), 3819);
  });

  it('US3-12 FR-009d: each eligibility rule rejects the checkout and writes nothing', async () => {
    const staff = await admin();
    const t0 = vn('2026-09-01 09:00');
    await policy(staff, t0, 'STUDENT', { maxItems: 2, dailyFee: 2000, debtThreshold: 50_000 });
    const bookId = await book();
    const copies = [];
    for (let i = 0; i < 6; i++) copies.push(await copy(staff, t0, bookId));

    // expired card
    const expired = await reader();
    await card(staff, t0, expired, vn('2026-09-05 00:00'));
    const before = await count('loans');
    await expectRule(checkout(staff, T, expired, [copies[0]]), 'CARD_INVALID');

    // debt above threshold (a 150,000 VND lost fine)
    const debtor = await reader();
    await card(staff, t0, debtor);
    const [lostItem] = await checkout(staff, t0, debtor, [copies[1]]);
    await declareLost(staff, vn('2026-09-05 09:00'), lostItem.loanItemId);
    const loansAfterSetup = await count('loans');
    await expectRule(checkout(staff, T, debtor, [copies[0]]), 'DEBT_BLOCKED');

    // overdue item (D7)
    const late = await reader();
    await card(staff, t0, late);
    await checkout(staff, t0, late, [copies[2]]); // due 2026-09-15
    await expectRule(checkout(staff, vn('2026-09-20 10:00'), late, [copies[0]]), 'OVERDUE_BLOCKED');

    // suspended reader
    const suspended = await reader('STUDENT', { status: 'suspended' });
    await card(staff, t0, suspended);
    await expectRule(checkout(staff, T, suspended, [copies[0]]), 'READER_NOT_ACTIVE');

    // at the item limit (max 2)
    const busy = await reader();
    await card(staff, t0, busy);
    await checkout(staff, t0, busy, [copies[3], copies[4]]);
    await expectRule(checkout(staff, T, busy, [copies[0]]), 'LIMIT_REACHED');

    // no policy for LECTURER
    const lecturer = await reader('LECTURER');
    await card(staff, t0, lecturer);
    await expectRule(checkout(staff, T, lecturer, [copies[0]]), 'NO_POLICY');

    expect(before).toBe(0);
    expect(await count('loans')).toBe(loansAfterSetup + 2); // only the setup loans of `late` and `busy`
    expect(await copyStatus(copies[0])).toBe('available');
  });

  it('US3-16 D13: a multi-copy checkout is all-or-nothing', async () => {
    const w = await lendingWorld({ copies: 2 });
    const other = await reader();
    await card(w.staff, w.now, other);
    await checkout(w.staff, T, other, [w.copies[1]]);
    const loans = await count('loans');
    await expectRule(checkout(w.staff, T, w.readerId, [w.copies[0], w.copies[1]]), 'COPY_NOT_AVAILABLE');
    expect(await count('loans')).toBe(loans);
    expect(await copyStatus(w.copies[0])).toBe('available');
  });

  it('VALIDATION and FORBIDDEN', async () => {
    const w = await lendingWorld();
    await expectRule(checkout(w.staff, T, w.readerId, []), 'VALIDATION');
    await expectRule(checkout(w.staff, T, w.readerId, [w.copies[0], w.copies[0]]), 'VALIDATION');
    await expectRule(checkout(w.staff, T, w.readerId, [999999]), 'NOT_FOUND');
    await expectRule(checkout(await account(['reader']), T, w.readerId, [w.copies[0]]), 'FORBIDDEN');
    await expectRule(call('sp_checkout', [w.staff, T, 999999, JSON.stringify([w.copies[0]])]), 'NOT_FOUND');
  });

  it('US2-10 R-09f: a checkout just before a version ends uses it; one at the boundary uses the next', async () => {
    const staff = await admin();
    const setup = vn('2026-09-15 09:00');
    const p1 = await policy(staff, setup, 'STUDENT', {
      validFrom: vn('2026-09-01 00:00'), loanDays: 14, dailyFee: 2000 });
    await call('sp_close_policy_version', [staff, setup, p1, vn('2026-10-01 00:00')]);
    const p2 = await policy(staff, setup, 'STUDENT', {
      validFrom: vn('2026-10-01 00:00'), loanDays: 7, dailyFee: 5000 });
    const bookId = await book();
    const c1 = await copy(staff, setup, bookId);
    const c2 = await copy(staff, setup, bookId);
    const r1 = await reader();
    const r2 = await reader();
    await card(staff, setup, r1);
    await card(staff, setup, r2);

    const [a] = await checkout(staff, vn('2026-09-30 23:59:59.900'), r1, [c1]);
    expect(a.dueAt).toBe(vn('2026-10-14 23:59:59.999'));
    const [b] = await checkout(staff, vn('2026-10-01 00:00:00.000'), r2, [c2]);
    expect(b.dueAt).toBe(vn('2026-10-08 23:59:59.999'));
    const rows = await ownerQuery(`SELECT id, policy_id, applied_daily_fee_vnd fee FROM loan_items ORDER BY id`);
    expect(rows).toEqual([
      { id: a.loanItemId, policy_id: p1, fee: 2000 },
      { id: b.loanItemId, policy_id: p2, fee: 5000 },
    ]);
  });
});
