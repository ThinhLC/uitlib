import type { Hono } from 'hono';
import { z } from 'zod';
import { defineEndpoint } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';

/** Test-only endpoints (tasks T025) so US1 tests need no route from a later story. */
export const probeEndpoints = {
  echo: defineEndpoint<{ accountId: number; note: string }>()({
    method: 'POST',
    path: '/__probe/echo',
    body: z.strictObject({ note: z.string().max(10) }),
    access: { kind: 'signed-in' },
    errors: [],
  }),
  admin: defineEndpoint<{ ok: true }>()({
    method: 'GET',
    path: '/__probe/admin',
    access: { kind: 'perm', any: ['role.manage'] },
    errors: ['FORBIDDEN'],
  }),
};

export function registerProbes(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, probeEndpoints.echo, async (c, { body }) => ({
    status: 200,
    body: { accountId: c.var.caller.accountId, note: body.note },
  }));
  route(app, deps, probeEndpoints.admin, async () => ({ status: 200, body: { ok: true as const } }));
}
