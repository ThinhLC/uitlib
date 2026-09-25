import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { ApiError } from '@/server/api/errors/api-error';
import {
  createReader,
  getCard,
  getReader,
  linkAccount,
  listCards,
  listReaders,
  materialTypes,
  readerTypes,
  unlinkAccount,
  updateReader,
} from '@/server/api/queries/people';
import { issueCard } from '@/server/api/services/procedures/people';

/** registerReaders (US4: readers, account link, reader cards, reference lists). */
export function registerReaders(app: Hono<AppEnv>, deps: ApiDeps): void {
  const { pool } = deps;

  route(app, deps, endpoints.listReaders, async (c, { query }) => ({
    status: 200,
    body: await listReaders(pool, c.var.dbNow, query),
  }));

  route(app, deps, endpoints.createReader, async (c, { body }) => ({
    status: 201,
    body: await createReader(pool, body, c.var.dbNow),
  }));

  route(app, deps, endpoints.getReader, async (c, { params }) => {
    const reader = await getReader(pool, params.readerId, c.var.dbNow);
    if (!reader) throw new ApiError('NOT_FOUND', 'reader');
    return { status: 200, body: reader };
  });

  route(app, deps, endpoints.updateReader, async (c, { params, body }) => ({
    status: 200,
    body: await updateReader(pool, params.readerId, body, c.var.dbNow),
  }));

  route(app, deps, endpoints.linkAccount, async (c, { params, body }) => ({
    status: 200,
    body: await linkAccount(pool, params.readerId, body.accountId, c.var.dbNow),
  }));

  route(app, deps, endpoints.unlinkAccount, async (c, { params }) => ({
    status: 200,
    body: await unlinkAccount(pool, params.readerId, c.var.dbNow),
  }));

  route(app, deps, endpoints.readerCards, async (c, { params }) => ({
    status: 200,
    body: await listCards(pool, params.readerId, c.var.dbNow),
  }));

  route(app, deps, endpoints.issueCard, async (c, { params, body }) => {
    const cardId = await issueCard(c, deps, params.readerId, body.cardNumber, body.expiresAt);
    return { status: 201, body: await getCard(pool, cardId, c.var.dbNow) };
  });

  route(app, deps, endpoints.readerTypes, async () => ({ status: 200, body: await readerTypes(pool) }));
  route(app, deps, endpoints.materialTypes, async () => ({ status: 200, body: await materialTypes(pool) }));
}
