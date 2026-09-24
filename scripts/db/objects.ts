/**
 * List the database objects of a schema and verify the 27 tables exist (spec FR-029).
 * Usage: pnpm db:objects [--test | --schema <name>]
 */
import mysql from 'mysql2/promise';
import { dbConfig } from '../../src/lib/db/config';
import { schemaFromArgs } from './grants';

export const EXPECTED_TABLES = [
  'app_users', 'authors', 'book_authors', 'book_categories', 'book_copies', 'book_external_refs',
  'book_identifiers', 'books', 'categories', 'fine_adjustments', 'fine_payment_allocations',
  'fine_payments', 'fines', 'library_cards', 'loan_items', 'loan_policies', 'loan_renewals', 'loans',
  'material_types', 'permissions', 'publishers', 'reader_types', 'readers', 'reservations',
  'role_permissions', 'roles', 'user_roles',
];

async function main() {
  const schema = schemaFromArgs(process.argv.slice(2));
  const conn = await mysql.createConnection(dbConfig('owner', { schema }));
  try {
    const list = async (sql: string) =>
      ((await conn.query(sql, [schema]))[0] as any[]).map((r) => r.name as string);
    const tables = await list(
      `SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> '__drizzle_migrations'
        ORDER BY 1`);
    const views = await list(`SELECT TABLE_NAME name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY 1`);
    const triggers = await list(`SELECT TRIGGER_NAME name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY 1`);
    const functions = await list(`SELECT ROUTINE_NAME name FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' ORDER BY 1`);
    const procedures = await list(`SELECT ROUTINE_NAME name FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY 1`);
    const events = await list(`SELECT EVENT_NAME name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY 1`);
    const show = (label: string, names: string[]) =>
      console.log(`${label} (${names.length}): ${names.join(', ') || '-'}`);
    console.log(`schema ${schema}`);
    show('tables', tables);
    show('views', views);
    show('triggers', triggers);
    show('functions', functions);
    show('procedures', procedures);
    show('events', events);
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length) {
      console.error(`missing tables: ${missing.join(', ')}`);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1]?.endsWith('objects.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
