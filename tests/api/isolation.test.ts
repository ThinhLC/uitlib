import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools } from '../helpers/db';
import { reader, truncateAll } from '../helpers/fixtures';
import { asAccount, asReader, createTestApp, req } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app } = createTestApp();

const readerPaths = (id: number) => [
  `/readers/${id}`,
  `/readers/${id}/loan-items`,
  `/readers/${id}/fines`,
  `/readers/${id}/balance`,
  `/readers/${id}/payments`,
  `/readers/${id}/reservations`,
  `/readers/${id}/cards`,
];

const shape = (b: any) => ({ key: b.error.key, category: b.error.category, message: b.error.message });

describe('US6 reader isolation (FR-010, SC-006)', () => {
  it('US6-2: another reader\'s records answer exactly like a missing id', async () => {
    const readerA = await reader();
    const readerB = await reader();
    const a = await asReader(readerA);
    const missingId = readerB + 1000;

    for (const [own, other, missing] of readerPaths(readerA).map((p, i) => [p, readerPaths(readerB)[i], readerPaths(missingId)[i]])) {
      const mine = await req(app, 'GET', own, { token: a.token });
      expect(mine.status, own).toBe(200);

      const theirs = await req(app, 'GET', other, { token: a.token });
      const none = await req(app, 'GET', missing, { token: a.token });
      expect(theirs.status, other).toBe(404);
      expect(none.status, missing).toBe(404);
      expect(shape(theirs.body), other).toEqual(shape(none.body));
      expect(theirs.body.error.detail, other).toBe(none.body.error.detail);
    }
  });

  it('US6-6: an account with no linked reader sees nothing and /me says reader null', async () => {
    const readerB = await reader();
    const lone = await asAccount(['reader']);
    const me = await req(app, 'GET', '/me', { token: lone.token });
    expect(me.body.reader).toBeNull();
    for (const p of readerPaths(readerB)) {
      expect((await req(app, 'GET', p, { token: lone.token })).status, p).toBe(404);
    }
  });

  it('staff with the right permission can read any reader', async () => {
    const readerB = await reader();
    const staff = await asAccount(['librarian']);
    for (const p of readerPaths(readerB)) {
      expect((await req(app, 'GET', p, { token: staff.token })).status, p).toBe(200);
    }
  });
});
