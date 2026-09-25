import type { Context } from 'hono';
import { ApiError } from '@/server/api/errors/api-error';
import type { ApiDeps, AppEnv, Caller } from '@/server/api/context';
import { ensureAccount, resolveCaller } from '@/server/api/services/accounts';

/**
 * Verify the bearer token and resolve the caller (FR-006–FR-008a, FR-011). An unknown subject
 * gets its account created once; a known subject is read only.
 */
export async function authenticate(
  c: Context<AppEnv>,
  deps: ApiDeps,
  opts: { allowInactive: boolean },
): Promise<Caller> {
  const header = c.req.header('authorization') ?? '';
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(header.trim());
  if (!m) throw new ApiError('UNAUTHENTICATED');
  const { sub, email, fullName } = await deps.verifyToken(m[1]);
  let caller = await resolveCaller(deps.pool, sub);
  if (!caller) {
    await ensureAccount(deps.pool, sub, c.var.dbNow, { email, fullName });
    caller = await resolveCaller(deps.pool, sub);
    if (!caller) throw new Error(`account for ${sub} missing after ensureAccount`);
  }
  if (caller.status !== 'active' && !opts.allowInactive) throw new ApiError('ACCOUNT_INACTIVE');
  c.set('caller', caller);
  return caller;
}
