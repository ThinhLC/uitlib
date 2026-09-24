import mysql, { type Connection, type Pool } from 'mysql2/promise';
import { expect } from 'vitest';
import { dbConfig } from '../../src/lib/db/config';
import { callProcedure, DbRuleError, type CallOptions } from '../../src/lib/db/call-procedure';

const common = { timezone: 'Z', dateStrings: true, supportBigNumbers: true } as const;

/** New connection to the test schema as the restricted app account. */
export function appConn(): Promise<Connection> {
  return mysql.createConnection({ ...dbConfig('app', { test: true }), ...common });
}

/** New connection to the test schema as the owner (root). */
export function ownerConn(): Promise<Connection> {
  return mysql.createConnection({ ...dbConfig('owner', { test: true }), ...common });
}

let appPool: Pool | undefined;
/** Shared app-account pool for procedure calls (each call takes its own connection). */
export function testAppPool(): Pool {
  appPool ??= mysql.createPool({
    ...dbConfig('app', { test: true }),
    ...common,
    connectionLimit: 8,
  });
  return appPool;
}

export async function closeTestPools(): Promise<void> {
  await appPool?.end();
  appPool = undefined;
}

/** Call a procedure as the app account (contracts/db-routines.md). */
export function call(name: string, args: unknown[], opts?: CallOptions) {
  return callProcedure(testAppPool(), name, args, opts);
}

/**
 * Assert that a promise rejects with business rule `key`: a DbRuleError from callProcedure, or a
 * raw `SIGNAL SQLSTATE '45000' 'KEY: …'` from direct SQL (triggers).
 */
export async function expectRule(promise: Promise<unknown>, key: string): Promise<Error> {
  try {
    await promise;
  } catch (err: any) {
    const actual =
      err instanceof DbRuleError ? err.key
      : err?.sqlState === '45000' ? /^([A-Z_]+):/.exec(err.message)?.[1]
      : undefined;
    expect(actual, `expected rule ${key}, got ${err?.errno ?? ''} ${err?.message}`).toBe(key);
    return err;
  }
  throw new Error(`expected rule ${key}, but the statement succeeded`);
}

/** Assert that a promise rejects with MySQL errno (e.g. 1062, 1142, 1451, 1452, 3819). */
export async function expectErrno(promise: Promise<unknown>, errno: number): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    expect(err?.errno, `expected errno ${errno}, got ${err?.errno} ${err?.message}`).toBe(errno);
    return err;
  }
  throw new Error(`expected errno ${errno}, but the statement succeeded`);
}

/** Run a query on a short-lived owner connection and return the rows. */
export async function ownerQuery<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await ownerConn();
  try {
    const [rows] = await conn.query(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}
