import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appConn, call, closeTestPools, expectErrno, expectRule, ownerQuery } from '../helpers/db';
import { account, admin, book, copy, materialTypeId, policy, reader, readerTypeId, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { rawFixture } from '../helpers/invariants-after-each';

afterAll(closeTestPools);
beforeEach(truncateAll);

const close = (actor: number, now: string, id: number, validTo: string | null) =>
  call('sp_close_policy_version', [actor, now, id, validTo]);

/** Insert a loan item referencing `policyId`, borrowed at `borrowedAt` (owner, direct). */
async function loanItemFor(policyId: number, borrowedAt: string) {
  const staff = await admin();
  const copyId = await copy(staff, vn('2026-01-01 00:00'), await book());
  const r = await reader();
  const loan: any = await ownerQuery(
    `INSERT INTO loans (reader_id, processed_by_user_id, borrowed_at, status, created_at) VALUES (?, ?, ?, 'open', ?)`,
    [r, staff, borrowedAt, borrowedAt]);
  await ownerQuery(
    `INSERT INTO loan_items (loan_id, copy_id, policy_id, borrowed_at, due_at, status, renewal_count,
                             applied_loan_days, applied_max_renewals, applied_daily_fee_vnd)
     VALUES (?, ?, ?, ?, fn_due_at(?, 14), 'on_loan', 0, 14, 2, 2000)`,
    [loan.insertId, copyId, policyId, borrowedAt, borrowedAt]);
}

describe('US2 loan policy versions (T039)', () => {
  it('US2-4 R-09a/b: overlapping versions are rejected; close + create at the same instant works', async () => {
    const staff = await admin();
    const now = vn('2026-09-15 09:00');
    const p1 = await policy(staff, now, 'STUDENT', { validFrom: vn('2026-09-01 00:00') });
    await expectRule(policy(staff, now, 'STUDENT', { validFrom: vn('2026-10-01 00:00') }), 'POLICY_OVERLAP');
    await close(staff, now, p1, vn('2026-10-01 00:00'));
    const p2 = await policy(staff, now, 'STUDENT', { validFrom: vn('2026-10-01 00:00'), loanDays: 7, dailyFee: 5000 });
    expect(p2).toBeGreaterThan(p1);
    // another reader type is independent
    await policy(staff, now, 'LECTURER', { validFrom: vn('2026-09-01 00:00') });
    // bypass guard: a direct overlapping insert is rejected by the trigger
    await expectRule(ownerQuery(
      `INSERT INTO loan_policies (reader_type_id, material_type_id, max_active_items, loan_days, max_renewals,
         daily_late_fee_vnd, debt_block_threshold_vnd, valid_from, valid_to, created_by_user_id, created_at)
       VALUES (?, ?, 5, 14, 2, 2000, 50000, ?, NULL, ?, ?)`,
      [await readerTypeId('STUDENT'), await materialTypeId(), vn('2026-11-01 00:00'), staff, now]), 'POLICY_OVERLAP');
    // CHECK valid_to > valid_from
    await expectErrno(ownerQuery(
      `INSERT INTO loan_policies (reader_type_id, material_type_id, max_active_items, loan_days, max_renewals,
         daily_late_fee_vnd, debt_block_threshold_vnd, valid_from, valid_to, created_by_user_id, created_at)
       VALUES (?, ?, 5, 14, 2, 2000, 50000, ?, ?, ?, ?)`,
      [await readerTypeId('EXTERNAL'), await materialTypeId(), vn('2026-11-01 00:00'), vn('2026-11-01 00:00'), staff, now]),
      3819);
  });

  it('US2-5 R-09c B-3: business values cannot be updated in place', async () => {
    const staff = await admin();
    const p1 = await policy(staff, vn('2026-09-01 09:00'));
    for (const col of ['daily_late_fee_vnd', 'loan_days', 'max_active_items', 'max_renewals', 'debt_block_threshold_vnd']) {
      await expectRule(ownerQuery(`UPDATE loan_policies SET ${col} = ${col} + 1 WHERE id = ?`, [p1]), 'POLICY_IMMUTABLE');
    }
    const conn = await appConn();
    try {
      await expectErrno(conn.query(`UPDATE loan_policies SET daily_late_fee_vnd = 9999 WHERE id = ?`, [p1]), 1142);
    } finally {
      await conn.end();
    }
  });

  it('US2-6 R-09d: a referenced version cannot be deleted; an unreferenced one can', async () => {
    rawFixture(); // builds loan/reservation rows directly as the owner
    const staff = await admin();
    const now = vn('2026-09-15 09:00');
    const used = await policy(staff, now, 'STUDENT', { validFrom: vn('2026-09-01 00:00') });
    await loanItemFor(used, vn('2026-09-10 10:00'));
    await expectErrno(ownerQuery(`DELETE FROM loan_policies WHERE id = ?`, [used]), 1451);
    const unused = await policy(staff, now, 'LECTURER', { validFrom: vn('2026-09-01 00:00') });
    await ownerQuery(`DELETE FROM loan_policies WHERE id = ?`, [unused]);
  });

  it('US2-8 R-09e: closing may not be retroactive, extend, clear, or cut off an existing borrow', async () => {
    rawFixture(); // builds loan/reservation rows directly as the owner
    const staff = await admin();
    const p1 = await policy(staff, vn('2026-09-15 09:00'), 'STUDENT', { validFrom: vn('2026-09-01 00:00') });
    await close(staff, vn('2026-09-15 09:00'), p1, vn('2026-10-01 00:00'));
    const now = vn('2026-10-02 09:00');
    await expectRule(close(staff, now, p1, vn('2026-09-30 00:00')), 'POLICY_CLOSE_REJECTED'); // retroactive
    await expectRule(close(staff, now, p1, vn('2026-10-05 00:00')), 'POLICY_CLOSE_REJECTED'); // later
    await expectRule(close(staff, now, p1, null), 'POLICY_CLOSE_REJECTED'); // clear

    const p3 = await policy(staff, vn('2026-09-15 09:00'), 'LECTURER', { validFrom: vn('2026-09-01 00:00') });
    await loanItemFor(p3, vn('2026-09-20 10:00'));
    await expectRule(close(staff, vn('2026-09-15 09:00'), p3, vn('2026-09-18 00:00')), 'POLICY_CLOSE_REJECTED');
    await expectRule(close(staff, vn('2026-09-15 09:00'), p3, vn('2026-09-20 10:00')), 'POLICY_CLOSE_REJECTED');
    await close(staff, vn('2026-09-15 09:00'), p3, vn('2026-09-20 10:00:00.001'));
  });

  it('R-20: FORBIDDEN without policy.manage (librarians do not have it)', async () => {
    const librarian = await account(['librarian']);
    await expectRule(policy(librarian, vn('2026-09-01 09:00')), 'FORBIDDEN');
    const staff = await admin();
    const p = await policy(staff, vn('2026-09-01 09:00'));
    await expectRule(close(librarian, vn('2026-09-01 09:00'), p, vn('2026-12-01 00:00')), 'FORBIDDEN');
  });
});
