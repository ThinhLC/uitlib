import type { Context } from 'hono';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { callAsCaller } from '@/server/api/services/call';

type Ctx = Context<AppEnv>;

/** sp_reserve: a waiting reservation; returns its id. */
export async function reserve(c: Ctx, deps: ApiDeps, readerId: number, bookId: number): Promise<number> {
  const { out } = await callAsCaller<{ p_reservation_id: unknown }>(c, deps, 'sp_reserve', [readerId, bookId], ['p_reservation_id']);
  return Number(out.p_reservation_id);
}

/** sp_cancel_reservation: a ready hold passes its copy to the next reader. */
export async function cancelReservation(c: Ctx, deps: ApiDeps, reservationId: number, reason: string | null): Promise<void> {
  await callAsCaller(c, deps, 'sp_cancel_reservation', [reservationId, reason]);
}

/** sp_expire_holds: expire holds past `hold_expires_at`; returns how many. */
export async function expireHolds(c: Ctx, deps: ApiDeps): Promise<number> {
  const { out } = await callAsCaller<{ p_count: unknown }>(c, deps, 'sp_expire_holds', [], ['p_count']);
  return Number(out.p_count);
}
