import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CATEGORY, ERROR_KEYS, type ErrorKey } from '@/lib/api/contract';
import { createSupabaseVerifier } from '@/integrations/supabase/verify-token';
import { DbRuleError } from '@/lib/db/call-procedure';
import { mapError } from '@/server/api/errors/map-error';
import { closeTestPools, ownerQuery } from '../helpers/db';
import {
  book, card, checkout, copy, lateFine, lendingWorld, reader, returnItem, truncateAll,
} from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, createTestApp, req, TestClock, type Res } from './helpers/app';
import { signToken } from './helpers/tokens';

afterAll(closeTestPools);
beforeEach(truncateAll);

/** A token for an existing account (fixtures create staff accounts by id). */
async function tokenFor(accountId: number): Promise<string> {
  const [row] = await ownerQuery(`SELECT supabase_user_id s FROM app_users WHERE id = ?`, [accountId]);
  return signToken({ sub: String(row.s) });
}

/** A lending world plus an app whose clock sits at `at` (library-local), and a staff token. */
async function desk(opts: Parameters<typeof lendingWorld>[0] = {}, at = '2026-09-10 10:00') {
  const w = await lendingWorld(opts);
  const clock = new TestClock();
  clock.set(vn(at));
  const { app } = createTestApp({ clock });
  return { w, app, clock, token: await tokenFor(w.staff) };
}

/** Each producible key → the HTTP request that produces it (SC-002). */
const produce: Partial<Record<ErrorKey, () => Promise<Res>>> = {
  UNAUTHENTICATED: async () => req(createTestApp().app, 'GET', '/me'),
  ACCOUNT_INACTIVE: async () => {
    const a = await asAccount(['librarian'], { status: 'inactive' });
    return req(createTestApp().app, 'GET', '/reference/reader-types', { token: a.token });
  },
  ROUTE_NOT_FOUND: async () => req(createTestApp().app, 'GET', '/no-such-route'),
  AUTH_UNAVAILABLE: async () => {
    // Nothing listens on port 9: the JWKS fetch fails, so the key set is unavailable.
    const { app } = createTestApp({ deps: { verifyToken: createSupabaseVerifier('http://127.0.0.1:9') } });
    return req(app, 'GET', '/me', { token: await signToken() });
  },
  BUSY: async () => {
    const conn = {
      query: async (sql: string) => {
        if (/^CALL /.test(sql)) throw Object.assign(new Error('Lock wait timeout exceeded'), { errno: 1205 });
        return [[], []];
      },
      release: () => {},
    };
    const { w, token } = await desk();
    const real = createTestApp().deps.pool;
    const pool = new Proxy(real, { get: (t, p) => (p === 'getConnection' ? async () => conn : (t as any)[p]) });
    const { app } = createTestApp({ deps: { pool } });
    return req(app, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: [w.copies[0]] } });
  },
  FORBIDDEN: async () => {
    const { w, app } = await desk();
    const r = await asAccount(['reader']);
    return req(app, 'POST', '/loans', { token: r.token, body: { readerId: w.readerId, copyIds: [w.copies[0]] } });
  },
  NOT_FOUND: async () => {
    const { app, token } = await desk();
    return req(app, 'POST', '/loan-items/999999/return', { token, body: { condition: 'good' } });
  },
  VALIDATION: async () => {
    // Raised by sp_reserve: the book has an available copy (D6).
    const { w, app, token } = await desk();
    return req(app, 'POST', '/reservations', { token, body: { readerId: w.readerId, bookId: w.bookId } });
  },
  COPY_NOT_AVAILABLE: async () => {
    const { w, app, token } = await desk();
    await checkout(w.staff, w.now, w.readerId, [w.copies[0]]);
    return req(app, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: [w.copies[0]] } });
  },
  READER_NOT_ACTIVE: async () => {
    const { w, app, token } = await desk();
    await ownerQuery(`UPDATE readers SET status = 'suspended' WHERE id = ?`, [w.readerId]);
    return req(app, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: [w.copies[0]] } });
  },
  CARD_INVALID: async () => {
    const { w, app, token } = await desk();
    const noCard = await reader();
    return req(app, 'POST', '/loans', { token, body: { readerId: noCard, copyIds: [w.copies[0]] } });
  },
  DEBT_BLOCKED: async () => {
    const { world } = await lateFine({ days: 5, world: await lendingWorld({ copies: 2, policy: { debtThreshold: 0 } }) });
    const clock = new TestClock();
    clock.set(vn('2026-10-21 10:00'));
    const { app } = createTestApp({ clock });
    const free = world.copies[1];
    return req(app, 'POST', '/loans', { token: await tokenFor(world.staff), body: { readerId: world.readerId, copyIds: [free] } });
  },
  OVERDUE_BLOCKED: async () => {
    const { w, app, token } = await desk({ copies: 2 }, '2026-10-01 10:00');
    await checkout(w.staff, w.now, w.readerId, [w.copies[0]]); // due 2026-09-15 local
    return req(app, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: [w.copies[1]] } });
  },
  LIMIT_REACHED: async () => {
    const { w, app, token } = await desk({ copies: 2, policy: { maxItems: 1 } });
    return req(app, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: w.copies } });
  },
  NO_POLICY: async () => {
    const { w, app, token } = await desk();
    const lecturer = await reader('LECTURER');
    await card(w.staff, w.now, lecturer);
    return req(app, 'POST', '/loans', { token, body: { readerId: lecturer, copyIds: [w.copies[0]] } });
  },
  RENEWAL_REJECTED: async () => {
    const { w, app, token } = await desk();
    const [li] = await checkout(w.staff, w.now, w.readerId, [w.copies[0]]);
    await returnItem(w.staff, vn('2026-09-05 10:00'), li.loanItemId);
    return req(app, 'POST', `/loan-items/${li.loanItemId}/renew`, { token });
  },
  INVALID_TRANSITION: async () => {
    const { w, app, token } = await desk();
    const [c] = await ownerQuery(`SELECT id FROM library_cards WHERE reader_id = ?`, [w.readerId]);
    await req(app, 'POST', `/cards/${c.id}/status`, { token, body: { status: 'lost' } });
    return req(app, 'POST', `/cards/${c.id}/status`, { token, body: { status: 'lost' } });
  },
  POLICY_OVERLAP: async () => {
    const { app, token } = await desk();
    return req(app, 'POST', '/policies', {
      token,
      body: {
        readerType: 'STUDENT', materialType: 'BOOK_PRINT', maxActiveItems: 5, loanDays: 14, maxRenewals: 2,
        dailyLateFeeVnd: 2000, debtBlockThresholdVnd: 50000, validFrom: '2026-12-01T00:00:00+07:00',
      },
    });
  },
  POLICY_CLOSE_REJECTED: async () => {
    const { w, app, token } = await desk();
    return req(app, 'POST', `/policies/${w.policyId}/close`, { token, body: { validTo: '2026-09-05T00:00:00+07:00' } });
  },
  FINE_RULE: async () => {
    const { world, fineId, amount } = await lateFine({ days: 3 });
    const { app } = createTestApp();
    return req(app, 'POST', `/fines/${fineId}/adjustments`, {
      token: await tokenFor(world.staff), body: { amountVnd: -(amount + 1), reason: 'too much' },
    });
  },
  ALLOCATION_MISMATCH: async () => {
    const { world, fineId, amount } = await lateFine({ days: 3 });
    const { app } = createTestApp();
    return req(app, 'POST', '/payments', {
      token: await tokenFor(world.staff),
      body: { readerId: world.readerId, amountVnd: amount, method: 'cash', requestKey: randomUUID(), allocations: [{ fineId, amountVnd: amount - 1 }] },
    });
  },
  PAYMENT_EXCEEDS_DEBT: async () => {
    const { world, fineId, amount } = await lateFine({ days: 3 });
    const { app } = createTestApp();
    return req(app, 'POST', '/payments', {
      token: await tokenFor(world.staff),
      body: { readerId: world.readerId, amountVnd: amount + 1000, method: 'cash', requestKey: randomUUID(), allocations: [{ fineId, amountVnd: amount + 1000 }] },
    });
  },
  IDEMPOTENCY_CONFLICT: async () => {
    const { world, fineId } = await lateFine({ days: 3 });
    const { app } = createTestApp();
    const token = await tokenFor(world.staff);
    const requestKey = randomUUID();
    const body = (n: number) => ({ readerId: world.readerId, amountVnd: n, method: 'cash', requestKey, allocations: [{ fineId, amountVnd: n }] });
    expect((await req(app, 'POST', '/payments', { token, body: body(1000) })).status).toBe(201);
    return req(app, 'POST', '/payments', { token, body: body(2000) });
  },
  DUPLICATE: async () => {
    const { w, app, token } = await desk();
    const bookId = await book();
    await copy(w.staff, w.now, bookId, { barcode: 'DUP-1' });
    return req(app, 'POST', `/books/${bookId}/copies`, { token, body: { barcode: 'DUP-1', condition: 'good' } });
  },
};

/** Keys no route can produce, and why; they are still mapped and documented. */
const unreachable: Partial<Record<ErrorKey, string>> = {
  POLICY_IMMUTABLE: 'trigger guard: no route updates policy values',
  SNAPSHOT_IMMUTABLE: 'trigger guard: no route updates loan item snapshots',
  APPEND_ONLY: 'trigger guard: no route updates or deletes money rows',
  COPY_STATE: 'needs rows that break invariant I-1/I-2, which only raw SQL can create',
  INTERNAL: 'any unexpected error; covered by errors.test.ts',
};

describe('Error key matrix (SC-002)', () => {
  it('every contract key is either produced over HTTP or listed as unreachable', () => {
    const missing = ERROR_KEYS.filter((k) => !(k in produce) && !(k in unreachable));
    const both = ERROR_KEYS.filter((k) => k in produce && k in unreachable);
    expect(missing).toEqual([]);
    expect(both).toEqual([]);
  });

  for (const [key, run] of Object.entries(produce) as [ErrorKey, () => Promise<Res>][]) {
    it(`${key} is produced with its category`, async () => {
      const res = await run();
      expect(res.body?.error?.key, JSON.stringify(res.body)).toBe(key);
      expect(res.body.error.category).toBe(ERROR_CATEGORY[key]);
    });
  }

  for (const key of Object.keys(unreachable) as ErrorKey[]) {
    it(`${key} (unreachable: ${unreachable[key]}) is still mapped`, () => {
      const err = key === 'INTERNAL' ? new Error('x') : new DbRuleError(key, 'd', `${key}: d`);
      const mapped = mapError(err, 'r', { error: () => {}, info: () => {} });
      expect(mapped.body.error.key).toBe(key);
      expect(mapped.body.error.category).toBe(ERROR_CATEGORY[key]);
    });
  }
});
