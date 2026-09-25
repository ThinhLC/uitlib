import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Page, PageQuery } from '@/lib/api/contract';
import { withRetry } from '@/lib/db/with-retry';

/** Plain read returning rows. */
export async function rows(pool: Pool | PoolConnection, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [r] = await pool.query<RowDataPacket[]>(sql, params);
  return r;
}

/** Plain read returning the first row or null. */
export async function one(pool: Pool | PoolConnection, sql: string, params: unknown[] = []): Promise<RowDataPacket | null> {
  return (await rows(pool, sql, params))[0] ?? null;
}

/**
 * A page of `SELECT … FROM …` (without LIMIT): runs the count query and the page query with the
 * same params (FR-016).
 */
export async function paged<T>(
  pool: Pool,
  opts: { select: string; count: string; params: unknown[]; page: PageQuery; map: (row: RowDataPacket) => T },
): Promise<Page<T>> {
  const { page, pageSize } = opts.page;
  const [total] = await rows(pool, opts.count, opts.params);
  const items = await rows(pool, `${opts.select} LIMIT ? OFFSET ?`, [...opts.params, pageSize, (page - 1) * pageSize]);
  return { items: items.map(opts.map), page, pageSize, total: Number(total ? Object.values(total)[0] : 0) };
}

/**
 * Run `fn` in one transaction on its own connection, retrying deadlock / lock wait (FR-024).
 * Used for multi-row direct writes (catalog, readers, accounts); never for procedure-only tables.
 */
export async function transaction<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  return withRetry(async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      try {
        const out = await fn(conn);
        await conn.commit();
        return out;
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    } finally {
      conn.release();
    }
  });
}
