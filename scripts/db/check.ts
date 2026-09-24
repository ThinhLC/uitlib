/**
 * Invariant suite (spec I-1…I-9): every v_inv_* view must return zero rows.
 * Usage: pnpm db:check [--test | --schema <name>]
 */
import mysql, { type Connection } from 'mysql2/promise';
import { dbConfig } from '../../src/lib/db/config';
import { schemaFromArgs } from './grants';

export interface Violation {
  view: string;
  rows: Record<string, unknown>[];
}

/** Query every invariant view in the connection's schema; returns only views with rows. */
export async function findViolations(conn: Connection): Promise<Violation[]> {
  const [views] = (await conn.query(
    `SELECT TABLE_NAME name FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'v\\_inv\\_%' ORDER BY TABLE_NAME`,
  )) as any;
  const out: Violation[] = [];
  for (const v of views) {
    const [rows] = (await conn.query(`SELECT * FROM \`${v.name}\` LIMIT 20`)) as any;
    if (rows.length) out.push({ view: v.name, rows });
  }
  return out;
}

async function main() {
  const schema = schemaFromArgs(process.argv.slice(2));
  const conn = await mysql.createConnection({ ...dbConfig('app', { schema }), dateStrings: true });
  try {
    const [views] = (await conn.query(
      `SELECT COUNT(*) n FROM information_schema.VIEWS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'v\\_inv\\_%'`,
    )) as any;
    const violations = await findViolations(conn);
    console.log(`${schema}: ${views[0].n} invariant views, ${violations.length} with violations`);
    for (const v of violations) console.log(`  ${v.view}:`, v.rows);
    process.exit(violations.length ? 1 : 0);
  } finally {
    await conn.end();
  }
}

if (process.argv[1]?.endsWith('check.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
