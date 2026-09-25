import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import { fromDbTime, isoToDbTime } from '@/lib/time/db-time';
import { localMonthBounds } from '@/lib/time/local-month';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { copyStatus, health, loansByMonth, overdue, popularBooks } from '@/server/api/queries/reports';
import { reportCumulative, reportRollforward } from '@/server/api/services/procedures/reports';

/** registerReports (US7: reports, health). */
export function registerReports(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.reportCumulative, async (c, { query }) => {
    const asOf = query.asOf ? isoToDbTime(query.asOf) : c.var.dbNow;
    return {
      status: 200,
      body: { asOf: fromDbTime(asOf), rows: await reportCumulative(deps, asOf, query.readerId ?? null) },
    };
  });

  route(app, deps, endpoints.reportRollforward, async (_c, { query }) => {
    const [from, to] = localMonthBounds(query.month);
    return {
      status: 200,
      body: {
        month: query.month,
        from: fromDbTime(from),
        to: fromDbTime(to),
        rows: await reportRollforward(deps, from, to, query.readerId ?? null),
      },
    };
  });

  route(app, deps, endpoints.reportOverdue, async (_c, { query }) => ({ status: 200, body: await overdue(deps.pool, query) }));

  route(app, deps, endpoints.reportLoansByMonth, async (_c, { query }) => ({
    status: 200,
    body: await loansByMonth(deps.pool, query),
  }));

  route(app, deps, endpoints.reportPopularBooks, async (_c, { query }) => ({
    status: 200,
    body: await popularBooks(deps.pool, query.limit),
  }));

  route(app, deps, endpoints.reportCopyStatus, async (_c, { query }) => ({ status: 200, body: await copyStatus(deps.pool, query) }));

  route(app, deps, endpoints.adminHealth, async () => ({ status: 200, body: await health(deps.pool) }));
}
