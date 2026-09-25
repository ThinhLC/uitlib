import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { notFound } from '@/server/api/errors/api-error';
import { getReservation, listReaderReservations, listReservations, readerExists } from '@/server/api/queries/reservations';
import { cancelReservation, expireHolds, reserve } from '@/server/api/services/procedures/reservations';

/** registerReservations (US6: reservations, expire-holds job). */
export function registerReservations(app: Hono<AppEnv>, deps: ApiDeps): void {
  const load = async (id: number) => {
    const r = await getReservation(deps.pool, id);
    if (!r) throw notFound('reservation');
    return r;
  };

  route(app, deps, endpoints.reserve, async (c, { body }) => {
    const id = await reserve(c, deps, body.readerId, body.bookId);
    return { status: 201, body: await load(id) };
  });

  route(app, deps, endpoints.cancelReservation, async (c, { params, body }) => {
    await cancelReservation(c, deps, params.reservationId, body.reason ?? null);
    return { status: 200, body: await load(params.reservationId) };
  });

  route(app, deps, endpoints.readerReservations, async (_c, { params, query }) => {
    if (!(await readerExists(deps.pool, params.readerId))) throw notFound('reader');
    return { status: 200, body: await listReaderReservations(deps.pool, params.readerId, query) };
  });

  route(app, deps, endpoints.listReservations, async (_c, { query }) => ({
    status: 200,
    body: await listReservations(deps.pool, query),
  }));

  route(app, deps, endpoints.expireHolds, async (c) => ({
    status: 200,
    body: { count: await expireHolds(c, deps) },
  }));
}
