import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { dbConfig } from './config';

// Application pool: restricted account from DB_USER / DB_PASSWORD (spec FR-026, FR-030).
export const pool = mysql.createPool({
  ...dbConfig('app'),
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

// Every pooled session waits at most 5 s for a row lock (spec Concurrency Protocol).
pool.pool.on('connection', (conn) => {
  conn.query('SET SESSION innodb_lock_wait_timeout = 5');
});

export const db = drizzle({ client: pool });
