import { config as loadEnv } from 'dotenv';

// Connection settings come only from the environment (spec FR-030). Variables already set in the
// process win over .env.local, so CI or a shell can override any value.
loadEnv({ path: '.env.local', quiet: true });

export type DbRole = 'owner' | 'app';

export interface DbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing env var ${name} (see .env.example)`);
  }
  return value;
}

/** The main schema name, from DB_NAME. */
export function mainSchemaName(): string {
  return requireEnv('DB_NAME');
}

/** The test schema is always derived from DB_NAME; no other file builds this name. */
export function testSchemaName(): string {
  return `${mainSchemaName()}_test`;
}

/** The application account name, from DB_USER. */
export function appUserName(): string {
  return requireEnv('DB_USER');
}

/**
 * Connection settings for the owner (MySQL root: migrations, grants, resets, dumps) or the
 * restricted application account.
 */
export function dbConfig(
  role: DbRole,
  opts: { test?: boolean; schema?: string } = {},
): DbConnectionConfig {
  const port = Number(requireEnv('DB_PORT'));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid env var DB_PORT: ${process.env.DB_PORT}`);
  }
  const database = opts.schema ?? (opts.test ? testSchemaName() : mainSchemaName());
  return {
    host: requireEnv('DB_HOST'),
    port,
    user: role === 'owner' ? 'root' : appUserName(),
    password: role === 'owner' ? requireEnv('MYSQL_ROOT_PASSWORD') : requireEnv('DB_PASSWORD'),
    database,
  };
}
