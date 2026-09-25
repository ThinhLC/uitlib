import { randomUUID } from 'node:crypto';
import type { CookieMethodsServer } from '@supabase/ssr';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseAuthFactory } from '@/integrations/supabase/server-client';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { truncateAll } from '../helpers/fixtures';
import { asAccount, createTestApp } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const ORIGIN = 'http://localhost';
const NO_CACHE = { 'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0', Expires: '0', Pragma: 'no-cache' };

const sessionFor = (id: string, provider = 'google') =>
  ({
    user: { id, email: `${id.slice(0, 8)}@gmail.com`, app_metadata: { provider, providers: [provider] }, user_metadata: { full_name: 'Callback User' } },
    access_token: 'at',
    refresh_token: 'rt',
  }) as any;

interface StubCalls {
  seenCookies: { name: string; value: string }[];
  exchanged: string[];
  verified: { type: string; token_hash: string }[];
  signedOut: number;
}

/** A Supabase auth stub that writes cookies through the adapter like @supabase/ssr does. */
function stubAuth(opts: { session?: any; error?: unknown } = {}): { factory: SupabaseAuthFactory; calls: StubCalls } {
  const calls: StubCalls = { seenCookies: [], exchanged: [], verified: [], signedOut: 0 };
  const factory: SupabaseAuthFactory = (cookies: CookieMethodsServer) => {
    const writeSession = async () => {
      calls.seenCookies = ((await cookies.getAll()) ?? []) as StubCalls['seenCookies'];
      if (opts.error) return { data: { session: null }, error: opts.error };
      await cookies.setAll?.(
        [
          { name: 'sb-test-auth-token', value: 'session-json', options: { path: '/', httpOnly: true, sameSite: 'lax' } },
          { name: 'sb-test-auth-token-code-verifier', value: '', options: { path: '/', maxAge: 0 } },
        ],
        NO_CACHE,
      );
      return { data: { session: opts.session ?? null }, error: null };
    };
    return {
      exchangeCodeForSession: async (code) => {
        calls.exchanged.push(code);
        return writeSession();
      },
      verifyOtp: async (p) => {
        calls.verified.push(p);
        return writeSession();
      },
      signOut: async () => {
        calls.signedOut++;
        await cookies.setAll?.([{ name: 'sb-test-auth-token', value: '', options: { path: '/', maxAge: 0 } }], {});
        return { error: null };
      },
    };
  };
  return { factory, calls };
}

async function get(factory: SupabaseAuthFactory | undefined, path: string, cookie?: string) {
  const { app } = createTestApp({ deps: { supabaseAuth: factory } });
  return app.request(`/api/v1${path}`, { headers: cookie ? { cookie } : {} });
}

const accountRoles = async (sub: string) =>
  (await ownerQuery(
    `SELECT r.code FROM app_users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
      WHERE u.supabase_user_id = ?`, [sub])).map((r) => r.code);

describe('GET /auth/callback (FR-008d, OAuth PKCE)', () => {
  it('exchanges the code, sets session cookies with no-cache headers, ensures the account, redirects to next', async () => {
    const sub = randomUUID();
    const { factory, calls } = stubAuth({ session: sessionFor(sub) });
    const res = await get(factory, '/auth/callback?code=abc123&next=/books/7', 'sb-test-auth-token-code-verifier=verifier-1');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/books/7`);
    expect(calls.exchanged).toEqual(['abc123']);
    expect(calls.seenCookies).toContainEqual({ name: 'sb-test-auth-token-code-verifier', value: 'verifier-1' });
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.startsWith('sb-test-auth-token=session-json') && /HttpOnly/i.test(c))).toBe(true);
    expect(setCookie.some((c) => c.startsWith('sb-test-auth-token-code-verifier=;'))).toBe(true);
    expect(res.headers.get('cache-control')).toBe(NO_CACHE['Cache-Control']);
    expect(await accountRoles(sub)).toEqual(['reader']);
    const [reader] = await ownerQuery(
      `SELECT r.full_name, r.email FROM readers r JOIN app_users u ON u.id = r.user_id WHERE u.supabase_user_id = ?`, [sub]);
    expect(reader).toEqual({ full_name: 'Callback User', email: `${sub.slice(0, 8)}@gmail.com` });
  });

  it('a sign-in backfills the reader of an existing account, and never adds a second one', async () => {
    const existing = await asAccount(['reader']);
    const { factory } = stubAuth({ session: sessionFor(existing.subject) });
    for (let i = 0; i < 2; i++) expect((await get(factory, '/auth/callback?code=c')).status).toBe(302);
    const readers = await ownerQuery(`SELECT full_name, reader_type_id FROM readers WHERE user_id = ?`, [existing.accountId]);
    expect(readers).toHaveLength(1);
    expect(readers[0].full_name).toBe('Callback User');
    expect(await accountRoles(existing.subject)).toEqual(['reader']);
  });

    it('never redirects off-site: a missing, absolute or protocol-relative next becomes /', async () => {
    for (const next of ['', '&next=//evil.example/x', '&next=https://evil.example', '&next=/\\evil.example']) {
      const { factory } = stubAuth({ session: sessionFor(randomUUID()) });
      const res = await get(factory, `/auth/callback?code=c${next}`);
      expect(res.headers.get('location'), next).toBe(`${ORIGIN}/`);
    }
  });

  it('redirects failures to the error page with a reason', async () => {
    const cases: [SupabaseAuthFactory | undefined, string, string][] = [
      [stubAuth().factory, '/auth/callback?error=access_denied&error_description=denied', 'provider_error'],
      [stubAuth().factory, '/auth/callback', 'missing_code'],
      [stubAuth({ error: new Error('invalid grant') }).factory, '/auth/callback?code=bad', 'exchange_failed'],
      [undefined, '/auth/callback?code=c', 'not_configured'],
    ];
    for (const [factory, path, reason] of cases) {
      const res = await get(factory, path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toBe(`${ORIGIN}/auth/error?reason=${reason}`);
    }
    expect(Number((await ownerQuery('SELECT COUNT(*) n FROM app_users'))[0].n)).toBe(0);
  });

  it('a database failure while creating the account is reported, not hidden', async () => {
    const { factory } = stubAuth({ session: sessionFor(randomUUID()) });
    const real = createTestApp().deps.pool;
    const down = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const pool = new Proxy(real, {
      get: (t, p) => (p === 'getConnection' ? async () => { throw down; } : (t as any)[p]),
    });
    const errors: unknown[] = [];
    const { app } = createTestApp({ deps: { supabaseAuth: factory, pool, logger: { error: (...a: unknown[]) => errors.push(a), info: () => {} } } });
    const res = await app.request('/api/v1/auth/callback?code=c&next=/books');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/auth/error?reason=account_unavailable`);
    expect(errors).toHaveLength(1);
  });

  it('an email/password session is accepted like a Google one', async () => {
    const sub = randomUUID();
    const { factory } = stubAuth({ session: sessionFor(sub, 'email') });
    const res = await get(factory, '/auth/callback?code=c');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/`);
    expect(await accountRoles(sub)).toEqual(['reader']);
  });

  it('a session from another provider (GitHub) is signed out again and refused, with no account', async () => {
    const sub = randomUUID();
    const { factory, calls } = stubAuth({ session: sessionFor(sub, 'github') });
    const res = await get(factory, '/auth/callback?code=c');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/auth/error?reason=provider_not_allowed`);
    expect(calls.signedOut).toBe(1);
    expect(res.headers.getSetCookie().at(-1)).toMatch(/^sb-test-auth-token=;.*Max-Age=0/i);
    expect(await accountRoles(sub)).toEqual([]);
  });
});

describe('GET /auth/confirm (FR-008d, email link token_hash)', () => {
  it('verifies the token hash and redirects to next', async () => {
    const sub = randomUUID();
    const { factory, calls } = stubAuth({ session: sessionFor(sub) });
    const res = await get(factory, '/auth/confirm?token_hash=th1&type=email_change&next=/account');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account`);
    expect(calls.verified).toEqual([{ type: 'email_change', token_hash: 'th1' }]);
    expect(await accountRoles(sub)).toEqual(['reader']);
  });

  it('rejects incomplete or unknown links and failed verification', async () => {
    const cases: [SupabaseAuthFactory | undefined, string, string][] = [
      [stubAuth().factory, '/auth/confirm?type=email', 'invalid_link'],
      [stubAuth().factory, '/auth/confirm?token_hash=t&type=sms', 'invalid_link'],
      [stubAuth({ error: new Error('expired') }).factory, '/auth/confirm?token_hash=t&type=email', 'verify_failed'],
      [undefined, '/auth/confirm?token_hash=t&type=email', 'not_configured'],
    ];
    for (const [factory, path, reason] of cases) {
      const res = await get(factory, path);
      expect(res.headers.get('location'), path).toBe(`${ORIGIN}/auth/error?reason=${reason}`);
    }
  });
});
