import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { lateFine, lendingWorld, otherReader, pay, reader, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, asReader, createTestApp, req, TestClock } from './helpers/app';

afterAll(closeTestPools);

const clock = new TestClock();
const { app } = createTestApp({ clock });

beforeEach(async () => {
  await truncateAll();
  clock.set(vn('2026-10-25 10:00'));
});

/** A reader with late fines of 30,000 and 20,000 (daily fee 2,000). */
async function twoFines() {
  const world = await lendingWorld({ copies: 4, policy: { dailyFee: 2000, loanDays: 14 } });
  const a = await lateFine({ days: 15, world, returnedAt: vn('2026-10-20 10:00') });
  const b = await lateFine({ days: 10, world, returnedAt: vn('2026-10-21 10:00') });
  expect([a.amount, b.amount]).toEqual([30_000, 20_000]);
  return { world, readerId: world.readerId as number, fineA: a.fineId, fineB: b.fineId };
}

const payment = (readerId: number, amountVnd: number, allocations: { fineId: number; amountVnd: number }[], requestKey: string = randomUUID()) => ({
  readerId, amountVnd, method: 'cash', requestKey, allocations,
});

const paymentCount = async () => Number((await ownerQuery('SELECT COUNT(*) n FROM fine_payments'))[0].n);

describe('US5 fines, payments, adjustments', () => {
  it('US5-1: a split payment leaves the right balance, fines and payment list', async () => {
    const { readerId, fineA, fineB } = await twoFines();
    const lib = await asAccount(['librarian']);
    const res = await req(app, 'POST', '/payments', {
      token: lib.token,
      body: { ...payment(readerId, 40_000, [{ fineId: fineA, amountVnd: 30_000 }, { fineId: fineB, amountVnd: 10_000 }]), referenceNo: 'R-1' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ replayed: false });
    expect(res.body.paymentId).toBeGreaterThan(0);

    const bal = await req(app, 'GET', `/readers/${readerId}/balance`, { token: lib.token });
    expect(bal.status).toBe(200);
    expect(bal.body).toEqual({ readerId, outstandingVnd: 10_000, asOf: '2026-10-25T03:00:00.000Z' });

    const all = await req(app, 'GET', `/readers/${readerId}/fines`, { token: lib.token });
    expect(all.body.total).toBe(2);
    const open = await req(app, 'GET', `/readers/${readerId}/fines`, { token: lib.token, query: { open: true } });
    expect(open.body.total).toBe(1);
    expect(open.body.items[0]).toMatchObject({
      id: fineB, type: 'late', assessedAmountVnd: 20_000, adjustmentsVnd: 0, netVnd: 20_000, allocatedVnd: 10_000, remainingVnd: 10_000,
    });
    expect(open.body.items[0].book.id).toBeGreaterThan(0);

    const me = await asReader(readerId);
    const pays = await req(app, 'GET', `/readers/${readerId}/payments`, { token: me.token });
    expect(pays.status).toBe(200);
    expect(pays.body.total).toBe(1);
    expect(pays.body.items[0]).toMatchObject({
      amountVnd: 40_000, method: 'cash', referenceNo: 'R-1', receivedBy: lib.accountId,
      allocations: [{ fineId: fineA, amountVnd: 30_000 }, { fineId: fineB, amountVnd: 10_000 }].sort((x, y) => x.fineId - y.fineId),
    });
    expect((await req(app, 'GET', `/readers/${readerId}/fines`, { token: me.token })).status).toBe(200);

    const stranger = await asReader(await reader());
    expect((await req(app, 'GET', `/readers/${readerId}/fines`, { token: stranger.token })).status).toBe(404);
    expect((await req(app, 'GET', `/readers/${readerId}/balance`, { token: stranger.token })).status).toBe(404);
    expect((await req(app, 'GET', `/readers/${readerId}/payments`, { token: stranger.token })).status).toBe(404);
    expect((await req(app, 'GET', '/readers/999999/balance', { token: lib.token })).status).toBe(404);
  });

  it('SC-005: the same request key 20× sequentially and 5× in parallel records one payment', async () => {
    const { readerId, fineA } = await twoFines();
    const lib = await asAccount(['librarian']);
    const body = payment(readerId, 1_000, [{ fineId: fineA, amountVnd: 1_000 }]);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await req(app, 'POST', '/payments', { token: lib.token, body });
      statuses.push(r.status);
      expect(r.body.replayed).toBe(i > 0);
    }
    expect(statuses[0]).toBe(201);
    expect(statuses.slice(1).every((s) => s === 200)).toBe(true);
    const parallel = await Promise.all(Array.from({ length: 5 }, () => req(app, 'POST', '/payments', { token: lib.token, body })));
    expect(parallel.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await paymentCount()).toBe(1);

    const fresh = payment(readerId, 2_000, [{ fineId: fineA, amountVnd: 2_000 }]);
    const race = await Promise.all(Array.from({ length: 5 }, () => req(app, 'POST', '/payments', { token: lib.token, body: fresh })));
    expect(race.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(race.map((r) => r.body.paymentId)).size).toBe(1);
    expect(await paymentCount()).toBe(2);
  });

  it('US5-2: payment rule violations', async () => {
    const w = await twoFines();
    const lib = await asAccount(['librarian']);
    const key = randomUUID();
    expect((await req(app, 'POST', '/payments', { token: lib.token, body: payment(w.readerId, 1_000, [{ fineId: w.fineA, amountVnd: 1_000 }], key) })).status).toBe(201);
    const conflict = await req(app, 'POST', '/payments', { token: lib.token, body: payment(w.readerId, 2_000, [{ fineId: w.fineA, amountVnd: 2_000 }], key) });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.key).toBe('IDEMPOTENCY_CONFLICT');

    const mismatch = await req(app, 'POST', '/payments', {
      token: lib.token, body: payment(w.readerId, 5_000, [{ fineId: w.fineA, amountVnd: 1_000 }, { fineId: w.fineB, amountVnd: 1_000 }]),
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.key).toBe('ALLOCATION_MISMATCH');

    const fractional = await req(app, 'POST', '/payments', { token: lib.token, body: payment(w.readerId, 1.5, [{ fineId: w.fineA, amountVnd: 1.5 }]) });
    expect(fractional.status).toBe(400);
    expect(fractional.body.error.key).toBe('VALIDATION');
    const dupFines = await req(app, 'POST', '/payments', {
      token: lib.token, body: payment(w.readerId, 2_000, [{ fineId: w.fineA, amountVnd: 1_000 }, { fineId: w.fineA, amountVnd: 1_000 }]),
    });
    expect(dupFines.status).toBe(400);
    const notUuid = await req(app, 'POST', '/payments', { token: lib.token, body: payment(w.readerId, 1_000, [{ fineId: w.fineA, amountVnd: 1_000 }], 'abc') });
    expect(notUuid.status).toBe(400);

    // Another reader with debt of their own cannot pay this reader's fine.
    const other = await otherReader(w.world);
    await lateFine({ days: 5, world: other, returnedAt: vn('2026-10-22 10:00') });
    const foreign = await req(app, 'POST', '/payments', {
      token: lib.token, body: payment(other.readerId, 1_000, [{ fineId: w.fineA, amountVnd: 1_000 }]),
    });
    expect(foreign.status).toBe(409);
    expect(foreign.body.error.key).toBe('ALLOCATION_MISMATCH');

    const own = await asReader(w.readerId);
    const self = await req(app, 'POST', '/payments', { token: own.token, body: payment(w.readerId, 1_000, [{ fineId: w.fineB, amountVnd: 1_000 }]) });
    expect(self.status).toBe(403);
  });

  it('US5-3: adjustments; below the paid amount is FINE_RULE', async () => {
    const w = await twoFines();
    await pay(w.world.staff, vn('2026-10-22 10:00'), w.readerId, 30_000, [{ fineId: w.fineA, amount: 30_000 }]);
    const lib = await asAccount(['librarian']);

    const below = await req(app, 'POST', `/fines/${w.fineA}/adjustments`, { token: lib.token, body: { amountVnd: -5_000, reason: 'waive' } });
    expect(below.status).toBe(409);
    expect(below.body.error.key).toBe('FINE_RULE');

    const ok = await req(app, 'POST', `/fines/${w.fineB}/adjustments`, { token: lib.token, body: { amountVnd: -5_000, reason: 'goodwill' } });
    expect(ok.status).toBe(201);
    expect(ok.body.adjustmentId).toBeGreaterThan(0);
    expect((await req(app, 'GET', `/readers/${w.readerId}/balance`, { token: lib.token })).body.outstandingVnd).toBe(15_000);
    const fines = await req(app, 'GET', `/readers/${w.readerId}/fines`, { token: lib.token, query: { open: 'true' } });
    expect(fines.body.items[0]).toMatchObject({ id: w.fineB, adjustmentsVnd: -5_000, netVnd: 15_000, remainingVnd: 15_000 });

    expect((await req(app, 'POST', `/fines/${w.fineB}/adjustments`, { token: lib.token, body: { amountVnd: 0, reason: 'x' } })).status).toBe(400);
    expect((await req(app, 'POST', `/fines/${w.fineB}/adjustments`, { token: lib.token, body: { amountVnd: 100, reason: '' } })).status).toBe(400);
    const missing = await req(app, 'POST', '/fines/999999/adjustments', { token: lib.token, body: { amountVnd: 100, reason: 'x' } });
    expect(missing.status).toBe(404);
    const own = await asReader(w.readerId);
    expect((await req(app, 'POST', `/fines/${w.fineB}/adjustments`, { token: own.token, body: { amountVnd: 100, reason: 'x' } })).status).toBe(403);
  });
});
