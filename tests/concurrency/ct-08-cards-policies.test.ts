import { afterAll, describe, expect, it } from 'vitest';
import { call, closeTestPools, ownerQuery } from '../helpers/db';
import { race, repeat20 } from '../helpers/concurrency';
import { admin, materialTypeId, reader, readerTypeId } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

const NOW = vn('2026-09-01 09:00');

describe('CT-8 US2-3 R-08c R-09a: concurrent card issue and policy creation', () => {
  it('two active cards for one reader: exactly one succeeds (20 runs)', async () => {
    await repeat20(async (run) => {
      const staff = await admin();
      const r = await reader();
      const issue = (n: string) => () =>
        call('sp_issue_card', [staff, NOW, r, `CT8-${run}-${n}`, vn('2027-09-01 00:00')], { outParams: ['p_card_id'] });
      const [a, b] = await race({ table: 'readers', id: r }, issue('a'), issue('b'));
      const results = [a, b];
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason.errno).toBe(1062);
      const [n] = await ownerQuery(`SELECT COUNT(*) n FROM library_cards WHERE reader_id = ?`, [r]);
      expect(Number(n.n)).toBe(1);
    });
  });

  it('two overlapping versions for one pair: exactly one succeeds (20 runs)', async () => {
    const typeId = await readerTypeId('STUDENT');
    const mat = await materialTypeId();
    await repeat20(async () => {
      const staff = await admin();
      const create = (from: string) => () =>
        call('sp_create_policy_version', [staff, NOW, typeId, mat, 5, 14, 2, 2000, 50000, from],
          { outParams: ['p_policy_id'] });
      const [a, b] = await race({ table: 'reader_types', id: typeId },
        create(vn('2026-09-01 00:00')), create(vn('2026-10-01 00:00')));
      const results = [a, b];
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason.key).toBe('POLICY_OVERLAP');
    });
  });
});
