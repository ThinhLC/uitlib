import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import {
  createAuthor,
  createBook,
  createCategory,
  createPublisher,
  getBookAdmin,
  listAuthors,
  listPublishers,
  updateBook,
} from '@/server/api/queries/catalog-admin';

/** Catalog management (US3): books, authors, publishers, categories; direct writes, catalog.write. */
export function registerCatalog(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.createBook, async (c, { body }) => ({
    status: 201,
    body: await createBook(deps.pool, body, c.var.dbNow),
  }));

  route(app, deps, endpoints.getBook, async (_c, { params }) => ({
    status: 200,
    body: await getBookAdmin(deps.pool, params.bookId),
  }));

  route(app, deps, endpoints.updateBook, async (c, { params, body }) => ({
    status: 200,
    body: await updateBook(deps.pool, params.bookId, body, c.var.dbNow),
  }));

  route(app, deps, endpoints.listAuthors, async (_c, { query }) => ({
    status: 200,
    body: await listAuthors(deps.pool, query),
  }));

  route(app, deps, endpoints.createAuthor, async (_c, { body }) => ({
    status: 201,
    body: await createAuthor(deps.pool, body),
  }));

  route(app, deps, endpoints.listPublishers, async (_c, { query }) => ({
    status: 200,
    body: await listPublishers(deps.pool, query),
  }));

  route(app, deps, endpoints.createPublisher, async (_c, { body }) => ({
    status: 201,
    body: await createPublisher(deps.pool, body),
  }));

  route(app, deps, endpoints.createCategory, async (_c, { body }) => ({
    status: 201,
    body: await createCategory(deps.pool, body),
  }));
}
