import type { Context } from 'hono';
import type { RowDataPacket } from 'mysql2/promise';
import type { CheckoutResult, CopyCondition, FineRef, FineType, RenewResult } from '@/lib/api/contract';
import { fromDbTime } from '@/lib/time/db-time';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { callAsCaller, firstSet } from '@/server/api/services/call';

type Ctx = Context<AppEnv>;

const toFines = (rows: RowDataPacket[]): FineRef[] =>
  rows.map((r) => ({ id: Number(r.fine_id), type: r.fine_type as FineType, amountVnd: Number(r.assessed_amount_vnd) }));

/** sp_checkout: lend the copies to the reader in one loan. */
export async function checkout(c: Ctx, deps: ApiDeps, readerId: number, copyIds: number[]): Promise<CheckoutResult> {
  const rows = firstSet(await callAsCaller(c, deps, 'sp_checkout', [readerId, JSON.stringify(copyIds)]));
  return {
    loanId: Number(rows[0]?.loan_id),
    items: rows.map((r) => ({ loanItemId: Number(r.loan_item_id), copyId: Number(r.copy_id), dueAt: fromDbTime(String(r.due_at)) })),
  };
}

/** sp_return_item: receive the copy; returns the fines assessed. */
export async function returnItem(
  c: Ctx,
  deps: ApiDeps,
  loanItemId: number,
  condition: CopyCondition,
  damagedFineVnd: number | null,
  reason: string | null,
): Promise<FineRef[]> {
  return toFines(firstSet(await callAsCaller(c, deps, 'sp_return_item', [loanItemId, condition, damagedFineVnd, reason])));
}

/** sp_declare_lost: late fine to now plus the lost fine. */
export async function declareLost(
  c: Ctx,
  deps: ApiDeps,
  loanItemId: number,
  lostFineVnd: number | null,
  reason: string | null,
): Promise<FineRef[]> {
  return toFines(firstSet(await callAsCaller(c, deps, 'sp_declare_lost', [loanItemId, lostFineVnd, reason])));
}

/** sp_renew: extend the due time by the applied loan days. */
export async function renew(c: Ctx, deps: ApiDeps, loanItemId: number): Promise<RenewResult> {
  const { out } = await callAsCaller<{ p_new_due_at: string }>(c, deps, 'sp_renew', [loanItemId], ['p_new_due_at']);
  return { loanItemId, newDueAt: fromDbTime(String(out.p_new_due_at)) };
}
