import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiDeps, AppEnv } from './context';
import { ApiError } from './errors/api-error';
import { mapError } from './errors/map-error';
import { requestContext } from './middleware/request-id';
import { routeModules } from './routes';

const MAX_BODY_SIZE = 64 * 1024; // 64 KB

/**
 * The `/api/v1` application (plan.md). No import-time side effects: tests build it against the
 * test schema with a fixed clock and a local token verifier.
 */
export function createApp(deps: ApiDeps, extra: ((app: Hono<AppEnv>, deps: ApiDeps) => void)[] = []) {
  const app = new Hono<AppEnv>().basePath('/api/v1');
  const logger = deps.logger ?? console;

  app.use(secureHeaders());
  app.use(requestContext(deps));
  app.use(
    bodyLimit({
      maxSize: MAX_BODY_SIZE,
      onError: () => {
        throw new ApiError('VALIDATION', 'body too large', [{ path: '(body)', message: 'at most 64 KB' }]);
      },
    }),
  );

  for (const register of [...routeModules, ...extra]) register(app, deps);

  app.notFound((c) => {
    const { status, body, headers } = mapError(new ApiError('ROUTE_NOT_FOUND'), c.var.requestId ?? '', logger);
    return c.json(body, status as 404, headers);
  });

  app.onError((err, c) => {
    const requestId = c.var.requestId ?? crypto.randomUUID();
    const { status, body, headers } = mapError(err, requestId, logger);
    return c.json(body, status as 400, { ...headers, 'X-Request-Id': requestId });
  });

  return app;
}

export type ApiApp = ReturnType<typeof createApp>;
