import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { getCopy, listCopies } from '@/server/api/queries/copies';
import { changeCopyStatus, registerCopy } from '@/server/api/services/procedures/catalog';

/** Copies (US3): list, register (sp_register_copy) and maintenance status (sp_change_copy_status). */
export function registerCopies(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.listCopies, async (_c, { params }) => ({
    status: 200,
    body: { items: await listCopies(deps.pool, params.bookId) },
  }));

  route(app, deps, endpoints.registerCopy, async (c, { params, body }) => {
    const copyId = await registerCopy(c, deps, params.bookId, body);
    return { status: 201, body: await getCopy(deps.pool, copyId) };
  });

  route(app, deps, endpoints.changeCopyStatus, async (c, { params, body }) => {
    await changeCopyStatus(c, deps, params.copyId, body);
    return { status: 200, body: await getCopy(deps.pool, params.copyId) };
  });
}
