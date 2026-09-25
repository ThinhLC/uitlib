import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { getPolicy, listPolicies } from '@/server/api/queries/people';
import { closePolicyVersion, createPolicyVersion } from '@/server/api/services/procedures/people';

/** registerPolicies (US4: policy versions). */
export function registerPolicies(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.listPolicies, async (_c, { query }) => ({
    status: 200,
    body: await listPolicies(deps.pool, query),
  }));

  route(app, deps, endpoints.createPolicy, async (c, { body }) => {
    const policyId = await createPolicyVersion(c, deps, body);
    return { status: 201, body: await getPolicy(deps.pool, policyId) };
  });

  route(app, deps, endpoints.closePolicy, async (c, { params, body }) => {
    await closePolicyVersion(c, deps, params.policyId, body.validTo);
    return { status: 200, body: await getPolicy(deps.pool, params.policyId) };
  });
}
