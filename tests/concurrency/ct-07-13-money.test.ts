import { afterAll, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { race, repeat20 } from '../helpers/concurrency';
import { adjust, lateFine, pay } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'ok' : ((r as PromiseRejectedResult).reason.key ?? String((r as any).reason.errno));

describe('Money concurrency', () => {
  it('CT-7 US4-7 R-16c: two payments of the same remaining balance — exactly one succeeds (20 runs)', async () => {
    await repeat20(async () => {
      const f = await lateFine({ days: 5 }); // 10,000
      const payAll = () => pay(f.world.staff, vn('2026-10-25 09:00'), f.world.readerId, f.amount,
        [{ fineId: f.fineId, amount: f.amount }]);
      const res = await race({ table: 'readers', id: f.world.readerId }, payAll, payAll);
      const outcomes = res.map(outcome).sort();
      expect(outcomes[1]).toBe('ok');
      expect(['ALLOCATION_MISMATCH', 'PAYMENT_EXCEEDS_DEBT']).toContain(outcomes[0]);
      const [n] = await ownerQuery(`SELECT COUNT(*) n FROM fine_payments`);
      expect(Number(n.n)).toBe(1);
    });
  });

  it('CT-13 R-17a: payment × adjustment on the same fine — net never falls below allocated (20 runs)', async () => {
    await repeat20(async () => {
      const f = await lateFine({ days: 5 }); // 10,000
      const res = await race({ table: 'readers', id: f.world.readerId },
        () => pay(f.world.staff, vn('2026-10-25 09:00'), f.world.readerId, f.amount, [{ fineId: f.fineId, amount: f.amount }]),
        () => adjust(f.world.staff, vn('2026-10-25 09:00'), f.fineId, -f.amount, 'waived'));
      const [p, a] = res.map(outcome);
      // payment first → the adjustment would leave net < allocated; adjustment first → nothing left to pay
      expect([['ok', 'FINE_RULE'], ['PAYMENT_EXCEEDS_DEBT', 'ok'], ['ALLOCATION_MISMATCH', 'ok']]).toContainEqual([p, a]);
    });
  });
});
