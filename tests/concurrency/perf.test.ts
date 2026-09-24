import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestPools } from '../helpers/db';
import { admin, book, card, checkout, copy, policy, reader, returnItem, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function timed<T>(fn: () => Promise<T>, into: number[]): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  into.push(performance.now() - t0);
  return r;
}

describe('Performance goals (plan Technical Context, T056)', () => {
  it('sp_checkout and sp_return_item: p50 < 200 ms, p95 < 1 s', async () => {
    await truncateAll();
    const staff = await admin();
    const t0 = vn('2026-09-01 09:00');
    await policy(staff, t0, 'STUDENT', { maxItems: 5 });
    const bookId = await book();
    const N = 60;
    const copies: number[] = [];
    const readers: number[] = [];
    for (let i = 0; i < N; i++) {
      copies.push(await copy(staff, t0, bookId));
      const r = await reader();
      await card(staff, t0, r);
      readers.push(r);
    }
    const checkoutMs: number[] = [];
    const returnMs: number[] = [];
    const items: number[] = [];
    for (let i = 0; i < N; i++) {
      const [li] = await timed(() => checkout(staff, vn('2026-09-10 10:00'), readers[i], [copies[i]]), checkoutMs);
      items.push(li.loanItemId);
    }
    for (let i = 0; i < N; i++) {
      await timed(() => returnItem(staff, vn('2026-09-12 10:00'), items[i]), returnMs);
    }
    const row = (name: string, xs: number[]) =>
      `| ${name} | ${xs.length} | ${pct(xs, 50).toFixed(1)} | ${pct(xs, 95).toFixed(1)} | ${Math.max(...xs).toFixed(1)} |`;
    mkdirSync('docs/report', { recursive: true });
    writeFileSync('docs/report/performance.md', [
      '# Performance of operation procedures',
      '',
      `Measured by \`tests/concurrency/perf.test.ts\` on ${new Date().toISOString().slice(0, 10)} against the local`,
      'Docker MySQL 8.4 test schema, including the client round trip (callProcedure).',
      'Goal (plan.md Technical Context): p50 < 200 ms and p95 < 1 s.',
      '',
      '| Procedure | Calls | p50 (ms) | p95 (ms) | max (ms) |',
      '| --- | --- | --- | --- | --- |',
      row('sp_checkout', checkoutMs),
      row('sp_return_item', returnMs),
      '',
    ].join('\n'));
    expect(pct(checkoutMs, 50)).toBeLessThan(200);
    expect(pct(checkoutMs, 95)).toBeLessThan(1000);
    expect(pct(returnMs, 50)).toBeLessThan(200);
    expect(pct(returnMs, 95)).toBeLessThan(1000);
  });
});
