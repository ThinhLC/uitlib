import { afterAll, describe, expect, it } from 'vitest';
import { call, closeTestPools, ownerQuery } from '../helpers/db';
import { race, repeat20 } from '../helpers/concurrency';
import { admin, book, card, checkout, copy, declareLost, lendingWorld, policy, reader, returnItem } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'ok' : ((r as PromiseRejectedResult).reason.key ?? String((r as any).reason.errno));

describe('Cross-flow concurrency (T048)', () => {
  it('CT-4: return (assesses a late fine over the debt threshold) × checkout by the same reader (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld({ copies: 2, policy: { dailyFee: 20_000, debtThreshold: 50_000, loanDays: 14 } });
      const [li] = await checkout(w.staff, vn('2026-09-01 10:00'), w.readerId, [w.copies[0]]); // due 09-15
      const res = await race({ table: 'readers', id: w.readerId },
        // returned 3 days late: 60,000 VND > 50,000 threshold
        () => returnItem(w.staff, vn('2026-09-18 10:00'), li.loanItemId),
        // the checkout's own clock is before the due date, so only the new fine can block it
        () => checkout(w.staff, vn('2026-09-14 10:00'), w.readerId, [w.copies[1]]));
      expect(outcome(res[0])).toBe('ok');
      // Serial order return → checkout gives DEBT_BLOCKED; checkout → return gives ok.
      expect(['ok', 'DEBT_BLOCKED']).toContain(outcome(res[1]));
      const [f] = await ownerQuery(`SELECT SUM(assessed_amount_vnd) s FROM fines`);
      expect(Number(f.s)).toBe(60_000);
    });
  });

  it('CT-5: return × lost declaration of the same loan item — exactly one terminal state (20 runs)', async () => {
    await repeat20(async () => {
      const w = await lendingWorld();
      const [li] = await checkout(w.staff, vn('2026-09-01 10:00'), w.readerId, [w.copies[0]]);
      const res = await race({ table: 'readers', id: w.readerId },
        () => returnItem(w.staff, vn('2026-09-10 10:00'), li.loanItemId),
        () => declareLost(w.staff, vn('2026-09-10 10:00'), li.loanItemId));
      const outcomes = res.map(outcome).sort();
      expect(outcomes).toEqual(['INVALID_TRANSITION', 'ok']);
      const [row] = await ownerQuery(`SELECT status FROM loan_items WHERE id = ?`, [li.loanItemId]);
      const fines = await ownerQuery(`SELECT fine_type FROM fines ORDER BY fine_type`);
      if (row.status === 'lost') expect(fines.map((x: any) => x.fine_type)).toEqual(['lost']);
      else expect(fines).toEqual([]);
    });
  });

  it('CT-6 R-09f: checkout × policy close at the boundary — the item always lies inside its version (20 runs)', async () => {
    await repeat20(async () => {
      const staff = await admin();
      const setup = vn('2026-09-01 09:00');
      const p1 = await policy(staff, setup, 'STUDENT', { validFrom: vn('2026-09-01 00:00') });
      const r = await reader();
      await card(staff, setup, r);
      const c = await copy(staff, setup, await book());
      const boundary = vn('2026-10-01 00:00');
      const res = await race({ table: 'loan_policies', id: p1 },
        () => checkout(staff, boundary, r, [c]),
        () => call('sp_close_policy_version', [staff, vn('2026-09-30 23:00'), p1, boundary]));
      const [co, cl] = res.map(outcome);
      // Either the checkout committed first (close rejected), or the close did (no version at the boundary).
      expect([['ok', 'POLICY_CLOSE_REJECTED'], ['NO_POLICY', 'ok']]).toContainEqual([co, cl]);
    });
  });
});
