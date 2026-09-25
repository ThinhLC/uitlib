import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { listReaderFines, listReaderPayments, readerBalance } from '@/server/api/queries/money';
import { adjustFine, recordPayment } from '@/server/api/services/procedures/money';

/** registerMoney (US5: fines, balance, payments, adjustments). */
export function registerMoney(app: Hono<AppEnv>, deps: ApiDeps): void {
  const { pool } = deps;

  route(app, deps, endpoints.readerFines, async (_c, { params, query }) => ({
    status: 200,
    body: await listReaderFines(pool, params.readerId, query),
  }));

  route(app, deps, endpoints.readerBalance, async (c, { params }) => ({
    status: 200,
    body: await readerBalance(pool, params.readerId, c.var.dbNow),
  }));

  route(app, deps, endpoints.readerPayments, async (_c, { params, query }) => ({
    status: 200,
    body: await listReaderPayments(pool, params.readerId, query),
  }));

  route(app, deps, endpoints.recordPayment, async (c, { body }) => {
    const result = await recordPayment(c, deps, body);
    return { status: result.replayed ? 200 : 201, body: result };
  });

  route(app, deps, endpoints.adjustFine, async (c, { params, body }) => ({
    status: 201,
    body: await adjustFine(c, deps, params.fineId, body.amountVnd, body.reason),
  }));
}
