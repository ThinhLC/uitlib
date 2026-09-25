import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools } from '../helpers/db';
import { book, checkout, copy, lendingWorld, otherReader, returnItem, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, asReader, createTestApp, req } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app, clock } = createTestApp();

/** Book K with one copy lent to R0 on 2026-09-02; readers R1 and R2 with cards and accounts. */
async function world() {
  const w = await lendingWorld({ copies: 1 });
  const [li] = await checkout(w.staff, vn('2026-09-02 10:00'), w.readerId, [w.copies[0]]);
  const r1 = (await otherReader(w)).readerId;
  const r2 = (await otherReader(w)).readerId;
  return { w, loanItemId: li.loanItemId, r1, r2, a1: await asReader(r1), a2: await asReader(r2) };
}

describe('US6 reservations (T060)', () => {
  it('US6-3: a book with an available copy cannot be reserved; a second reservation is DUPLICATE', async () => {
    const q = await world();
    const shelved = await book();
    await copy(q.w.staff, q.w.now, shelved);
    clock.set(vn('2026-09-03 10:00'));
    const available = await req(app, 'POST', '/reservations', { token: q.a1.token, body: { readerId: q.r1, bookId: shelved } });
    expect(available.status).toBe(400);
    expect(available.body.error).toMatchObject({ key: 'VALIDATION', category: 'validation' });

    const first = await req(app, 'POST', '/reservations', { token: q.a1.token, body: { readerId: q.r1, bookId: q.w.bookId } });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      readerId: q.r1, book: { id: q.w.bookId }, status: 'waiting', queuePosition: 1,
      requestedAt: '2026-09-03T03:00:00.000Z', readyAt: null, closedAt: null,
    });
    const again = await req(app, 'POST', '/reservations', { token: q.a1.token, body: { readerId: q.r1, bookId: q.w.bookId } });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ key: 'DUPLICATE', detail: 'reservations_active_uq' });
  });

  it('a reader cannot reserve for someone else; actor fields are rejected', async () => {
    const q = await world();
    clock.set(vn('2026-09-03 10:00'));
    const other = await req(app, 'POST', '/reservations', { token: q.a1.token, body: { readerId: q.r2, bookId: q.w.bookId } });
    expect(other.status).toBe(403);
    expect(other.body.error.key).toBe('FORBIDDEN');
    const spoof = await req(app, 'POST', '/reservations', {
      token: q.a1.token, body: { readerId: q.r1, bookId: q.w.bookId, now: '2020-01-01T00:00:00Z' } });
    expect(spoof.status).toBe(400);
  });

  it('US6-4, US6-5: cancel, promotion, the hold shelf and expiry', async () => {
    const q = await world();
    const staff = await asAccount(['librarian']);
    clock.set(vn('2026-09-03 10:00'));
    const res1 = (await req(app, 'POST', '/reservations', { token: q.a1.token, body: { readerId: q.r1, bookId: q.w.bookId } })).body;
    clock.set(vn('2026-09-03 10:01'));
    const res2 = (await req(app, 'POST', '/reservations', { token: staff.token, body: { readerId: q.r2, bookId: q.w.bookId } })).body;
    expect(res2.queuePosition).toBe(2);

    // The return puts the copy on hold for R1.
    await returnItem(q.w.staff, vn('2026-09-05 10:00'), q.loanItemId);
    const mine = await req(app, 'GET', `/readers/${q.r1}/reservations`, { token: q.a1.token });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(mine.body.items[0]).toMatchObject({
      id: res1.id, status: 'ready', queuePosition: null, assignedCopyId: q.w.copies[0],
      readyAt: '2026-09-05T03:00:00.000Z', holdExpiresAt: '2026-09-08T03:00:00.000Z' });
    expect((await req(app, 'GET', `/readers/${q.r2}/reservations`, { token: q.a2.token })).body.items[0])
      .toMatchObject({ id: res2.id, status: 'waiting', queuePosition: 1 });

    // Another reader's reservation: the procedure answers FORBIDDEN.
    clock.set(vn('2026-09-06 10:00'));
    const foreign = await req(app, 'POST', `/reservations/${res1.id}/cancel`, { token: q.a2.token, body: {} });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.key).toBe('FORBIDDEN');
    // Staff must give a reason.
    const noReason = await req(app, 'POST', `/reservations/${res1.id}/cancel`, { token: staff.token, body: {} });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.key).toBe('VALIDATION');

    // R1 cancels their own ready hold: the copy passes to R2.
    const cancelled = await req(app, 'POST', `/reservations/${res1.id}/cancel`, { token: q.a1.token, body: {} });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id: res1.id, status: 'cancelled', closedAt: '2026-09-06T03:00:00.000Z',
      closeReason: 'cancelled_by_reader' });
    expect((await req(app, 'GET', `/readers/${q.r2}/reservations`, { token: q.a2.token, query: { status: 'ready' } })).body.items)
      .toMatchObject([{ id: res2.id, status: 'ready', holdExpiresAt: '2026-09-09T03:00:00.000Z' }]);

    // The hold shelf (staff only).
    const shelf = await req(app, 'GET', '/reservations', { token: staff.token, query: { status: 'ready' } });
    expect(shelf.status).toBe(200);
    expect(shelf.body.items.map((r: any) => r.id)).toEqual([res2.id]);
    const byBook = await req(app, 'GET', '/reservations', { token: staff.token, query: { bookId: q.w.bookId } });
    expect(byBook.body.total).toBe(2);
    expect((await req(app, 'GET', '/reservations', { token: q.a1.token })).status).toBe(403);
    expect((await req(app, 'GET', `/readers/${q.r2}/reservations`, { token: q.a1.token })).status).toBe(404);

    // Expiry on demand, four days later.
    expect((await req(app, 'POST', '/jobs/expire-holds', { token: q.a1.token })).status).toBe(403);
    clock.advanceDays(4);
    const job = await req(app, 'POST', '/jobs/expire-holds', { token: staff.token });
    expect(job.status).toBe(200);
    expect(job.body.count).toBeGreaterThanOrEqual(1);
    expect((await req(app, 'GET', `/readers/${q.r2}/reservations`, { token: staff.token })).body.items[0].status).toBe('expired');
  });

  it('unknown ids are NOT_FOUND', async () => {
    const staff = await asAccount(['librarian']);
    const cancel = await req(app, 'POST', '/reservations/999999/cancel', { token: staff.token, body: { reason: 'typo' } });
    expect(cancel.status).toBe(404);
    expect(cancel.body.error).toMatchObject({ key: 'NOT_FOUND', detail: 'reservation' });
    const list = await req(app, 'GET', '/readers/999999/reservations', { token: staff.token });
    expect(list.status).toBe(404);
  });
});
