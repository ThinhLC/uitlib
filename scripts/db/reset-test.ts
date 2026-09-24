/**
 * Drop and re-create the test schema (${DB_NAME}_test), then migrate it and apply grants.
 * Usage: pnpm db:reset-test
 */
import mysql from 'mysql2/promise';
import { dbConfig, testSchemaName } from '../../src/lib/db/config';
import { migrateSchema } from './migrate';

export async function resetTestSchema(log = console.log): Promise<void> {
  const schema = testSchemaName();
  const conn = await mysql.createConnection(dbConfig('owner', { schema: 'mysql' }));
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await conn.query(
      `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await conn.end();
  }
  await migrateSchema(schema, log);

  // Tests pass explicit times; a wall-clock event (hold expiry every 15 minutes) would race them.
  const owner = await mysql.createConnection(dbConfig('owner', { schema }));
  try {
    const [events] = await owner.query<mysql.RowDataPacket[]>(
      `SELECT EVENT_NAME name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?`, [schema]);
    for (const e of events) await owner.query(`ALTER EVENT \`${e.name}\` DISABLE`);
  } finally {
    await owner.end();
  }
}

if (process.argv[1]?.endsWith('reset-test.ts')) {
  resetTestSchema().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
