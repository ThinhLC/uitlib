/**
 * Apply the app account's privileges to one schema (research R6). Idempotent.
 * Usage: pnpm db:grants [--test | --schema <name>]
 */
import mysql from 'mysql2/promise';
import { appUserName, dbConfig, mainSchemaName, testSchemaName } from '../../src/lib/db/config';
import { APP_WRITABLE_TABLES, isPublicRoutine } from '../../src/lib/db/grants';

export function schemaFromArgs(argv: string[]): string {
  const i = argv.indexOf('--schema');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return argv.includes('--test') ? testSchemaName() : mainSchemaName();
}

const q = (id: string) => `\`${id.replace(/`/g, '``')}\``;

export async function applyGrants(schema: string, log = console.log): Promise<void> {
  const user = appUserName();
  const conn = await mysql.createConnection(dbConfig('owner', { schema }));
  try {
    const [objects] = (await conn.query(
      `SELECT TABLE_NAME name, TABLE_TYPE type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [schema],
    )) as any;
    const [routines] = (await conn.query(
      `SELECT ROUTINE_NAME name, ROUTINE_TYPE type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?`,
      [schema],
    )) as any;

    // 1. Start from nothing on this schema (also removes the image's blanket ALL on DB_NAME).
    await conn.query(`REVOKE ALL PRIVILEGES ON ${q(schema)}.* FROM ?@'%'`, [user]).catch(() => {});
    for (const t of objects) {
      await conn.query(`REVOKE ALL PRIVILEGES ON ${q(schema)}.${q(t.name)} FROM ?@'%'`, [user]).catch(() => {});
    }
    for (const r of routines) {
      await conn
        .query(`REVOKE EXECUTE ON ${r.type} ${q(schema)}.${q(r.name)} FROM ?@'%'`, [user])
        .catch(() => {});
    }

    // 2. Read everything (tables and views).
    for (const t of objects) {
      await conn.query(`GRANT SELECT ON ${q(schema)}.${q(t.name)} TO ?@'%'`, [user]);
    }
    // 3. Direct writes only on catalog / people tables.
    const existing = new Set(objects.map((t: any) => t.name));
    const writable = APP_WRITABLE_TABLES.filter((t) => existing.has(t));
    for (const t of writable) {
      await conn.query(`GRANT INSERT, UPDATE, DELETE ON ${q(schema)}.${q(t)} TO ?@'%'`, [user]);
    }
    // 4. Execute public routines only.
    const publicRoutines = routines.filter((r: any) => isPublicRoutine(r.name));
    for (const r of publicRoutines) {
      await conn.query(`GRANT EXECUTE ON ${r.type} ${q(schema)}.${q(r.name)} TO ?@'%'`, [user]);
    }
    log(
      `grants on ${schema} for ${user}: SELECT on ${objects.length} objects, ` +
        `write on ${writable.length} tables, EXECUTE on ${publicRoutines.length} routines`,
    );
  } finally {
    await conn.end();
  }
}

if (process.argv[1]?.endsWith('grants.ts')) {
  applyGrants(schemaFromArgs(process.argv.slice(2))).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
