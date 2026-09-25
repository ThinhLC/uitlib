import { ZodError } from 'zod';
import {
  CATEGORY_STATUS,
  categoryOf,
  messageFor,
  type ApiErrorBody,
  type ErrorKey,
} from '@/lib/api/contract';
import { DbRuleError } from '@/lib/db/call-procedure';
import { isRetryable } from '@/lib/db/with-retry';
import { ApiError, type FieldError } from './api-error';

export interface MappedError {
  status: number;
  body: ApiErrorBody;
  headers: Record<string, string>;
}

/** Unknown keys are reported one path each, so a client sees `actorUserId` directly. */
function expandUnknownKeys(err: ZodError): FieldError[] {
  return err.issues.flatMap((i) => {
    const base = i.path.map(String);
    if (i.code === 'unrecognized_keys') {
      return i.keys.map((k) => ({ path: [...base, k].join('.'), message: 'unknown field' }));
    }
    return [{ path: base.join('.') || '(root)', message: i.message }];
  });
}

function toApiError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (err instanceof DbRuleError) return new ApiError(err.key as ErrorKey, err.detail);
  if (err instanceof ZodError) return new ApiError('VALIDATION', '', expandUnknownKeys(err));
  if (isRetryable(err)) return new ApiError('BUSY');
  const errno = (err as { errno?: number })?.errno;
  if (errno === 1062) {
    // A unique key hit in a direct write (catalog, readers, accounts): same key as callProcedure.
    const index = /for key '(?:[^'.]+\.)?([^']+)'/.exec(String((err as Error).message))?.[1] ?? 'unique key';
    return new ApiError('DUPLICATE', index);
  }
  if (errno === 1452) {
    // "… FOREIGN KEY (`publisher_id`) REFERENCES …": report the column that points nowhere.
    const col = /FOREIGN KEY \(`([^`]+)`\)/.exec(String((err as Error).message))?.[1] ?? '';
    return new ApiError('NOT_FOUND', col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()));
  }
  return null;
}

/**
 * Map any thrown value to the uniform error response (contracts/errors.md "Sources and
 * mapping"). Unknown errors become INTERNAL: logged at `error` with the full cause, never
 * returned (FR-022). Known outcomes (401/403/404/409/…) are logged at `info` with their key only.
 */
export function mapError(
  err: unknown,
  requestId: string,
  logger: Pick<Console, 'error' | 'info'> = console,
): MappedError {
  const known = toApiError(err);
  if (known) logger.info(`[api] ${requestId} ${known.key}${known.detail ? ` (${known.detail})` : ''}`);
  else logger.error(`[api] ${requestId} internal error`, err);

  const api = known ?? new ApiError('INTERNAL');
  const category = categoryOf(api.key);
  const detail = api.key === 'INTERNAL' ? '' : api.detail;
  const headers: Record<string, string> = {};

  if (category === 'unauthenticated') headers['WWW-Authenticate'] = 'Bearer';
  if (api.key === 'BUSY') headers['Retry-After'] = '1';
  if (api.key === 'AUTH_UNAVAILABLE') headers['Retry-After'] = '5';

  const body: ApiErrorBody = {
    error: {
      key: api.key,
      category,
      message: messageFor(api.key, detail),
      detail,
      ...(api.fields ? { fields: api.fields } : {}),
      requestId,
    },
  };
  return { status: CATEGORY_STATUS[category], body, headers };
}
