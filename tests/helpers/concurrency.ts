import type { Connection } from 'mysql2/promise';
import { expect } from 'vitest';
import { findViolations } from '../../scripts/db/check';
import { appConn, ownerConn } from './db';
import { truncateAll } from './fixtures';

export interface Gate {
  release(): Promise<void>;
}

/** Hold `SELECT … FOR UPDATE` on the first contested row so both racing calls queue behind it. */
export async function gate(table: string, id: number): Promise<Gate> {
  const conn = await ownerConn();
  await conn.query('BEGIN');
  await conn.query(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [id]);
  return {
    async release() {
      await conn.query('COMMIT');
      await conn.end();
    },
  };
}

/** Poll performance_schema until `n` sessions wait on a row lock in the test schema. */
export async function waitForWaiters(n: number, timeoutMs = 10_000): Promise<void> {
  const conn = await ownerConn();
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [[r]] = (await conn.query(
        `SELECT COUNT(DISTINCT w.REQUESTING_THREAD_ID) n
           FROM performance_schema.data_lock_waits w
           JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
          WHERE l.OBJECT_SCHEMA = DATABASE()`,
      )) as any;
      if (Number(r.n) >= n) return;
      if (Date.now() > deadline) throw new Error(`only ${r.n} of ${n} sessions waited`);
      await new Promise((res) => setTimeout(res, 20));
    }
  } finally {
    await conn.end();
  }
}

/**
 * Start the gate, fire both calls (each on its own pooled connection), wait until both are
 * blocked behind the gate, release it, and return both settled results.
 */
export async function race<A, B>(
  gateOn: { table: string; id: number },
  callA: () => Promise<A>,
  callB: () => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const g = await gate(gateOn.table, gateOn.id);
  const pa = callA();
  const pb = callB();
  // Prevent unhandled rejections while we wait.
  pa.catch(() => {});
  pb.catch(() => {});
  try {
    await waitForWaiters(2);
  } finally {
    await g.release();
  }
  return Promise.allSettled([pa, pb]) as Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]>;
}

/** Assert that every invariant view is empty. */
export async function expectNoViolations(): Promise<void> {
  const conn: Connection = await appConn();
  try {
    const violations = await findViolations(conn);
    expect(violations, JSON.stringify(violations)).toEqual([]);
  } finally {
    await conn.end();
  }
}

/** Run a concurrency body `times` times on a clean database, checking invariants after each run. */
export async function repeat20(body: (run: number) => Promise<void>, times = 20): Promise<void> {
  for (let run = 1; run <= times; run++) {
    await truncateAll();
    await body(run);
    await expectNoViolations();
  }
}
