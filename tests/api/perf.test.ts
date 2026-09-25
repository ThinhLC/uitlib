import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { admin, book, card, copy, lateFine, policy, reader, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { createTestApp, req, TestClock } from './helpers/app';
import { signToken } from './helpers/tokens';

afterAll(closeTestPools);

/**
 * SC-007: p95 under 1 s for catalog searches and desk operations at fixture volume
 * (50 books × 2 authors, 100 copies, 30 readers with cards). Measured in-process through
 * `app.request`, so Next.js and network overhead are not included (analysis A1).
 */
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

const WORDS = ['Database', 'Systems', 'Design', 'Networks', 'Algorithms', 'Compilers', 'Security', 'Graphics', 'Learning', 'Physics'];

describe('API performance (SC-007)', () => {
  const clock = new TestClock();
  const { app } = createTestApp({ clock });
  let staffToken = '';
  const readers: number[] = [];
  const copies: number[] = [];
  const books: number[] = [];
  let staffId = 0;

  beforeAll(async () => {
    await truncateAll();
    const staff = await admin();
    staffId = staff;
    const t0 = vn('2026-09-01 09:00');
    await policy(staff, t0, 'STUDENT', { maxItems: 5 });
    for (let i = 0; i < 50; i++) {
      books.push(await book({
        title: `${WORDS[i % 10]} ${WORDS[(i * 3) % 10]} volume ${i}`,
        authors: [`Author ${i}a`, `Author ${i}b`],
        categories: [`Category ${i}`],
      }));
    }
    for (let i = 0; i < 100; i++) copies.push(await copy(staff, t0, books[i % 50]));
    for (let i = 0; i < 30; i++) {
      const r = await reader();
      await card(staff, t0, r);
      readers.push(r);
    }
    const [row] = await ownerQuery(`SELECT supabase_user_id s FROM app_users WHERE id = ?`, [staff]);
    staffToken = await signToken({ sub: String(row.s) });
    clock.set(vn('2026-09-10 10:00'));
  }, 300_000);

  it('catalog search p95 < 1 s', async () => {
    const ms: number[] = [];
    for (let i = 0; i < 50; i++) {
      const res = await timed(() => req(app, 'GET', '/catalog/books', { query: { q: WORDS[i % 10], pageSize: 20 } }), ms);
      expect(res.status).toBe(200);
    }
    expect(pct(ms, 95)).toBeLessThan(1000);
  });

  it('checkout (up to 5 copies) and return p95 < 1 s', async () => {
    const checkoutMs: number[] = [];
    const returnMs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const n = (i % 5) + 1;
      const batch = copies.slice(i * 5, i * 5 + n);
      const res = await timed(
        () => req(app, 'POST', '/loans', { token: staffToken, body: { readerId: readers[i], copyIds: batch } }),
        checkoutMs,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      for (const item of res.body.items) {
        const r = await timed(
          () => req(app, 'POST', `/loan-items/${item.loanItemId}/return`, { token: staffToken, body: { condition: 'good' } }),
          returnMs,
        );
        expect(r.status).toBe(200);
      }
    }
    expect(pct(checkoutMs, 95)).toBeLessThan(1000);
    expect(pct(returnMs, 95)).toBeLessThan(1000);
  });

  it('payment p95 < 1 s', async () => {
    // A 30-day late fine for the last reader, on a book whose copies are all back on the shelf.
    const world = { staff: staffId, now: vn('2026-09-01 09:00'), readerId: readers[29], bookId: books[49] };
    const { fineId } = await lateFine({ days: 30, world });
    const token = staffToken;
    clock.set(vn('2026-10-21 10:00'));
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await timed(() => req(app, 'POST', '/payments', {
        token,
        body: { readerId: world.readerId, amountVnd: 1000, method: 'cash', requestKey: randomUUID(), allocations: [{ fineId, amountVnd: 1000 }] },
      }), ms);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    expect(pct(ms, 95)).toBeLessThan(1000);
  });
});
