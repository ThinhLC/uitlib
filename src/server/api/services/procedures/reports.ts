import type { CumulativeRow, RollforwardRow } from '@/lib/api/contract';
import { callProcedure } from '@/lib/db/call-procedure';
import type { ApiDeps } from '@/server/api/context';
import { firstSet } from '@/server/api/services/call';

/**
 * The report procedures take no actor and no `p_now` (they only read), so they are called
 * directly; the route checks `report.read` first.
 */

/** sp_report_cumulative: debt per reader for records at or before `asOf` (DB time text). */
export async function reportCumulative(deps: ApiDeps, asOf: string, readerId: number | null): Promise<CumulativeRow[]> {
  const rows = firstSet(await callProcedure(deps.pool, 'sp_report_cumulative', [asOf, readerId]));
  return rows.map((r) => ({
    readerId: Number(r.reader_id),
    netAssessedVnd: Number(r.net_assessed),
    collectedVnd: Number(r.collected),
    outstandingVnd: Number(r.outstanding),
  }));
}

/** sp_report_rollforward: debt movement per reader over `[from, to)` (DB time text). */
export async function reportRollforward(
  deps: ApiDeps,
  from: string,
  to: string,
  readerId: number | null,
): Promise<RollforwardRow[]> {
  const rows = firstSet(await callProcedure(deps.pool, 'sp_report_rollforward', [from, to, readerId]));
  return rows.map((r) => ({
    readerId: Number(r.reader_id),
    openingOutstandingVnd: Number(r.opening_outstanding),
    assessedInPeriodVnd: Number(r.assessed_in_period),
    adjustedInPeriodVnd: Number(r.adjusted_in_period),
    collectedInPeriodVnd: Number(r.collected_in_period),
    closingOutstandingVnd: Number(r.closing_outstanding),
  }));
}
