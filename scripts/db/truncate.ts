import type { Connection, RowDataPacket } from 'mysql2/promise';

/** Reference tables filled by migrations; never truncated by tests or `seed --reset`. */
export const REFERENCE_TABLES = new Set([
  '__drizzle_migrations',
  'material_types',
  'reader_types',
  'roles',
  'permissions',
  'role_permissions',
]);

/** Base tables of the connection's schema that hold non-reference data. */
export async function dataTables(conn: Connection): Promise<string[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT TABLE_NAME name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
  );
  return rows.map((r) => String(r.name)).filter((t) => !REFERENCE_TABLES.has(t));
}

/** Empty every non-reference table (owner connection). TRUNCATE does not fire DELETE triggers. */
export async function truncateData(conn: Connection): Promise<void> {
  const tables = await dataTables(conn);
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t}\``);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}
