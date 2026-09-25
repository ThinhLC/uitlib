import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { assignRole, getAccount, listAccounts, removeRole, setStatus } from '@/server/api/queries/accounts';

/** registerAccounts (US7: accounts and roles). */
export function registerAccounts(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.listAccounts, async (_c, { query }) => ({ status: 200, body: await listAccounts(deps.pool, query) }));

  route(app, deps, endpoints.getAccount, async (_c, { params }) => ({
    status: 200,
    body: await getAccount(deps.pool, params.accountId),
  }));

  route(app, deps, endpoints.assignRole, async (_c, { params }) => {
    await assignRole(deps.pool, params.accountId, params.roleCode);
    return { status: 204 };
  });

  route(app, deps, endpoints.removeRole, async (c, { params }) => {
    await removeRole(deps.pool, c.var.caller, params.accountId, params.roleCode);
    return { status: 204 };
  });

  route(app, deps, endpoints.setAccountStatus, async (c, { params, body }) => ({
    status: 200,
    body: await setStatus(deps.pool, c.var.caller, params.accountId, body.status),
  }));
}
