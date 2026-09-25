import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { admin, card, reader, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, asReader, createTestApp, req, TestClock } from './helpers/app';

afterAll(closeTestPools);

const clock = new TestClock();
const { app } = createTestApp({ clock });

beforeEach(async () => {
  await truncateAll();
  clock.set(vn('2026-09-10 10:00'));
});

const policyBody = (over: Record<string, unknown> = {}) => ({
  readerType: 'STUDENT',
  materialType: 'BOOK_PRINT',
  maxActiveItems: 5,
  loanDays: 14,
  maxRenewals: 2,
  dailyLateFeeVnd: 2000,
  debtBlockThresholdVnd: 50_000,
  validFrom: '2026-01-01T00:00:00+07:00',
  ...over,
});

describe('US4 readers, cards, policies', () => {
  it('US4-1: create and patch a reader; reads follow self-or', async () => {
    const lib = await asAccount(['librarian']);
    const created = await req(app, 'POST', '/readers', {
      token: lib.token,
      body: { fullName: 'Nguyễn Văn A', email: 'a@example.com', readerType: 'STUDENT' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      fullName: 'Nguyễn Văn A', email: 'a@example.com', phone: null, readerType: 'STUDENT', status: 'active',
      accountId: null, activeCard: null,
    });
    expect(created.body.createdAt).toMatch(/Z$/);
    const id = created.body.id;

    const patched = await req(app, 'PATCH', `/readers/${id}`, { token: lib.token, body: { phone: '0901', status: 'suspended' } });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ id, phone: '0901', status: 'suspended', email: 'a@example.com' });

    const badType = await req(app, 'POST', '/readers', { token: lib.token, body: { fullName: 'B', readerType: 'NOPE' } });
    expect(badType.status).toBe(404);
    expect(badType.body.error.detail).toBe('readerType');
    const badEmail = await req(app, 'POST', '/readers', { token: lib.token, body: { fullName: 'B', email: 'x', readerType: 'STUDENT' } });
    expect(badEmail.status).toBe(400);

    const list = await req(app, 'GET', '/readers', { token: lib.token, query: { q: 'Nguyễn' } });
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect((await req(app, 'GET', '/readers', { token: lib.token, query: { q: '09' } })).body.total).toBe(1);
    expect((await req(app, 'GET', '/readers', { token: lib.token, query: { status: 'active' } })).body.total).toBe(0);

    const me = await asReader(id);
    expect((await req(app, 'GET', `/readers/${id}`, { token: me.token })).status).toBe(200);
    const other = await asReader(await reader());
    expect((await req(app, 'GET', `/readers/${id}`, { token: other.token })).status).toBe(404);
    expect((await req(app, 'POST', '/readers', { token: other.token, body: { fullName: 'X', readerType: 'STUDENT' } })).status).toBe(403);
    expect((await req(app, 'GET', '/readers/999999', { token: lib.token })).status).toBe(404);
  });

  it('US4-2: link an account; duplicates and re-links are rejected', async () => {
    const lib = await asAccount(['librarian']);
    const r1 = await reader();
    const r2 = await reader();
    const acct = await asAccount(['reader']);

    const linked = await req(app, 'PUT', `/readers/${r1}/account`, { token: lib.token, body: { accountId: acct.accountId } });
    expect(linked.status).toBe(200);
    expect(linked.body.accountId).toBe(acct.accountId);
    const me = await req(app, 'GET', '/me', { token: acct.token });
    expect(me.body.reader.id).toBe(r1);

    const dup = await req(app, 'PUT', `/readers/${r2}/account`, { token: lib.token, body: { accountId: acct.accountId } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ key: 'DUPLICATE', detail: 'readers_user_uq' });

    const other = await asAccount(['reader']);
    const relink = await req(app, 'PUT', `/readers/${r1}/account`, { token: lib.token, body: { accountId: other.accountId } });
    expect(relink.status).toBe(400);
    expect(relink.body.error.key).toBe('VALIDATION');

    const inactive = await asAccount(['reader'], { status: 'inactive' });
    const res = await req(app, 'PUT', `/readers/${r2}/account`, { token: lib.token, body: { accountId: inactive.accountId } });
    expect(res.status).toBe(400);
    const missing = await req(app, 'PUT', `/readers/${r2}/account`, { token: lib.token, body: { accountId: 999999 } });
    expect(missing.status).toBe(404);
    expect(missing.body.error.detail).toBe('account');

    const unlinked = await req(app, 'DELETE', `/readers/${r1}/account`, { token: lib.token });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.accountId).toBeNull();
    expect((await req(app, 'GET', '/me', { token: acct.token })).body.reader).toBeNull();
  });

  it('US4-3: issue a card; one active card per reader; status changes', async () => {
    const lib = await asAccount(['librarian']);
    const r = await reader();
    const issued = await req(app, 'POST', `/readers/${r}/cards`, {
      token: lib.token, body: { cardNumber: 'LIB-0001', expiresAt: '2027-09-01T00:00:00Z' },
    });
    expect(issued.status).toBe(201);
    expect(issued.body).toMatchObject({
      readerId: r, cardNumber: 'LIB-0001', status: 'active', validNow: true, expiresAt: '2027-09-01T00:00:00.000Z',
    });

    const second = await req(app, 'POST', `/readers/${r}/cards`, {
      token: lib.token, body: { cardNumber: 'LIB-0002', expiresAt: '2027-09-01T00:00:00Z' },
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ key: 'DUPLICATE', detail: 'library_cards_active_reader_uq' });

    const got = await req(app, 'GET', `/readers/${r}`, { token: lib.token });
    expect(got.body.activeCard).toMatchObject({ id: issued.body.id, validNow: true });

    const cardId = issued.body.id;
    const toActive = await req(app, 'POST', `/cards/${cardId}/status`, { token: lib.token, body: { status: 'active' } });
    expect(toActive.status).toBe(400);
    expect(toActive.body.error.key).toBe('VALIDATION');
    const lost = await req(app, 'POST', `/cards/${cardId}/status`, { token: lib.token, body: { status: 'lost' } });
    expect(lost.status).toBe(200);
    expect(lost.body).toMatchObject({ status: 'lost', validNow: false });
    const again = await req(app, 'POST', `/cards/${cardId}/status`, { token: lib.token, body: { status: 'lost' } });
    expect(again.status).toBe(409);
    expect(again.body.error.key).toBe('INVALID_TRANSITION');

    const own = await asReader(r);
    const cards = await req(app, 'GET', `/readers/${r}/cards`, { token: own.token });
    expect(cards.status).toBe(200);
    expect(cards.body.items).toHaveLength(1);
    expect((await req(app, 'GET', `/readers/${r}`, { token: own.token })).body.activeCard).toBeNull();
    const stranger = await asReader(await reader());
    expect((await req(app, 'GET', `/readers/${r}/cards`, { token: stranger.token })).status).toBe(404);
    expect((await req(app, 'POST', `/readers/${r}/cards`, {
      token: own.token, body: { cardNumber: 'X', expiresAt: '2027-01-01T00:00:00Z' },
    })).status).toBe(403);
  });

  it('US4-4: policies: overlap, permission, close then create', async () => {
    const adm = await asAccount(['admin']);
    const lib = await asAccount(['librarian']);
    const created = await req(app, 'POST', '/policies', { token: adm.token, body: policyBody() });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      readerType: 'STUDENT', materialType: 'BOOK_PRINT', loanDays: 14, dailyLateFeeVnd: 2000,
      validFrom: '2025-12-31T17:00:00.000Z', validTo: null,
    });

    const overlap = await req(app, 'POST', '/policies', { token: adm.token, body: policyBody() });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.key).toBe('POLICY_OVERLAP');

    const denied = await req(app, 'POST', '/policies', { token: lib.token, body: policyBody({ readerType: 'STAFF' }) });
    expect(denied.status).toBe(403);
    const unknown = await req(app, 'POST', '/policies', { token: adm.token, body: policyBody({ materialType: 'NOPE' }) });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.detail).toBe('materialType');

    const closed = await req(app, 'POST', `/policies/${created.body.id}/close`, {
      token: adm.token, body: { validTo: '2026-12-01T00:00:00Z' },
    });
    expect(closed.status).toBe(200);
    expect(closed.body.validTo).toBe('2026-12-01T00:00:00.000Z');
    const next = await req(app, 'POST', '/policies', {
      token: adm.token, body: policyBody({ validFrom: '2026-12-01T00:00:00Z', loanDays: 21 }),
    });
    expect(next.status).toBe(201);

    const list = await req(app, 'GET', '/policies', { token: lib.token, query: { activeAt: '2026-12-15T00:00:00Z' } });
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: any) => p.id)).toEqual([next.body.id]);
    expect((await req(app, 'GET', '/policies', { token: lib.token })).body.total).toBe(2);
  });

  it('US4-5: expire-cards returns a count; reference lists', async () => {
    const lib = await asAccount(['librarian']);
    const staff = await admin();
    const r = await reader();
    await card(staff, vn('2026-09-01 09:00'), r, vn('2026-09-20 00:00'));
    expect((await req(app, 'POST', '/jobs/expire-cards', { token: lib.token })).body).toEqual({ count: 0 });
    clock.advanceDays(15);
    const res = await req(app, 'POST', '/jobs/expire-cards', { token: lib.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1 });
    const [row] = await ownerQuery('SELECT status FROM library_cards WHERE reader_id = ?', [r]);
    expect(row.status).toBe('expired');

    const rt = await req(app, 'GET', '/reference/reader-types', { token: lib.token });
    expect(rt.body.items.map((t: any) => t.code)).toContain('STUDENT');
    const mt = await req(app, 'GET', '/reference/material-types', { token: lib.token });
    expect(mt.body.items.map((t: any) => t.code)).toContain('BOOK_PRINT');
  });
});
