import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery, testAppPool } from '../helpers/db';
import { expectNoViolations } from '../helpers/concurrency';
import { lendingWorld, otherReader, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, createTestApp, req, TestClock } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const clock = new TestClock();
clock.set(vn('2026-09-10 10:00'));
const { app } = createTestApp({ clock });

describe('US2 concurrency (SC-004, US2-7, US2-8)', () => {
  it('US2-7: 20 parallel checkouts of one copy → exactly one 201 and 19 COPY_NOT_AVAILABLE', async () => {
    const w = await lendingWorld({ copies: 1 });
    const readers = [w.readerId];
    for (let i = 1; i < 20; i++) readers.push((await otherReader(w)).readerId);
    const { token } = await asAccount(['librarian']);

    const results = await Promise.all(
      readers.map((readerId) => req(app, 'POST', '/loans', { token, body: { readerId, copyIds: w.copies } })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.status !== 201);
    expect(rejected.map((r) => [r.status, r.body.error.key])).toEqual(Array(19).fill([409, 'COPY_NOT_AVAILABLE']));

    const [n] = await ownerQuery(`SELECT COUNT(*) n FROM loan_items WHERE copy_id = ?`, [w.copies[0]]);
    expect(Number(n.n)).toBe(1);
    await expectNoViolations();
  });

  it('US2-8: a lock wait timeout on CALL → 503 BUSY with Retry-After', async () => {
    const real = testAppPool();
    const stub = {
      query: (...args: any[]) => (real.query as any)(...args),
      getConnection: async () => ({
        query: async (sql: string) => {
          if (/^\s*CALL\b/i.test(sql)) throw Object.assign(new Error('Lock wait timeout'), { errno: 1205 });
          return [[], []];
        },
        release: () => {},
      }),
    };
    const busy = createTestApp({ clock, deps: { pool: stub as any } }).app;
    const w = await lendingWorld({ copies: 1 });
    const { token } = await asAccount(['librarian']);

    const res = await req(busy, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: w.copies } });
    expect(res.status).toBe(503);
    expect(res.body.error.key).toBe('BUSY');
    expect(res.headers.get('retry-after')).toBe('1');
    const [n] = await ownerQuery('SELECT COUNT(*) n FROM loans');
    expect(Number(n.n)).toBe(0);
  });
});
