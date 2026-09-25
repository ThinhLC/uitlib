import type { Hono } from 'hono';
import { endpoints } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { getPublicBook, listCategories, searchCatalog } from '@/server/api/queries/catalog-search';

/** Public catalog (US3, Clarification A1): search and view active books, no token. */
export function registerPublicCatalog(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.searchCatalog, async (_c, { query }) => ({
    status: 200,
    body: await searchCatalog(deps.pool, query),
  }));

  route(app, deps, endpoints.getCatalogBook, async (_c, { params }) => ({
    status: 200,
    body: await getPublicBook(deps.pool, params.bookId),
  }));

  route(app, deps, endpoints.listCategories, async () => ({
    status: 200,
    body: { items: await listCategories(deps.pool) },
  }));
}
