/**
 * Invariant suite (spec I-1…I-9): every v_inv_* view must return zero rows.
 * Usage: pnpm db:check [--test | --schema <name>]
 */
import mysql from 'mysql2/promise';
import { findViolations } from '../../src/lib/db/invariants';
import { dbConfig } from '../../src/lib/db/config';
import { schemaFromArgs } from './grants';

export { findViolations, type Violation } from '../../src/lib/db/invariants';

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
