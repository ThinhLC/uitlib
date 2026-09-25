import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { truncateAll } from '../helpers/fixtures';
import { asAccount, createTestApp, req } from './helpers/app';
import { signToken } from './helpers/tokens';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app } = createTestApp();
const accounts = async () => Number((await ownerQuery('SELECT COUNT(*) n FROM app_users'))[0].n);

describe('US1 identity (FR-006–FR-011, SC-003)', () => {
  it('US1-1: missing or unverifiable tokens are 401 and create nothing', async () => {
    const bad: [string, Record<string, string>][] = [
      ['no header', {}],
      ['not bearer', { Authorization: 'Basic abc' }],
      ['garbage', { Authorization: 'Bearer not.a.jwt' }],
      ['expired', { Authorization: `Bearer ${await signToken({ expiresIn: Math.floor(Date.now() / 1000) - 60 })}` }],
      ['wrong issuer', { Authorization: `Bearer ${await signToken({ issuer: 'https://evil.example/auth/v1' })}` }],
      ['wrong audience', { Authorization: `Bearer ${await signToken({ audience: 'anon' })}` }],
      ['anonymous', { Authorization: `Bearer ${await signToken({ claims: { is_anonymous: true } })}` }],
      ['foreign key', { Authorization: `Bearer ${await signToken({ foreignKey: true })}` }],
      ['service role', { Authorization: `Bearer ${await signToken({ claims: { role: 'service_role' } })}` }],
    ];
    for (const [name, headers] of bad) {
      const res = await req(app, 'GET', '/me', { headers });
      expect(res.status, name).toBe(401);
      expect(res.body.error.key, name).toBe('UNAUTHENTICATED');
      expect(res.headers.get('www-authenticate'), name).toBe('Bearer');
    }
    expect(await accounts()).toBe(0);
  });

  it('FR-008: a sign-in with another provider (GitHub) is 401 with detail provider, and no account is created', async () => {
    const token = await signToken({ claims: { app_metadata: { provider: 'github', providers: ['github'] } } });
    const res = await req(app, 'GET', '/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ key: 'UNAUTHENTICATED', detail: 'provider' });
    expect(await accounts()).toBe(0);
  });

  it('FR-008: an email/password user is accepted like a Google user', async () => {
    const token = await signToken({ claims: { app_metadata: { provider: 'email', providers: ['email'] } } });
    const res = await req(app, 'GET', '/me', { token });
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(['reader']);
  });

  it('US1-2: an actor field in the body is rejected; a spoofed query is ignored', async () => {
    const a = await asAccount(['reader']);
    const other = await asAccount(['admin']);
    const rejected = await req(app, 'POST', '/__probe/echo', { token: a.token, body: { note: 'hi', actorUserId: other.accountId } });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.key).toBe('VALIDATION');
    expect(rejected.body.error.fields).toContainEqual({ path: 'actorUserId', message: 'unknown field' });

    const ok = await req(app, 'POST', '/__probe/echo', {
      token: a.token, body: { note: 'hi' }, query: { actorUserId: other.accountId },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.accountId).toBe(a.accountId);
  });

  it('US1-3: roles come only from the library database, not token metadata', async () => {
    const a = await asAccount(['reader']);
    const forged = await signToken({ sub: a.subject, claims: { user_metadata: { role: 'admin' }, app_metadata: { provider: 'google', providers: ['google'], role: 'admin' } } });
    const res = await req(app, 'GET', '/__probe/admin', { token: forged });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ key: 'FORBIDDEN', detail: 'role.manage' });

    const admin = await asAccount(['admin']);
    expect((await req(app, 'GET', '/__probe/admin', { token: admin.token })).status).toBe(200);
  });

  it('US1-5, FR-011: an inactive account may call /me only', async () => {
    const a = await asAccount(['librarian'], { status: 'inactive' });
    const me = await req(app, 'GET', '/me', { token: a.token });
    expect(me.status).toBe(200);
    expect(me.body.status).toBe('inactive');
    const res = await req(app, 'POST', '/__probe/echo', { token: a.token, body: { note: 'x' } });
    expect(res.status).toBe(403);
    expect(res.body.error.key).toBe('ACCOUNT_INACTIVE');
  });

  it('every response carries X-Request-Id; a well-formed incoming id is echoed', async () => {
    const res = await req(app, 'GET', '/health');
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await req(app, 'GET', '/nope', { headers: { 'X-Request-Id': 'trace-12345678' } });
    expect(echoed.status).toBe(404);
    expect(echoed.body.error).toMatchObject({ key: 'ROUTE_NOT_FOUND', requestId: 'trace-12345678' });
    expect(echoed.headers.get('x-request-id')).toBe('trace-12345678');
  });

  it('malformed JSON and a wrong content type are VALIDATION', async () => {
    const a = await asAccount(['reader']);
    const bad = await req(app, 'POST', '/__probe/echo', { token: a.token, rawBody: '{', headers: { 'Content-Type': 'application/json' } });
    expect(bad.status).toBe(400);
    const noType = await req(app, 'POST', '/__probe/echo', { token: a.token, rawBody: '{"note":"x"}', headers: { 'Content-Type': 'text/plain' } });
    expect(noType.status).toBe(400);
    expect(noType.body.error.detail).toBe('content-type');
  });

  it('a token for an unknown subject never reads another account', async () => {
    await asAccount(['admin']);
    const res = await req(app, 'GET', '/__probe/admin', { token: await signToken({ sub: randomUUID() }) });
    expect(res.status).toBe(403);
  });
});
