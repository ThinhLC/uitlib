import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { truncateAll } from '../helpers/fixtures';
import { asAccount, createTestApp, req } from './helpers/app';
import { signToken } from './helpers/tokens';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app } = createTestApp();

async function rowsFor(subject: string) {
  const users = await ownerQuery(`SELECT id, status FROM app_users WHERE supabase_user_id = ?`, [subject]);
  const roles = await ownerQuery(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      JOIN app_users u ON u.id = ur.user_id WHERE u.supabase_user_id = ?`, [subject]);
  return { users, roles: roles.map((r) => r.code) };
}

describe('US1 provisioning (FR-008, FR-008a, SC-010)', () => {
  it('US1-4: the first /me creates an active reader account with no permissions', async () => {
    const sub = randomUUID();
    const res = await req(app, 'GET', '/me', { token: await signToken({ sub }) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', roles: ['reader'], permissions: [] });
    const { users, roles } = await rowsFor(sub);
    expect(users).toHaveLength(1);
    expect(res.body.accountId).toBe(Number(users[0].id));
    expect(roles).toEqual(['reader']);
  });

  it('SC-010: 20 parallel first requests create one account and one reader role', async () => {
    const sub = randomUUID();
    const token = await signToken({ sub });
    const results = await Promise.all(Array.from({ length: 20 }, () => req(app, 'GET', '/me', { token })));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    expect(new Set(results.map((r) => r.body.accountId)).size).toBe(1);
    const { users, roles } = await rowsFor(sub);
    expect(users).toHaveLength(1);
    expect(roles).toEqual(['reader']);
  });

  it('an existing account is never changed: status and roles stay', async () => {
    const inactive = await asAccount(['librarian'], { status: 'inactive' });
    await req(app, 'GET', '/me', { token: inactive.token });
    expect(await rowsFor(inactive.subject)).toEqual({ users: [{ id: inactive.accountId, status: 'inactive' }], roles: ['librarian'] });

    const staff = await asAccount(['librarian']);
    const me = await req(app, 'GET', '/me', { token: staff.token });
    expect(me.body.roles).toEqual(['librarian']);
    expect(me.body.permissions).toContain('loan.checkout');
    expect((await rowsFor(staff.subject)).roles).toEqual(['librarian']);
  });

  it('/me shows the linked reader', async () => {
    const a = await asAccount(['reader']);
    const [type] = await ownerQuery(`SELECT id FROM reader_types WHERE code = 'STUDENT'`);
    await ownerQuery(
      `INSERT INTO readers (user_id, reader_type_id, full_name, status, created_at) VALUES (?, ?, 'An Nguyen', 'active', UTC_TIMESTAMP(3))`,
      [a.accountId, type.id]);
    const me = await req(app, 'GET', '/me', { token: a.token });
    expect(me.body.reader).toMatchObject({ fullName: 'An Nguyen', readerType: 'STUDENT', status: 'active' });
  });

  describe('reader profile, linked by account id (FR-008e)', () => {
    const googleToken = (sub: string, email: string, name = 'Minh Quang Tran') =>
      signToken({ sub, claims: { email, user_metadata: { full_name: name, name } } });
    const readerOf = async (sub: string) =>
      (await ownerQuery(
        `SELECT r.id, r.full_name, r.email, r.status, rt.code AS type FROM readers r
           JOIN reader_types rt ON rt.id = r.reader_type_id
           JOIN app_users u ON u.id = r.user_id WHERE u.supabase_user_id = ?`, [sub]));
    const deskReader = async (email: string) => {
      const [t] = await ownerQuery(`SELECT id FROM reader_types WHERE code = 'STUDENT'`);
      const res: any = await ownerQuery(
        `INSERT INTO readers (user_id, reader_type_id, full_name, email, status, created_at)
         VALUES (NULL, ?, 'Desk Reader', ?, 'active', UTC_TIMESTAMP(3))`, [t.id, email]);
      return Number(res.insertId);
    };

    it('a new account gets an active EXTERNAL reader, prefilled from the Google profile', async () => {
      const sub = randomUUID();
      const me = await req(app, 'GET', '/me', { token: await googleToken(sub, 'new.user@gmail.com') });
      expect(me.body.reader).toMatchObject({ fullName: 'Minh Quang Tran', readerType: 'EXTERNAL', status: 'active' });
      expect(await readerOf(sub)).toEqual([
        expect.objectContaining({ full_name: 'Minh Quang Tran', email: 'new.user@gmail.com', status: 'active', type: 'EXTERNAL' }),
      ]);
    });

    it('a desk reader with the same email is never linked automatically (no email matching)', async () => {
      const desk = await deskReader('same@gmail.com');
      const sub = randomUUID();
      const me = await req(app, 'GET', '/me', { token: await googleToken(sub, 'same@gmail.com') });
      expect(me.body.reader.id).not.toBe(desk);
      const [row] = await ownerQuery(`SELECT user_id FROM readers WHERE id = ?`, [desk]);
      expect(row.user_id).toBeNull();
    });

    it('20 parallel first requests still make exactly one reader', async () => {
      const sub = randomUUID();
      const token = await googleToken(sub, 'parallel@gmail.com');
      await Promise.all(Array.from({ length: 20 }, () => req(app, 'GET', '/me', { token })));
      expect(await readerOf(sub)).toHaveLength(1);
    });

    it('ordinary requests of a known account never write: an account without a reader stays so', async () => {
      const a = await asAccount(['reader']);
      const me = await req(app, 'GET', '/me', { token: await googleToken(a.subject, 'late@gmail.com') });
      expect(me.body.reader).toBeNull();
    });
  });
});
