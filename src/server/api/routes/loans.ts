import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { notFound } from '@/server/api/errors/api-error';
import { isStaffFor } from '@/server/api/middleware/access';
import { cardByNumber, copyByBarcode, listReaderLoanItems, readerExists } from '@/server/api/queries/loans';
import * as proc from '@/server/api/services/procedures/circulation';

/** US2: checkout, return, lost, renew, a reader's loan items and the desk scans. */
export function registerLoans(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.checkout, async (c, { body }) => ({
    status: 201,
    body: await proc.checkout(c, deps, body.readerId, body.copyIds),
  }));

  route(app, deps, endpoints.returnItem, async (c, { params, body }) => ({
    status: 200,
    body: {
      fines: await proc.returnItem(c, deps, params.loanItemId, body.condition, body.damagedFineVnd ?? null, body.reason ?? null),
    },
  }));

  route(app, deps, endpoints.declareLost, async (c, { params, body }) => ({
    status: 200,
    body: { fines: await proc.declareLost(c, deps, params.loanItemId, body.lostFineVnd ?? null, body.reason ?? null) },
  }));

  route(app, deps, endpoints.renew, async (c, { params }) => ({
    status: 200,
    body: await proc.renew(c, deps, params.loanItemId),
  }));

  route(app, deps, endpoints.readerLoanItems, async (c, { params, query }) => {
    const staff = isStaffFor(endpoints.readerLoanItems.access, c.var.caller);
    if (staff && !(await readerExists(deps.pool, params.readerId))) throw notFound('reader');
    return { status: 200, body: await listReaderLoanItems(deps.pool, params.readerId, c.var.dbNow, query, staff) };
  });

  route(app, deps, endpoints.copyByBarcode, async (_c, { params }) => {
    const copy = await copyByBarcode(deps.pool, params.barcode);
    if (!copy) throw notFound('copy');
    return { status: 200, body: copy };
  });

  route(app, deps, endpoints.cardByNumber, async (c, { params }) => {
    const card = await cardByNumber(deps.pool, params.cardNumber, c.var.dbNow);
    if (!card) throw notFound('card');
    return { status: 200, body: card };
  });
}
