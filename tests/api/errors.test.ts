import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DbRuleError } from '@/lib/db/call-procedure';
import { ApiError } from '@/server/api/errors/api-error';
import { mapError } from '@/server/api/errors/map-error';

const quiet = { error: () => {}, info: () => {} };
const map = (err: unknown) => mapError(err, 'req-1', quiet);
const mysqlError = (errno: number, message = 'x') => Object.assign(new Error(message), { errno });

describe('mapError (contracts/errors.md "Sources and mapping")', () => {
  it('passes ApiError through with its category and status', () => {
    expect(map(new ApiError('UNAUTHENTICATED'))).toMatchObject({ status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    expect(map(new ApiError('ACCOUNT_INACTIVE')).status).toBe(403);
    expect(map(new ApiError('AUTH_UNAVAILABLE'))).toMatchObject({ status: 503, headers: { 'Retry-After': '5' } });
    expect(map(new ApiError('ROUTE_NOT_FOUND')).status).toBe(404);
  });

  it('maps DbRuleError keys to their categories', () => {
    const cases: [string, number, string][] = [
      ['FORBIDDEN', 403, 'forbidden'],
      ['NOT_FOUND', 404, 'not_found'],
      ['VALIDATION', 400, 'validation'],
      ['COPY_NOT_AVAILABLE', 409, 'conflict'],
      ['DUPLICATE', 409, 'conflict'],
      ['IDEMPOTENCY_CONFLICT', 409, 'conflict'],
      ['SOME_FUTURE_KEY', 409, 'conflict'],
    ];
    for (const [key, status, category] of cases) {
      const m = map(new DbRuleError(key, 'd', `${key}: d`));
      expect(m.status, key).toBe(status);
      expect(m.body.error, key).toMatchObject({ key, category, detail: 'd', requestId: 'req-1' });
    }
  });

  it('uses detail-specific messages', () => {
    expect(map(new DbRuleError('RENEWAL_REJECTED', 'limit', '')).body.error.message).toBe('The renewal limit has been reached.');
    expect(map(new DbRuleError('DUPLICATE', 'book_copies_barcode_uq', '')).body.error.message).toBe('Barcode already in use.');
  });

  it('maps ZodError to VALIDATION with dotted field paths', () => {
    const r = z.strictObject({ copyIds: z.array(z.number()) }).safeParse({ copyIds: [1, 'x'], extra: 1 });
    const m = map(r.error);
    expect(m.status).toBe(400);
    expect(m.body.error.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'copyIds.1' }), { path: 'extra', message: 'unknown field' }]),
    );
  });

  it('maps deadlock and lock wait to BUSY with Retry-After', () => {
    for (const errno of [1213, 1205]) {
      expect(map(mysqlError(errno))).toMatchObject({ status: 503, headers: { 'Retry-After': '1' } });
      expect(map(mysqlError(errno)).body.error.key).toBe('BUSY');
    }
  });

  it('maps a unique-key hit in a direct write to DUPLICATE naming the index', () => {
    const m = map(mysqlError(1062, "Duplicate entry '5' for key 'readers.readers_user_uq'"));
    expect(m.status).toBe(409);
    expect(m.body.error).toMatchObject({ key: 'DUPLICATE', detail: 'readers_user_uq', message: 'This account is already linked to a reader.' });
  });

  it('maps a foreign-key miss to NOT_FOUND naming the field', () => {
    const m = map(mysqlError(1452, 'Cannot add … FOREIGN KEY (`publisher_id`) REFERENCES `publishers` (`id`)'));
    expect(m.status).toBe(404);
    expect(m.body.error.detail).toBe('publisherId');
  });

  it('logs INTERNAL at error with the cause, and known outcomes at info with the key only', () => {
    const calls: { level: string; args: unknown[] }[] = [];
    const logger = { error: (...args: unknown[]) => calls.push({ level: 'error', args }), info: (...args: unknown[]) => calls.push({ level: 'info', args }) };
    mapError(new ApiError('UNAUTHENTICATED'), 'r1', logger);
    mapError(new DbRuleError('RENEWAL_REJECTED', 'limit', ''), 'r2', logger);
    const boom = new Error('boom');
    mapError(boom, 'r3', logger);
    expect(calls.map((c) => c.level)).toEqual(['info', 'info', 'error']);
    expect(calls[0].args).toEqual(['[api] r1 UNAUTHENTICATED']);
    expect(calls[1].args).toEqual(['[api] r2 RENEWAL_REJECTED (limit)']);
    expect(calls[2].args).toEqual(['[api] r3 internal error', boom]);
  });

  it('hides everything else as INTERNAL with an empty detail', () => {
    for (const err of [mysqlError(3819, 'Check constraint secret_ck'), mysqlError(1142, 'INSERT denied'), new Error('boom')]) {
      const m = map(err);
      expect(m.status).toBe(500);
      expect(m.body.error).toMatchObject({ key: 'INTERNAL', category: 'internal', detail: '' });
      expect(JSON.stringify(m.body)).not.toMatch(/secret_ck|denied|boom/);
    }
  });
});
