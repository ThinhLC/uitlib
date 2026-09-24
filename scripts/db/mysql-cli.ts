/**
 * Run MySQL client tools (mysqldump, mysql) inside the `db` container as the owner.
 * The password is passed through the MYSQL_PWD environment variable, never on the command line.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { dbConfig } from '../../src/lib/db/config';

export function mysqlTool(tool: 'mysqldump' | 'mysql', args: string[], opts: SpawnSyncOptions = {}) {
  const owner = dbConfig('owner');
  const res = spawnSync(
    'docker',
    ['compose', '--env-file', '.env.local', 'exec', '-T', '-e', `MYSQL_PWD=${owner.password}`, 'db', tool,
      '-u', owner.user, ...args],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${tool} failed (${res.status}): ${res.stderr}`);
  return res.stdout as unknown as string;
}
