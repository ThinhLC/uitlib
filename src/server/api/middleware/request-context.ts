import type { MiddlewareHandler } from 'hono';
import { toDbTime } from '@/lib/time/db-time';
import type { ApiDeps, AppEnv } from '@/server/api/context';

const INCOMING = /^[A-Za-z0-9._-]{8,64}$/;

/** Sets requestId, now and dbNow for the request, and echoes X-Request-Id. */
export function requestContext(deps: ApiDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && INCOMING.test(incoming) ? incoming : crypto.randomUUID();
    const now = deps.clock();

    c.set('requestId', requestId);
    c.set('now', now);
    c.set('dbNow', toDbTime(now));
    c.header('X-Request-Id', requestId);

    return next();
  };
}
