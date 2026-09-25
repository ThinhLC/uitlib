import type { z } from 'zod';
import { isNil } from '@/lib/utils';
import type { ErrorKey } from './errors';

/** Permission codes of spec 001 FR-020. */
export const PERMISSIONS = [
  'catalog.write',
  'catalog.import',
  'card.manage',
  'loan.checkout',
  'loan.return',
  'loan.renew',
  'fine.collect',
  'fine.adjust',
  'policy.manage',
  'role.manage',
  'report.read',
  'reservation.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Who may call an endpoint.
 * - `public`: no token.
 * - `token`: a verified token; `inactive` accounts are allowed (only `GET /me`).
 * - `signed-in`: an active account.
 * - `perm`: an active account holding at least one of `any` (checked by the server).
 * - `self-or`: the caller's own reader (path param `readerParam`) or a holder of one of `any`;
 *   anyone else gets NOT_FOUND, like a missing id (FR-010).
 * - `procedure`: an active account; the stored procedure decides the permission.
 * - `webhook`: authenticated by a webhook signature, not a token.
 */
export type Access =
  | { kind: 'public' }
  | { kind: 'token' }
  | { kind: 'signed-in' }
  | { kind: 'perm'; any: readonly Permission[] }
  | { kind: 'self-or'; any: readonly Permission[]; readerParam: string }
  | { kind: 'procedure' }
  | { kind: 'webhook' };

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointSpec {
  method: Method;
  /** Hono path relative to `/api/v1`, with `:param` placeholders. */
  path: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  access: Access;
  /** The spec 001 procedure the endpoint calls, if any. */
  procedure?: string;
  /** Error keys the endpoint can return, besides the generic ones (UNAUTHENTICATED, VALIDATION, BUSY, INTERNAL…). */
  errors: readonly ErrorKey[];
}

declare const OUT: unique symbol;

/** An endpoint with its response type attached (type-level only). */
export type Endpoint<S extends EndpointSpec = EndpointSpec, Out = unknown> = S & { readonly [OUT]?: Out };

/**
 * Declare an endpoint: `defineEndpoint<CheckoutResult>()({ method: 'POST', path: '/loans', … })`.
 * The response type is fixed by the type argument; inputs come from the zod schemas.
 */
export function defineEndpoint<Out>() {
  return <const S extends EndpointSpec>(spec: S): Endpoint<S, Out> => Object.freeze(spec) as Endpoint<S, Out>;
}

type SchemaAt<E, K extends 'params' | 'query' | 'body'> = E extends { [P in K]: infer S extends z.ZodType } ? S : never;
type Has<E, K extends 'params' | 'query' | 'body'> = [SchemaAt<E, K>] extends [never] ? false : true;

/** The response body type of an endpoint. */
export type OutputOf<E> = E extends { readonly [OUT]?: infer O } ? O : never;

/** Parsed input as the server handler receives it. */
export type ParsedInput<E> = {
  params: Has<E, 'params'> extends true ? z.output<SchemaAt<E, 'params'>> : Record<string, never>;
  query: Has<E, 'query'> extends true ? z.output<SchemaAt<E, 'query'>> : Record<string, never>;
  body: Has<E, 'body'> extends true ? z.output<SchemaAt<E, 'body'>> : undefined;
};

/** Input as a client sends it (`apiFetch`). */
export type ClientInput<E> = (Has<E, 'params'> extends true ? { params: z.input<SchemaAt<E, 'params'>> } : { params?: never }) &
  (Has<E, 'query'> extends true ? { query?: z.input<SchemaAt<E, 'query'>> } : { query?: never }) &
  (Has<E, 'body'> extends true ? { body: z.input<SchemaAt<E, 'body'>> } : { body?: never });

/** Fill `:param` placeholders of an endpoint path. */
export function buildPath(path: string, params: Record<string, unknown> = {}): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const v = params[name];
    if (isNil(v)) throw new Error(`Missing path parameter ${name}`);
    return encodeURIComponent(String(v));
  });
}
