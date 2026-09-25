import type { Context } from 'hono';
import type { RowDataPacket } from 'mysql2/promise';
import { callProcedure, type CallResult } from '@/lib/db/call-procedure';
import type { ApiDeps, AppEnv } from '@/server/api/context';

/**
 * Call an operation procedure as the verified caller at the request's business time:
 * `sp_x(p_actor_user_id = caller.accountId, p_now = dbNow, ...args, @out...)` (FR-007, FR-023).
 * Errors propagate as DbRuleError / mysql errors; mapError turns them into responses.
 */
export function callAsCaller<Out = Record<string, unknown>>(
  c: Context<AppEnv>,
  deps: ApiDeps,
  name: string,
  args: unknown[],
  outParams: string[] = [],
): Promise<CallResult<Out>> {
  return callProcedure<Out>(deps.pool, name, [c.var.caller.accountId, c.var.dbNow, ...args], { outParams });
}

/** First result set of a procedure call. */
export const firstSet = (r: CallResult<unknown>): RowDataPacket[] => r.rows[0] ?? [];
