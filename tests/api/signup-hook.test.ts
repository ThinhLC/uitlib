import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { truncateAll } from '../helpers/fixtures';
import { createTestApp, req } from './helpers/app';
import { hookPayload, signHook, TEST_HOOK_SECRET } from './helpers/hook';
import { signToken } from './helpers/tokens';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app } = createTestApp({ hookSecret: TEST_HOOK_SECRET });
const PATH = '/auth/hooks/before-user-created';
const count = async (sub: string) =>
  Number((await ownerQuery(`SELECT COUNT(*) n FROM app_users WHERE supabase_user_id = ?`, [sub]))[0].n);
const roleRows = async (sub: string) =>
  Number((await ownerQuery(
    `SELECT COUNT(*) n FROM user_roles ur JOIN app_users u ON u.id = ur.user_id WHERE u.supabase_user_id = ?`, [sub]))[0].n);

const send = (signed: { body: string; headers: Record<string, string> }) =>
  req(app, 'POST', PATH, { rawBody: signed.body, headers: signed.headers });

describe('Sign-up hook (FR-008b, contracts/signup-hook.md)', () => {
  it('a valid Google payload creates the account; a repeat delivery creates nothing more', async () => {
    const sub = randomUUID();
    const signed = signHook(hookPayload(sub));
    const first = await send(signed);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({});
    expect(await count(sub)).toBe(1);
    expect(await roleRows(sub)).toBe(1);
    const [reader] = await ownerQuery(
      `SELECT r.email, rt.code type FROM readers r JOIN reader_types rt ON rt.id = r.reader_type_id
         JOIN app_users u ON u.id = r.user_id WHERE u.supabase_user_id = ?`, [sub]);
    expect(reader).toEqual({ email: 'someone@gmail.com', type: 'EXTERNAL' });

    const again = await send(signed);
    expect(again.status).toBe(200);
    expect(await count(sub)).toBe(1);
    expect(await roleRows(sub)).toBe(1);
  });

  it('the hook and a first /me for the same subject at once make one account', async () => {
    const sub = randomUUID();
    const token = await signToken({ sub });
    const [hook, me] = await Promise.all([send(signHook(hookPayload(sub))), req(app, 'GET', '/me', { token })]);
    expect(hook.status).toBe(200);
    expect(me.status).toBe(200);
    expect(await count(sub)).toBe(1);
    expect(await roleRows(sub)).toBe(1);
  });

  it('a wrong secret, a tampered body or a stale timestamp is 401 and writes nothing', async () => {
    const sub = randomUUID();
    const wrong = `v1,whsec_${Buffer.from('another-secret-0123456789abcdef').toString('base64')}`;
    for (const signed of [
      signHook(hookPayload(sub), { secret: wrong }),
      signHook(hookPayload(sub), { tamper: true }),
      signHook(hookPayload(sub), { timestamp: new Date(Date.now() - 6 * 60_000) }),
    ]) {
      const res = await send(signed);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { http_code: 401, message: 'invalid signature' } });
    }
    const unsigned = await req(app, 'POST', PATH, { body: hookPayload(sub) });
    expect(unsigned.status).toBe(401);
    expect(await count(sub)).toBe(0);
  });

  it('another provider (GitHub) is refused with 403 in Supabase format', async () => {
    const sub = randomUUID();
    const res = await send(signHook(hookPayload(sub, 'github')));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ http_code: 403 });
    expect(await count(sub)).toBe(0);
  });

  it('an email/password sign-up is accepted', async () => {
    const sub = randomUUID();
    const res = await send(signHook(hookPayload(sub, 'email')));
    expect(res.status).toBe(200);
    expect(await count(sub)).toBe(1);
  });

  it('an invalid payload is 400', async () => {
    const res = await send(signHook({ metadata: { name: 'before-user-created' }, user: { id: 'not-a-uuid' } }));
    expect(res.status).toBe(400);
  });

  it('without a hook secret the route does not exist', async () => {
    const plain = createTestApp().app;
    const res = await req(plain, 'POST', PATH, { rawBody: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(404);
    expect(res.body.error.key).toBe('ROUTE_NOT_FOUND');
  });
});
