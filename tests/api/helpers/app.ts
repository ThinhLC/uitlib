import { createApp } from '@/server/api/app';
import type { ApiDeps } from '@/server/api/context';
import { mapError } from '@/server/api/errors/map-error';
import { ownerQuery, testAppPool } from '../../helpers/db';
import { account } from '../../helpers/fixtures';
import { isUndefined, omitNil } from '@/lib/utils';
import { registerProbes } from './probe';
import { signToken, localVerifier } from './tokens';

/** A settable clock (research R8): tests move business time explicitly. */
export class TestClock {
  constructor(private at = new Date('2026-09-10T03:00:00.000Z')) {}
  now = () => new Date(this.at);
  /** Set from a DB time string (e.g. `vn('2026-09-10 10:00')`) or a Date. */
  set(t: string | Date) {
    this.at = typeof t === 'string' ? new Date(`${t.replace(' ', 'T')}Z`) : t;
  }
  advanceDays(days: number) {
    this.at = new Date(this.at.getTime() + days * 86_400_000);
  }
}

const quiet = { error: () => {}, info: () => {} };

export function createTestApp(opts: { clock?: TestClock; hookSecret?: string; deps?: Partial<ApiDeps> } = {}) {
  const clock = opts.clock ?? new TestClock();
  const deps: ApiDeps = {
    pool: testAppPool(),
    clock: clock.now,
    verifyToken: localVerifier,
    hookSecret: opts.hookSecret,
    logger: quiet,
    ...opts.deps,
  };
  const app = createApp(deps, [registerProbes]);
  return { app, clock, deps };
}

export type TestApp = ReturnType<typeof createTestApp>['app'];

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** Call the app in-process: `req(app, 'POST', '/loans', { token, body })`. */
export async function req<T = any>(
  app: TestApp,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; rawBody?: string; query?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<Res<T>> {
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(omitNil(opts.query)).map(([k, v]) => [k, String(v)])).toString()
    : '';
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined = opts.rawBody;
  if (!isUndefined(opts.body)) {
    headers['Content-Type'] ??= 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await app.request(`/api/v1${path}${qs}`, { method, headers, body });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/** An account with the given roles and a token whose `sub` is its Supabase id. */
export async function asAccount(roles: string[] = ['librarian'], opts: { status?: 'active' | 'inactive' } = {}) {
  const accountId = await account(roles, opts);
  const [row] = await ownerQuery(`SELECT supabase_user_id s FROM app_users WHERE id = ?`, [accountId]);
  return { accountId, subject: String(row.s), token: await signToken({ sub: String(row.s) }) };
}

/** A reader account linked to a new reader profile. */
export async function asReader(readerId: number) {
  const a = await asAccount(['reader']);
  await ownerQuery(`UPDATE readers SET user_id = ? WHERE id = ?`, [a.accountId, readerId]);
  return a;
}

export { mapError };
