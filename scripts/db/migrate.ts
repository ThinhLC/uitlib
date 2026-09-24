/**
 * Apply all migrations in ./drizzle as the owner, then the app account's grants.
 * Usage: pnpm db:migrate [--test | --schema <name>]
 */
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { dbConfig } from '../../src/lib/db/config';
import { applyGrants, schemaFromArgs } from './grants';

export async function migrateSchema(schema: string, log = console.log): Promise<void> {
  const conn = await mysql.createConnection({
    ...dbConfig('owner', { schema }),
    multipleStatements: false,
  });
  try {
    await migrate(drizzle({ client: conn }), { migrationsFolder: './drizzle' });
    const [rows] = (await conn.query(
      'SELECT COUNT(*) n FROM `__drizzle_migrations`',
    )) as any;
    log(`migrations applied on ${schema}: ${rows[0].n}`);
  } finally {
    await conn.end();
  }
  await applyGrants(schema, log);
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrateSchema(schemaFromArgs(process.argv.slice(2))).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
