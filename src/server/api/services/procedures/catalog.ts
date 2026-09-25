import type { Context } from 'hono';
import type { ChangeCopyStatusInput, RegisterCopyInput } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { callAsCaller } from '@/server/api/services/call';

/** sp_register_copy: returns the new copy id (the copy may already be `on_hold`). */
export async function registerCopy(
  c: Context<AppEnv>,
  deps: ApiDeps,
  bookId: number,
  input: RegisterCopyInput,
): Promise<number> {
  const { out } = await callAsCaller<{ p_copy_id: number | string }>(
    c,
    deps,
    'sp_register_copy',
    [bookId, input.barcode, input.shelfCode ?? null, input.acquiredAt ?? null, input.condition],
    ['p_copy_id'],
  );
  return Number(out.p_copy_id);
}

/** sp_change_copy_status: a maintenance status (available, in_repair, retired) and condition. */
export async function changeCopyStatus(
  c: Context<AppEnv>,
  deps: ApiDeps,
  copyId: number,
  input: ChangeCopyStatusInput,
): Promise<void> {
  await callAsCaller(c, deps, 'sp_change_copy_status', [copyId, input.targetStatus, input.condition]);
}
