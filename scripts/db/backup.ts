/**
 * Consistent backup of the main schema (tasks T088). Usage: pnpm db:backup [--schema <name>]
 * Writes backups/<schema>-<timestamp>.sql (git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { schemaFromArgs } from './grants';
import { mysqlTool } from './mysql-cli';

const schema = schemaFromArgs(process.argv.slice(2));
const dump = mysqlTool('mysqldump', [
  '--single-transaction', '--routines', '--triggers', '--events', '--set-gtid-purged=OFF', schema,
]);
mkdirSync('backups', { recursive: true });
const file = `backups/${schema}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
writeFileSync(file, dump);
console.log(`wrote ${file} (${(dump.length / 1024).toFixed(0)} KiB)`);
