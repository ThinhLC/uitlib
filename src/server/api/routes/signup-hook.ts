import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import { isRetryable } from '@/lib/db/with-retry';
import { HookPayload, isAllowedSignup, verifyHookSignature } from '@/integrations/supabase/signup-hook';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { markMounted } from '@/server/api/define-route';
import { ApiError } from '@/server/api/errors/api-error';
import { ensureAccount } from '@/server/api/services/accounts';

const isConnectionError = (err: unknown) =>
  typeof (err as { code?: unknown })?.code === 'string' &&
  /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|ER_CON_COUNT_ERROR)$/.test((err as { code: string }).code);

/**
 * Supabase Before User Created hook (FR-008b, contracts/signup-hook.md). Answers in Supabase's
 * format; one attempt with a 2 s lock wait keeps it inside the 5 s budget (analysis U2).
 */
export function registerSignupHook(app: Hono<AppEnv>, deps: ApiDeps): void {
  const ep = endpoints.signupHook;
  markMounted(app, ep);
  const logger = deps.logger ?? console;

  app.on(ep.method, ep.path, async (c) => {
    if (!deps.hookSecret) throw new ApiError('ROUTE_NOT_FOUND');
    const deny = (status: 400 | 401 | 403 | 500 | 503, message: string) =>
      c.json({ error: { http_code: status, message } }, status, status === 503 ? { 'Retry-After': '1' } : {});

    const raw = await c.req.text();
    const headers = Object.fromEntries(c.req.raw.headers);
    if (!verifyHookSignature(deps.hookSecret, raw, headers)) return deny(401, 'invalid signature');

    let payload: HookPayload;
    try {
      payload = HookPayload.parse(JSON.parse(raw));
    } catch {
      return deny(400, 'invalid payload');
    }
    if (!isAllowedSignup(payload, deps.allowedProviders)) return deny(403, 'Sign in with Google or email to use the library.');

    try {
      const { created, reader } = await ensureAccount(
        deps.pool,
        payload.user.id.toLowerCase(),
        c.var.dbNow,
        { email: payload.user.email, fullName: payload.user.user_metadata?.full_name ?? payload.user.user_metadata?.name },
        { attempts: 1, lockWaitSeconds: 2 },
      );
      logger.info(
        `[api] ${c.var.requestId} signup-hook webhook=${headers['webhook-id'] ?? ''} subject=${payload.user.id} created=${created} reader=${reader}`,
      );
      return c.json({}, 200);
    } catch (err) {
      if (isRetryable(err) || isConnectionError(err)) return deny(503, 'try again');
      logger.error(`[api] ${c.var.requestId} signup-hook failed`, err);
      return deny(500, 'internal error');
    }
  });
}
