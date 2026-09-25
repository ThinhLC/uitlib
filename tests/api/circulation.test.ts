import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { card, checkout, lendingWorld, otherReader, reader, reserve, returnItem, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, asReader, createTestApp, req, TestClock } from './helpers/app';

afterAll(closeTestPools);

const clock = new TestClock();
const { app } = createTestApp({ clock });

beforeEach(async () => {
  await truncateAll();
  clock.set(vn('2026-09-10 10:00'));
});

const staff = async () => (await asAccount(['librarian'])).token;
const barcodeOf = async (copyId: number) =>
  String((await ownerQuery('SELECT barcode FROM book_copies WHERE id = ?', [copyId]))[0].barcode);
const count = async (table: string) => Number((await ownerQuery(`SELECT COUNT(*) n FROM \`${table}\``))[0].n);

/** Borrowed 2026-09-10 local with 14 loan days: due 2026-09-24 23:59:59.999 local. */
const DUE = '2026-09-24T16:59:59.999Z';

async function lend(token: string, readerId: number, copyIds: number[]) {
  const res = await req(app, 'POST', '/loans', { token, body: { readerId, copyIds } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { loanId: number; items: { loanItemId: number; copyId: number; dueAt: string }[] };
}

describe('US2 checkout', () => {
  it('US2-1: two copies → 201 with both items and their due time', async () => {
    const w = await lendingWorld({ copies: 2 });
    const token = await staff();
    const res = await req(app, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: w.copies } });
    expect(res.status).toBe(201);
    expect(res.body.loanId).toEqual(expect.any(Number));
    expect(res.body.items).toEqual([
      { loanItemId: expect.any(Number), copyId: w.copies[0], dueAt: DUE },
      { loanItemId: expect.any(Number), copyId: w.copies[1], dueAt: DUE },
    ]);
  });

  it('US2-2: one of three copies on loan → 409 COPY_NOT_AVAILABLE and nothing written', async () => {
    const w = await lendingWorld({ copies: 3 });
    const other = await otherReader(w);
    await checkout(w.staff, w.now, other.readerId, [w.copies[1]]);
    const before = [await count('loans'), await count('loan_items')];
    const res = await req(app, 'POST', '/loans', { token: await staff(), body: { readerId: w.readerId, copyIds: w.copies } });
    expect(res.status).toBe(409);
    expect(res.body.error.key).toBe('COPY_NOT_AVAILABLE');
    expect([await count('loans'), await count('loan_items')]).toEqual(before);
    const [c0] = await ownerQuery('SELECT circulation_status s FROM book_copies WHERE id = ?', [w.copies[0]]);
    expect(c0.s).toBe('available');
  });

  it('US2-3: eligibility rejections are 409 with their key', async () => {
    const token = await staff();

    // CARD_INVALID: a reader without a card.
    const w = await lendingWorld({ copies: 2 });
    const noCard = await reader();
    let res = await req(app, 'POST', '/loans', { token, body: { readerId: noCard, copyIds: [w.copies[0]] } });
    expect([res.status, res.body.error.key]).toEqual([409, 'CARD_INVALID']);

    // OVERDUE_BLOCKED: borrowed 09-01 (due 09-15), now 09-20.
    await checkout(w.staff, w.now, w.readerId, [w.copies[0]]);
    clock.set(vn('2026-09-20 10:00'));
    res = await req(app, 'POST', '/loans', { token, body: { readerId: w.readerId, copyIds: [w.copies[1]] } });
    expect([res.status, res.body.error.key]).toEqual([409, 'OVERDUE_BLOCKED']);
  });

  it('US2-3: DEBT_BLOCKED when the reader owes more than the threshold', async () => {
    const w = await lendingWorld({ copies: 2, policy: { debtThreshold: 1000 } });
    const [li] = await checkout(w.staff, w.now, w.readerId, [w.copies[0]]);
    await returnItem(w.staff, vn('2026-09-20 10:00'), li.loanItemId); // 5 days late: 10 000 đ
    clock.set(vn('2026-09-21 10:00'));
    const res = await req(app, 'POST', '/loans', { token: await staff(), body: { readerId: w.readerId, copyIds: [w.copies[1]] } });
    expect([res.status, res.body.error.key]).toEqual([409, 'DEBT_BLOCKED']);
  });

  it('US2-3: LIMIT_REACHED above the item limit', async () => {
    const w = await lendingWorld({ copies: 2, policy: { maxItems: 1 } });
    const res = await req(app, 'POST', '/loans', { token: await staff(), body: { readerId: w.readerId, copyIds: w.copies } });
    expect([res.status, res.body.error.key]).toEqual([409, 'LIMIT_REACHED']);
  });

  it('US2-9: an account without loan.checkout → 403 FORBIDDEN', async () => {
    const w = await lendingWorld();
    const a = await asAccount(['reader']);
    const res = await req(app, 'POST', '/loans', { token: a.token, body: { readerId: w.readerId, copyIds: w.copies } });
    expect(res.status).toBe(403);
    expect(res.body.error.key).toBe('FORBIDDEN');
    expect(await count('loans')).toBe(0);
  });

  it('SC-008: copyIds [] → 400 with the field path', async () => {
    const res = await req(app, 'POST', '/loans', { token: await staff(), body: { readerId: 1, copyIds: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error.key).toBe('VALIDATION');
    expect(res.body.error.fields[0].path).toBe('copyIds');
  });

  it('duplicate copy ids and unknown fields are 400', async () => {
    const token = await staff();
    let res = await req(app, 'POST', '/loans', { token, body: { readerId: 1, copyIds: [5, 5] } });
    expect([res.status, res.body.error.fields[0].path]).toEqual([400, 'copyIds']);
    res = await req(app, 'POST', '/loans', { token, body: { readerId: 1, copyIds: [5], now: '2026-01-01T00:00:00Z' } });
    expect(res.body.error.fields).toContainEqual({ path: 'now', message: 'unknown field' });
  });
});

describe('US2 return and lost', () => {
  it('US2-4: an overdue return (3 days late) → 200 with the late fine', async () => {
    const w = await lendingWorld();
    const token = await staff();
    const { items } = await lend(token, w.readerId, w.copies);
    clock.set(vn('2026-09-27 10:00'));
    const res = await req(app, 'POST', `/loan-items/${items[0].loanItemId}/return`, { token, body: { condition: 'good' } });
    expect(res.status).toBe(200);
    expect(res.body.fines).toEqual([{ id: expect.any(Number), type: 'late', amountVnd: 6000 }]);
  });

  it('US2-5: a damaged return with fine and reason → damage fine; the copy is in_repair', async () => {
    const w = await lendingWorld();
    const token = await staff();
    const { items } = await lend(token, w.readerId, w.copies);
    const res = await req(app, 'POST', `/loan-items/${items[0].loanItemId}/return`, {
      token,
      body: { condition: 'damaged', damagedFineVnd: 50_000, reason: 'water damage' },
    });
    expect(res.status).toBe(200);
    expect(res.body.fines).toEqual([{ id: expect.any(Number), type: 'damaged', amountVnd: 50_000 }]);

    const scan = await req(app, 'GET', `/copies/by-barcode/${encodeURIComponent(await barcodeOf(w.copies[0]))}`, { token });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({ id: w.copies[0], circulationStatus: 'in_repair', physicalCondition: 'damaged', openLoanItemId: null });
  });

  it('a damaged fine without a reason → 409 FINE_RULE; a second return → 409 INVALID_TRANSITION', async () => {
    const w = await lendingWorld();
    const token = await staff();
    const { items } = await lend(token, w.readerId, w.copies);
    const path = `/loan-items/${items[0].loanItemId}/return`;
    let res = await req(app, 'POST', path, { token, body: { condition: 'damaged', damagedFineVnd: 10_000 } });
    expect([res.status, res.body.error.key]).toEqual([409, 'FINE_RULE']);
    expect((await req(app, 'POST', path, { token, body: { condition: 'good' } })).status).toBe(200);
    res = await req(app, 'POST', path, { token, body: { condition: 'good' } });
    expect([res.status, res.body.error.key]).toEqual([409, 'INVALID_TRANSITION']);
    res = await req(app, 'POST', '/loan-items/999999/return', { token, body: { condition: 'good' } });
    expect([res.status, res.body.error.key]).toEqual([404, 'NOT_FOUND']);
  });

  it('US2-6: lost → 200 with the late and lost fines', async () => {
    const w = await lendingWorld();
    const token = await staff();
    const { items } = await lend(token, w.readerId, w.copies);
    clock.set(vn('2026-09-27 10:00'));
    const res = await req(app, 'POST', `/loan-items/${items[0].loanItemId}/lost`, { token, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.fines).toEqual([
      { id: expect.any(Number), type: 'late', amountVnd: 6000 },
      { id: expect.any(Number), type: 'lost', amountVnd: 150_000 },
    ]);
    const [c] = await ownerQuery('SELECT circulation_status s FROM book_copies WHERE id = ?', [w.copies[0]]);
    expect(c.s).toBe('lost');
  });
});

describe('US2 renew', () => {
  it('renew → 200 newDueAt 14 days later', async () => {
    const w = await lendingWorld();
    const token = await staff();
    const { items } = await lend(token, w.readerId, w.copies);
    const res = await req(app, 'POST', `/loan-items/${items[0].loanItemId}/renew`, { token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ loanItemId: items[0].loanItemId, newDueAt: '2026-10-08T16:59:59.999Z' });
  });

  it('the four RENEWAL_REJECTED details', async () => {
    const token = await staff();
    const expectRejected = async (loanItemId: number, detail: string) => {
      const res = await req(app, 'POST', `/loan-items/${loanItemId}/renew`, { token });
      expect(res.status, detail).toBe(409);
      expect(res.body.error, detail).toMatchObject({ key: 'RENEWAL_REJECTED', detail });
    };
    const w = await lendingWorld({ copies: 4, policy: { maxRenewals: 1 } });

    // not_on_loan
    const a = await lend(token, w.readerId, [w.copies[0]]);
    await req(app, 'POST', `/loan-items/${a.items[0].loanItemId}/return`, { token, body: { condition: 'good' } });
    await expectRejected(a.items[0].loanItemId, 'not_on_loan');

    // limit
    const b = await lend(token, w.readerId, [w.copies[1]]);
    expect((await req(app, 'POST', `/loan-items/${b.items[0].loanItemId}/renew`, { token })).status).toBe(200);
    await expectRejected(b.items[0].loanItemId, 'limit');

    // reserved: every copy of the book is out and another reader waits for it
    const c = await lend(token, w.readerId, [w.copies[0], w.copies[2], w.copies[3]]);
    const other = await otherReader(w);
    await reserve(w.staff, vn('2026-09-10 11:00'), other.readerId, w.bookId);
    await expectRejected(c.items[0].loanItemId, 'reserved');

    // overdue
    clock.set(vn('2026-09-26 10:00'));
    await expectRejected(c.items[1].loanItemId, 'overdue');
  });
});

describe('US2 reads and desk scans', () => {
  it("a reader's loan items: staff see barcodes, the reader does not, others get 404", async () => {
    const w = await lendingWorld({ copies: 2 });
    const token = await staff();
    const { items } = await lend(token, w.readerId, w.copies);
    clock.set(vn('2026-09-27 10:00'));
    await req(app, 'POST', `/loan-items/${items[0].loanItemId}/return`, { token, body: { condition: 'good' } });

    const res = await req(app, 'GET', `/readers/${w.readerId}/loan-items`, { token });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const returned = res.body.items.find((i: any) => i.id === items[0].loanItemId);
    const open = res.body.items.find((i: any) => i.id === items[1].loanItemId);
    expect(returned).toMatchObject({
      status: 'returned', returnCondition: 'good', overdue: false,
      copy: { id: w.copies[0], barcode: await barcodeOf(w.copies[0]) },
      book: { id: w.bookId }, maxRenewals: 2, renewalCount: 0,
      fines: [{ id: expect.any(Number), type: 'late', amountVnd: 6000 }],
    });
    expect(open).toMatchObject({ status: 'on_loan', overdue: true, dueAt: DUE, returnedAt: null, fines: [] });

    const overdue = await req(app, 'GET', `/readers/${w.readerId}/loan-items`, { token, query: { overdue: 'true' } });
    expect(overdue.body.items.map((i: any) => i.id)).toEqual([items[1].loanItemId]);
    const byStatus = await req(app, 'GET', `/readers/${w.readerId}/loan-items`, { token, query: { status: 'returned' } });
    expect(byStatus.body.items.map((i: any) => i.id)).toEqual([items[0].loanItemId]);

    const self = await asReader(w.readerId);
    const own = await req(app, 'GET', `/readers/${w.readerId}/loan-items`, { token: self.token });
    expect(own.status).toBe(200);
    expect(own.body.items[0].copy).not.toHaveProperty('barcode');

    const stranger = await asReader((await otherReader(w)).readerId);
    const denied = await req(app, 'GET', `/readers/${w.readerId}/loan-items`, { token: stranger.token });
    expect([denied.status, denied.body.error.key]).toEqual([404, 'NOT_FOUND']);
    const missing = await req(app, 'GET', '/readers/999999/loan-items', { token });
    expect(missing.body.error).toMatchObject({ key: 'NOT_FOUND', detail: 'reader' });
  });

  it('copy scan shows the open loan item; card scan shows the reader', async () => {
    const w = await lendingWorld();
    const token = await staff();
    const { items } = await lend(token, w.readerId, w.copies);
    const scan = await req(app, 'GET', `/copies/by-barcode/${encodeURIComponent(await barcodeOf(w.copies[0]))}`, { token });
    expect(scan.body).toMatchObject({ id: w.copies[0], bookId: w.bookId, circulationStatus: 'on_loan', openLoanItemId: items[0].loanItemId, heldFor: null });
    expect((await req(app, 'GET', '/copies/by-barcode/NOPE', { token })).status).toBe(404);

    const cardId = await card(w.staff, w.now, await reader());
    const [k] = await ownerQuery('SELECT card_number n, reader_id r FROM library_cards WHERE id = ?', [cardId]);
    const cs = await req(app, 'GET', `/cards/by-number/${encodeURIComponent(k.n)}`, { token });
    expect(cs.status).toBe(200);
    expect(cs.body).toMatchObject({
      id: cardId, readerId: Number(k.r), status: 'active', validNow: true,
      reader: { id: Number(k.r), readerType: 'STUDENT', status: 'active', accountId: null },
    });
    expect((await req(app, 'GET', '/cards/by-number/NOPE', { token })).status).toBe(404);
    const a = await asAccount(['reader']);
    expect((await req(app, 'GET', `/cards/by-number/${k.n}`, { token: a.token })).status).toBe(403);
  });
});
