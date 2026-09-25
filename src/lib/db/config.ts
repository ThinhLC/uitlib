import { config as loadEnv } from 'dotenv';

// Connection settings come only from the environment (spec FR-030). Variables already set in the
// process win over .env.local, so CI or a shell can override any value. A module of its own so
// importers can load it before src/env.ts validates; src/env.ts itself cannot, it runs in the
// browser too.
loadEnv({ path: '.env.local', quiet: true });

import { env } from '@/env';

export type DbRole = 'owner' | 'app';

export interface DbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** The main schema name, from DB_NAME. */
export const mainSchemaName = () => env.DB_NAME;

/** The test schema is always derived from DB_NAME; no other file builds this name. */
export const testSchemaName = () => `${mainSchemaName()}_test`;

/** The application account name, from DB_USER. */
export function appUserName(): string {
  return env.DB_USER;
}

/**
 * Connection settings for the owner (MySQL root: migrations, grants, resets, dumps) or the
 * restricted application account.
 */
export function dbConfig(
  role: DbRole,
  opts: { test?: boolean; schema?: string } = {},
): DbConnectionConfig {
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: role === 'owner' ? 'root' : env.DB_USER,
    password: role === 'owner' ? env.MYSQL_ROOT_PASSWORD : env.DB_PASSWORD,
    database: opts.schema ?? (opts.test ? testSchemaName() : mainSchemaName()),
  };
}
