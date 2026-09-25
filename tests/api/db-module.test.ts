import { describe, expect, it } from 'vitest';

describe('src/lib/db module (production pool used by the API route)', () => {
  it('imports without throwing and exposes the pool and drizzle db', async () => {
    const m = await import('@/lib/db');
    expect(typeof m.pool.getConnection).toBe('function');
    expect(typeof m.db.select).toBe('function');
    await m.pool.end();
  });

  it('the production deps and the app build without a request', async () => {
    const { productionDeps } = await import('@/server/api/deps');
    const { createApp } = await import('@/server/api/app');
    const deps = productionDeps();
    const app = createApp(deps);
    const res = await app.request('/api/v1/health');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
