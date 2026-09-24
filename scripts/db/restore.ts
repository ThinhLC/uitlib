/**
 * Restore a backup into a (new) schema, re-apply the app grants and run the invariant suite
 * (tasks T088). Usage: pnpm db:restore -- --file backups/<file>.sql [--into <schema>]
 * Default target: ${DB_NAME}_restore.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mainSchemaName } from '../../src/lib/db/config';
import { applyGrants } from './grants';
import { mysqlTool } from './mysql-cli';

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const target = opt('--into') ?? `${mainSchemaName()}_restore`;
const file = opt('--file') ?? readdirSync('backups').filter((f) => f.endsWith('.sql')).sort().map((f) => `backups/${f}`).pop();
if (!file) throw new Error('no backup found; run pnpm db:backup first or pass --file');
if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error(`invalid schema name ${target}`);

async function main() {
  mysqlTool('mysql', ['-e', `DROP DATABASE IF EXISTS \`${target}\`; CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`]);
  mysqlTool('mysql', [target], { input: readFileSync(file!, 'utf8') });
  console.log(`restored ${file} into ${target}`);
  await applyGrants(target);
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/db/check.ts', '--schema', target], { stdio: 'inherit' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
