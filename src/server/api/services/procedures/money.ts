import type { Context } from 'hono';
import type { AdjustmentResult, PaymentInput, PaymentResult } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { callAsCaller } from '@/server/api/services/call';

type Ctx = Context<AppEnv>;

/** sp_record_payment: idempotent by request key; `replayed` when the key was already used. */
export async function recordPayment(c: Ctx, deps: ApiDeps, input: PaymentInput): Promise<PaymentResult> {
  const allocations = JSON.stringify(input.allocations.map((a) => ({ fine_id: a.fineId, amount_vnd: a.amountVnd })));
  const { out } = await callAsCaller<{ p_payment_id: unknown; p_replayed: unknown }>(
    c,
    deps,
    'sp_record_payment',
    [input.readerId, input.amountVnd, input.method, input.referenceNo ?? null, input.requestKey, allocations],
    ['p_payment_id', 'p_replayed'],
  );
  return { paymentId: Number(out.p_payment_id), replayed: Boolean(Number(out.p_replayed)) };
}

/** sp_adjust_fine: a signed, audited correction; returns the adjustment id. */
export async function adjustFine(
  c: Ctx,
  deps: ApiDeps,
  fineId: number,
  amountVnd: number,
  reason: string,
): Promise<AdjustmentResult> {
  const { out } = await callAsCaller<{ p_adjustment_id: unknown }>(
    c,
    deps,
    'sp_adjust_fine',
    [fineId, amountVnd, reason],
    ['p_adjustment_id'],
  );
  return { adjustmentId: Number(out.p_adjustment_id) };
}
