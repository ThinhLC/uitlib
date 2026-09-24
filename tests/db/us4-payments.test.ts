import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appConn, call, closeTestPools, expectErrno, expectRule, ownerQuery } from '../helpers/db';
import { account, card, lateFine, otherReader, pay, reader, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const PAID = vn('2026-10-25 09:00');
const counts = async () => {
  const [r] = await ownerQuery(
    `SELECT (SELECT COUNT(*) FROM fine_payments) p, (SELECT COUNT(*) FROM fine_payment_allocations) a`);
  return [Number(r.p), Number(r.a)];
};

/** A reader with two late fines of 30,000 each (15 days × 2,000). */
async function twoFines() {
  const f1 = await lateFine({ days: 15, returnedAt: vn('2026-10-20 10:00') });
  const f2 = await lateFine({ days: 15, returnedAt: vn('2026-10-21 10:00'), world: f1.world });
  expect([f1.amount, f2.amount]).toEqual([30000, 30000]);
  return { w: f1.world, F1: f1.fineId, F2: f2.fineId };
}

describe('US4 payments (T058)', () => {
  it('US4-5: 40,000 paid as 30,000 + 10,000 → collected 40,000, outstanding 20,000, F1 settled', async () => {
    const { w, F1, F2 } = await twoFines();
    await pay(w.staff, PAID, w.readerId, 40000, [{ fineId: F1, amount: 30000 }, { fineId: F2, amount: 10000 }]);
    const [r] = await ownerQuery(
      `SELECT fn_reader_outstanding(?, ?) outstanding, fn_fine_remaining(?) f1, fn_fine_remaining(?) f2,
              (SELECT SUM(amount_vnd) FROM fine_payments WHERE reader_id = ?) collected`,
      [w.readerId, PAID, F1, F2, w.readerId]);
    expect(r).toEqual({ outstanding: 20000, f1: 0, f2: 20000, collected: '40000' });
  });

  it('US4-6 R-16a/b/c/d: wrong totals, over-allocation or another reader’s fine reject the whole payment', async () => {
    const { w, F1, F2 } = await twoFines();
    const other = await lateFine({ days: 5, world: await otherReader(w) });
    const cases: [number, { fineId: number; amount: number }[], string][] = [
      [40000, [{ fineId: F1, amount: 30000 }, { fineId: F2, amount: 5000 }], 'ALLOCATION_MISMATCH'], // Σ 35,000
      [40000, [{ fineId: F1, amount: 30000 }, { fineId: F2, amount: 15000 }], 'ALLOCATION_MISMATCH'], // Σ 45,000
      [35000, [{ fineId: F1, amount: 35000 }], 'ALLOCATION_MISMATCH'], // over F1's balance
      [10000, [{ fineId: other.fineId, amount: 10000 }], 'ALLOCATION_MISMATCH'], // another reader's fine
      [10000, [], 'VALIDATION'],
      [20000, [{ fineId: F1, amount: 10000 }, { fineId: F1, amount: 10000 }], 'VALIDATION'],
      [10000, [{ fineId: F1, amount: 0 }, { fineId: F2, amount: 10000 }], 'VALIDATION'],
    ];
    for (const [amount, allocations, key] of cases) {
      await expectRule(pay(w.staff, PAID, w.readerId, amount, allocations), key);
    }
    expect(await counts()).toEqual([0, 0]);
  });

  it('PAYMENT_EXCEEDS_DEBT: a payment larger than the outstanding debt', async () => {
    const { w, F1, F2 } = await twoFines();
    await expectRule(pay(w.staff, PAID, w.readerId, 70000,
      [{ fineId: F1, amount: 30000 }, { fineId: F2, amount: 40000 }]), 'PAYMENT_EXCEEDS_DEBT');
    expect(await counts()).toEqual([0, 0]);
  });

  it('US4-12 R-16e: a retried request key returns the existing payment', async () => {
    const { w, F1 } = await twoFines();
    const first = await pay(w.staff, PAID, w.readerId, 10000, [{ fineId: F1, amount: 10000 }], 'K9');
    const again = await pay(w.staff, PAID, w.readerId, 10000, [{ fineId: F1, amount: 10000 }], 'K9');
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ paymentId: first.paymentId, replayed: true });
    expect(await counts()).toEqual([1, 1]);
  });

  it('US4-12 R-16e: reusing a request key with a different payload is rejected', async () => {
    const { w, F1, F2 } = await twoFines();
    await pay(w.staff, PAID, w.readerId, 10000, [{ fineId: F1, amount: 10000 }], 'K7');
    await expectRule(pay(w.staff, PAID, w.readerId, 20000, [{ fineId: F1, amount: 20000 }], 'K7'), 'IDEMPOTENCY_CONFLICT');
    await expectRule(pay(w.staff, PAID, w.readerId, 10000, [{ fineId: F2, amount: 10000 }], 'K7'), 'IDEMPOTENCY_CONFLICT');
    const other = await otherReader(w);
    await expectRule(pay(w.staff, PAID, other.readerId, 10000, [{ fineId: F1, amount: 10000 }], 'K7'),
      'IDEMPOTENCY_CONFLICT');
    expect(await counts()).toEqual([1, 1]);
  });

  it('US4-13 R-26 B-2: the app account cannot write money tables directly (1142)', async () => {
    const { w, F1 } = await twoFines();
    const conn = await appConn();
    try {
      await expectErrno(conn.query(
        `INSERT INTO fine_payments (reader_id, received_by_user_id, amount_vnd, paid_at, method, request_key, created_at)
         VALUES (?, ?, 1000, ?, 'cash', 'X', ?)`, [w.readerId, w.staff, PAID, PAID]), 1142);
      await expectErrno(conn.query(
        `INSERT INTO fine_payment_allocations (payment_id, fine_id, amount_vnd) VALUES (1, ?, 1000)`, [F1]), 1142);
    } finally {
      await conn.end();
    }
  });

  it('R-20: FORBIDDEN without fine.collect; NOT_FOUND for a missing reader', async () => {
    const { w, F1 } = await twoFines();
    await expectRule(pay(await account(['reader']), PAID, w.readerId, 10000, [{ fineId: F1, amount: 10000 }]), 'FORBIDDEN');
    const stranger = await reader();
    await card(w.staff, w.now, stranger);
    await expectRule(pay(w.staff, PAID, stranger, 10000, [{ fineId: F1, amount: 10000 }]), 'PAYMENT_EXCEEDS_DEBT');
    await expectRule(call('sp_record_payment', [w.staff, PAID, 999999, 1000, 'cash', null, 'NF', '[{"fine_id":1,"amount_vnd":1000}]'],
      { outParams: ['p_payment_id', 'p_replayed'] }), 'NOT_FOUND');
  });
});
