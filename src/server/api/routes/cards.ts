import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { getCard } from '@/server/api/queries/people';
import { expireCards, setCardStatus } from '@/server/api/services/procedures/people';

/** registerCards (US4: card status, expire-cards job). */
export function registerCards(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.setCardStatus, async (c, { params, body }) => {
    await setCardStatus(c, deps, params.cardId, body.status);
    return { status: 200, body: await getCard(deps.pool, params.cardId, c.var.dbNow) };
  });

  route(app, deps, endpoints.expireCards, async (c) => ({
    status: 200,
    body: { count: await expireCards(c, deps) },
  }));
}
