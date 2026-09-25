import type { Connection, Pool, RowDataPacket } from 'mysql2/promise';

export interface Violation {
  view: string;
  rows: Record<string, unknown>[];
}

type Queryable = Pick<Connection, 'query'> | Pick<Pool, 'query'>;

/** Names of the invariant views (spec 001 I-1…I-9) in the connection's schema. */
export async function listInvariantViews(conn: Queryable): Promise<string[]> {
  const [views] = (await conn.query(
    `SELECT TABLE_NAME name FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'v\\_inv\\_%' ORDER BY TABLE_NAME`,
  )) as [RowDataPacket[], unknown];
  return views.map((v) => String(v.name));
}

/** Query every invariant view in the connection's schema; returns only views with rows. */
export async function findViolations(conn: Queryable): Promise<Violation[]> {
  const out: Violation[] = [];
  for (const name of await listInvariantViews(conn)) {
    const [rows] = (await conn.query(`SELECT * FROM \`${name}\` LIMIT 20`)) as [RowDataPacket[], unknown];
    if (rows.length) out.push({ view: name, rows });
  }
  return out;
}
