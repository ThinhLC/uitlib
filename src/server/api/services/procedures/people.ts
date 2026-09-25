import type { Context } from 'hono';
import type { CreatePolicyInput } from '@/lib/api/contract';
import { DbRuleError } from '@/lib/db/call-procedure';
import { isoToDbTime } from '@/lib/time/db-time';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { ApiError } from '@/server/api/errors/api-error';
import { typeIdByCode } from '@/server/api/queries/people';
import { callAsCaller } from '@/server/api/services/call';

type Ctx = Context<AppEnv>;

/** sp_issue_card: a new active card; returns its id. */
export async function issueCard(
  c: Ctx,
  deps: ApiDeps,
  readerId: number,
  cardNumber: string,
  expiresAt: string,
): Promise<number> {
  const { out } = await callAsCaller<{ p_card_id: unknown }>(
    c,
    deps,
    'sp_issue_card',
    [readerId, cardNumber, isoToDbTime(expiresAt)],
    ['p_card_id'],
  );
  return Number(out.p_card_id);
}

/** sp_set_card_status: move an active card to expired, lost or revoked. */
export async function setCardStatus(c: Ctx, deps: ApiDeps, cardId: number, status: string): Promise<void> {
  await callAsCaller(c, deps, 'sp_set_card_status', [cardId, status]);
}

const TYPE_DETAIL: Record<string, string> = { 'reader type': 'readerType', 'material type': 'materialType' };

/**
 * sp_create_policy_version with the type codes resolved to ids. An unknown code is passed as
 * NULL so the procedure still checks `policy.manage` first; its NOT_FOUND is reported as
 * `readerType` / `materialType`.
 */
export async function createPolicyVersion(c: Ctx, deps: ApiDeps, input: CreatePolicyInput): Promise<number> {
  const readerTypeId = await typeIdByCode(deps.pool, 'readerType', input.readerType);
  const materialTypeId = await typeIdByCode(deps.pool, 'materialType', input.materialType);
  const result = await callAsCaller<{ p_policy_id: unknown }>(
    c,
    deps,
    'sp_create_policy_version',
    [
      readerTypeId,
      materialTypeId,
      input.maxActiveItems,
      input.loanDays,
      input.maxRenewals,
      input.dailyLateFeeVnd,
      input.debtBlockThresholdVnd,
      isoToDbTime(input.validFrom),
    ],
    ['p_policy_id'],
  ).catch((err: unknown) => {
    if (err instanceof DbRuleError && err.key === 'NOT_FOUND' && TYPE_DETAIL[err.detail]) {
      throw new ApiError('NOT_FOUND', TYPE_DETAIL[err.detail]);
    }
    throw err;
  });
  return Number(result.out.p_policy_id);
}

/** sp_close_policy_version: set `valid_to`. */
export async function closePolicyVersion(c: Ctx, deps: ApiDeps, policyId: number, validTo: string): Promise<void> {
  await callAsCaller(c, deps, 'sp_close_policy_version', [policyId, isoToDbTime(validTo)]);
}

/** sp_expire_cards: expire every active card past its expiry; returns how many. */
export async function expireCards(c: Ctx, deps: ApiDeps): Promise<number> {
  const { out } = await callAsCaller<{ p_count: unknown }>(c, deps, 'sp_expire_cards', [], ['p_count']);
  return Number(out.p_count);
}
