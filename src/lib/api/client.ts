import { isUndefined, omitNil } from '@/lib/utils';
import { buildPath, type ApiErrorBody, type ClientInput, type EndpointSpec, type OutputOf } from './contract';

/** A non-2xx answer of the API, with the uniform error body (contracts/errors.md). */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(`${status} ${body.error.key}: ${body.error.message}`);
    this.name = 'ApiClientError';
  }

  get key() {
    return this.body.error.key;
  }
}

export interface FetchOptions {
  /** Supabase access token; sent as `Authorization: Bearer`. */
  token?: string;
  /** Origin of the API, e.g. `http://localhost:3000`. Default: same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (isUndefined(query)) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(omitNil(query))) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * Call one contract endpoint with typed input and output:
 * `await apiFetch(endpoints.checkout, { body: { readerId, copyIds } }, { token })`.
 */
export async function apiFetch<E extends EndpointSpec>(
  endpoint: E,
  input: ClientInput<E>,
  opts: FetchOptions = {},
): Promise<OutputOf<E>> {
  const { params, query, body } = input as { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown };
  const url = `${opts.baseUrl ?? ''}/api/v1${buildPath(endpoint.path, params)}${queryString(query)}`;
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await (opts.fetch ?? fetch)(url, {
    method: endpoint.method,
    headers,
    body: isUndefined(body) ? undefined : JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as OutputOf<E>;
  const json = await res.json().catch(() => null);
  if (res.ok) return json as OutputOf<E>;
  const fallback: ApiErrorBody = {
    error: { key: 'INTERNAL', category: 'internal', message: res.statusText, detail: '', requestId: res.headers.get('x-request-id') ?? '' },
  };
  throw new ApiClientError(res.status, (json as ApiErrorBody) ?? fallback);
}
