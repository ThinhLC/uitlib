import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { call, closeTestPools, ownerQuery } from '../helpers/db';
import { adjust, lateFine, otherReader, pay, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const num = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));

async function rollforward(from: string, to: string, readerId: number | null) {
  const { rows } = await call('sp_report_rollforward', [from, to, readerId]);
  return rows[0].map(num);
}
async function cumulative(asOf: string, readerId: number | null) {
  const { rows } = await call('sp_report_cumulative', [asOf, readerId]);
  return rows[0].map(num);
}

const SEP = [vn('2026-09-01 00:00'), vn('2026-10-01 00:00')] as const;
const OCT = [vn('2026-10-01 00:00'), vn('2026-11-01 00:00')] as const;

describe('US4 debt reports (T059, FR-018)', () => {
  it('US4-14: a fine assessed in September and paid in October', async () => {
    const f = await lateFine({ days: 15, returnedAt: vn('2026-09-25 10:00') });
    expect(f.amount).toBe(30000);
    await pay(f.world.staff, vn('2026-10-05 10:00'), f.world.readerId, 30000, [{ fineId: f.fineId, amount: 30000 }]);
    const r = f.world.readerId;
    expect(await rollforward(...SEP, r)).toEqual([{ reader_id: r, opening_outstanding: 0, assessed_in_period: 30000,
      adjusted_in_period: 0, collected_in_period: 0, closing_outstanding: 30000 }]);
    expect(await rollforward(...OCT, r)).toEqual([{ reader_id: r, opening_outstanding: 30000, assessed_in_period: 0,
      adjusted_in_period: 0, collected_in_period: 30000, closing_outstanding: 0 }]);
    expect(await cumulative(vn('2026-10-31 23:59:59.999'), r)).toEqual([
      { reader_id: r, net_assessed: 30000, collected: 30000, outstanding: 0 }]);
  });

  it('SC-006: cumulative identity and monthly roll-forward hold for every reader', async () => {
    const a = await lateFine({ days: 15, returnedAt: vn('2026-09-20 10:00') });
    const b = await lateFine({ days: 5, returnedAt: vn('2026-10-03 10:00'), world: await otherReader(a.world) });
    await pay(a.world.staff, vn('2026-09-28 10:00'), a.world.readerId, 10000, [{ fineId: a.fineId, amount: 10000 }]);
    await adjust(a.world.staff, vn('2026-10-02 10:00'), a.fineId, -5000, 'goodwill');
    await pay(b.world.staff, vn('2026-10-10 10:00'), b.world.readerId, 4000, [{ fineId: b.fineId, amount: 4000 }]);

    for (const [from, to] of [SEP, OCT]) {
      for (const row of await rollforward(from, to, null)) {
        expect(row.closing_outstanding).toBe(
          row.opening_outstanding + row.assessed_in_period + row.adjusted_in_period - row.collected_in_period);
      }
    }
    // Only reader a has activity by the end of September; b's first fine is on 2026-10-03.
    for (const [asOf, readers] of [[vn('2026-09-30 23:59:59.999'), 1], [vn('2026-10-31 23:59:59.999'), 2]] as const) {
      const rows = await cumulative(asOf, null);
      expect(rows.length).toBe(readers);
      for (const row of rows) expect(row.net_assessed).toBe(row.collected + row.outstanding);
      // collected equals the allocations of those payments (FR-016a)
      const [alloc] = await ownerQuery(
        `SELECT COALESCE(SUM(x.amount_vnd), 0) s FROM fine_payment_allocations x
           JOIN fine_payments p ON p.id = x.payment_id WHERE p.paid_at <= ?`, [asOf]);
      expect(rows.reduce((s, r) => s + r.collected, 0)).toBe(Number(alloc.s));
    }
  });

  it('report views exist and are readable by the app account', async () => {
    await lateFine({ days: 2 });
    for (const v of ['v_report_overdue', 'v_report_loans_by_month', 'v_report_popular_books', 'v_report_copy_status']) {
      const res = await ownerQuery(`SELECT * FROM ${v} LIMIT 1`);
      expect(Array.isArray(res)).toBe(true);
    }
    const [status] = await ownerQuery(`SELECT * FROM v_report_copy_status`);
    expect(Number(status.total)).toBe(
      ['available', 'on_loan', 'on_hold', 'in_repair', 'lost', 'retired'].reduce((s, k) => s + Number(status[k]), 0));
  });
});
