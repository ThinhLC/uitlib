/**
 * Export the full DDL (tables, triggers, routines, events, views) for the report (tasks T086).
 * Usage: pnpm db:ddl [--schema <name>]   → docs/report/ddl.sql
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { schemaFromArgs } from './grants';
import { mysqlTool } from './mysql-cli';

const schema = schemaFromArgs(process.argv.slice(2));
const ddl = mysqlTool('mysqldump', [
  '--no-data', '--routines', '--triggers', '--events', '--skip-comments', '--skip-dump-date',
  '--ignore-table', `${schema}.__drizzle_migrations`, schema,
]);
mkdirSync('docs/report', { recursive: true });
// AUTO_INCREMENT counters depend on data, not on the design; drop them so the export is stable.
writeFileSync('docs/report/ddl.sql', ddl.replace(/ AUTO_INCREMENT=\d+/g, ''));
console.log(`wrote docs/report/ddl.sql (${ddl.split('\n').length} lines)`);
