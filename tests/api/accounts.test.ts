import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { checkout, lendingWorld, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, asReader, createTestApp, req } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app, clock } = createTestApp();

describe('US7 account administration (T066)', () => {
  it('US7-4: removing librarian takes effect on the next call; PUT is idempotent', async () => {
    const w = await lendingWorld({ copies: 2 });
    const admin = await asAccount(['admin']);
    const lib = await asAccount(['librarian']);
    clock.set(vn('2026-09-10 10:00'));

    const ok = await req(app, 'POST', '/loans', { token: lib.token, body: { readerId: w.readerId, copyIds: [w.copies[0]] } });
    expect(ok.status).toBe(201);

    const removed = await req(app, 'DELETE', `/accounts/${lib.accountId}/roles/librarian`, { token: admin.token });
    expect(removed.status).toBe(204);
    const denied = await req(app, 'POST', '/loans', { token: lib.token, body: { readerId: w.readerId, copyIds: [w.copies[1]] } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.key).toBe('FORBIDDEN');
    expect((await req(app, 'GET', '/reports/copy-status', { token: lib.token })).status).toBe(403);

    for (let i = 0; i < 2; i++) {
      const put = await req(app, 'PUT', `/accounts/${lib.accountId}/roles/librarian`, { token: admin.token });
      expect(put.status).toBe(204);
    }
    const acc = await req(app, 'GET', `/accounts/${lib.accountId}`, { token: admin.token });
    expect(acc.body).toMatchObject({ id: lib.accountId, status: 'active', roles: ['librarian'], readerId: null, subject: lib.subject });
    expect((await req(app, 'GET', '/reports/copy-status', { token: lib.token })).status).toBe(200);

    // Removing a role that is not held is still 204; unknown ids and roles are NOT_FOUND.
    expect((await req(app, 'DELETE', `/accounts/${lib.accountId}/roles/admin`, { token: admin.token })).status).toBe(204);
    const role = await req(app, 'PUT', `/accounts/${lib.accountId}/roles/wizard`, { token: admin.token });
    expect(role.status).toBe(404);
    expect(role.body.error.detail).toBe('role');
    const missing = await req(app, 'GET', '/accounts/999999', { token: admin.token });
    expect(missing.status).toBe(404);
    expect(missing.body.error.detail).toBe('account');

    // Only role.manage may administer accounts.
    const denied2 = await req(app, 'PUT', `/accounts/${lib.accountId}/roles/admin`, { token: lib.token });
    expect(denied2.status).toBe(403);
    expect(denied2.body.error).toMatchObject({ key: 'FORBIDDEN', detail: 'role.manage' });
  });

  it('US7-5: a deactivated account gets ACCOUNT_INACTIVE; its processed loans still reference it', async () => {
    const w = await lendingWorld({ copies: 1 });
    const admin = await asAccount(['admin']);
    const lib = await asAccount(['librarian']);
    const [li] = await checkout(lib.accountId, vn('2026-09-02 10:00'), w.readerId, [w.copies[0]]);

    const res = await req(app, 'POST', `/accounts/${lib.accountId}/status`, { token: admin.token, body: { status: 'inactive' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: lib.accountId, status: 'inactive', roles: ['librarian'] });

    const next = await req(app, 'GET', '/reports/copy-status', { token: lib.token });
    expect(next.status).toBe(403);
    expect(next.body.error.key).toBe('ACCOUNT_INACTIVE');
    const [loan] = await ownerQuery(`SELECT processed_by_user_id u FROM loans WHERE id = ?`, [li.loanId]);
    expect(Number(loan.u)).toBe(lib.accountId);

    const inactive = await req(app, 'GET', '/accounts', { token: admin.token, query: { status: 'inactive' } });
    expect(inactive.body.items.map((a: any) => a.id)).toEqual([lib.accountId]);
    const admins = await req(app, 'GET', '/accounts', { token: admin.token, query: { role: 'admin' } });
    expect(admins.body.items.map((a: any) => a.id)).toContain(admin.accountId);
    expect(admins.body.items.map((a: any) => a.id)).not.toContain(lib.accountId);

    const back = await req(app, 'POST', `/accounts/${lib.accountId}/status`, { token: admin.token, body: { status: 'active' } });
    expect(back.body.status).toBe('active');
    expect((await req(app, 'GET', '/reports/copy-status', { token: lib.token })).status).toBe(200);
  });

  it('an admin cannot remove their own admin role or deactivate themself', async () => {
    const admin = await asAccount(['admin']);
    const role = await req(app, 'DELETE', `/accounts/${admin.accountId}/roles/admin`, { token: admin.token });
    expect(role.status).toBe(400);
    expect(role.body.error.key).toBe('VALIDATION');
    const self = await req(app, 'POST', `/accounts/${admin.accountId}/status`, { token: admin.token, body: { status: 'inactive' } });
    expect(self.status).toBe(400);
    expect(self.body.error.key).toBe('VALIDATION');
    const acc = await req(app, 'GET', `/accounts/${admin.accountId}`, { token: admin.token });
    expect(acc.body).toMatchObject({ status: 'active', roles: ['admin'] });

    const bad = await req(app, 'POST', `/accounts/${admin.accountId}/status`, { token: admin.token, body: { status: 'gone' } });
    expect(bad.status).toBe(400);
  });

  it('accounts show the linked reader', async () => {
    const w = await lendingWorld();
    const admin = await asAccount(['admin']);
    const me = await asReader(w.readerId);
    const res = await req(app, 'GET', `/accounts/${me.accountId}`, { token: admin.token });
    expect(res.body).toMatchObject({ roles: ['reader'], readerId: w.readerId });
    expect(res.body.createdAt).toMatch(/Z$/);
  });
});
