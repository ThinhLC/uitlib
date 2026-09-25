import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { EndpointSpec, OutputOf, ParsedInput } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from './context';
import { ApiError } from './errors/api-error';
import { enforceAccess } from './middleware/access';
import { authenticate } from './middleware/auth';

export type Reply<Out> = { status: 200 | 201; body: Out } | { status: 204 };

export type Handler<E> = (c: Context<AppEnv>, input: ParsedInput<E>) => Promise<Reply<OutputOf<E>>>;

const mounted = new WeakMap<object, Set<EndpointSpec>>();

/** Record an endpoint registered by hand (routes that answer outside the uniform error shape). */
export function markMounted(app: object, endpoint: EndpointSpec): void {
  let set = mounted.get(app);
  if (!set) mounted.set(app, (set = new Set()));
  set.add(endpoint);
}

/** Endpoints registered on an app (coverage test, FR-002). */
export function mountedEndpoints(app: object): Set<EndpointSpec> {
  return mounted.get(app) ?? new Set();
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  const type = c.req.header('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new ApiError('VALIDATION', 'content-type', [{ path: '(body)', message: 'expected application/json' }]);
  }
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('VALIDATION', 'json', [{ path: '(body)', message: 'malformed JSON' }]);
  }
}

/**
 * Register one contract endpoint (research R2). Order: authenticate → params → access → query →
 * body → handler. Inputs are parsed with the endpoint's zod schemas (a ZodError becomes
 * VALIDATION in mapError); the handler must return the endpoint's output type.
 */
export function route<E extends EndpointSpec>(app: Hono<AppEnv>, deps: ApiDeps, endpoint: E, handler: Handler<E>): void {
  markMounted(app, endpoint);

  app.on(endpoint.method, endpoint.path, async (c) => {
    const { access } = endpoint;
    const needsToken = access.kind !== 'public' && access.kind !== 'webhook';
    const caller = needsToken
      ? await authenticate(c, deps, { allowInactive: access.kind === 'token' })
      : undefined;

    const params = endpoint.params ? endpoint.params.parse(c.req.param()) : {};
    enforceAccess(access, caller, params as Record<string, unknown>);
    const query = endpoint.query ? endpoint.query.parse(c.req.query()) : {};
    const body = endpoint.body ? endpoint.body.parse(await readJson(c)) : undefined;

    const reply = await handler(c, { params, query, body } as ParsedInput<E>);
    if (reply.status === 204) return c.body(null, 204);
    return c.json(reply.body as object, reply.status as ContentfulStatusCode);
  });
}
