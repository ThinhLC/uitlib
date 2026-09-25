/**
 * Debt report per library-local month (spec FR-018, SC-006, tasks T085).
 * Prints the roll-forward per reader and in total, and checks both identities:
 *   cumulative: net_assessed = collected + outstanding
 *   period:     closing = opening + assessed + adjusted − collected
 * Usage: pnpm db:report -- --month 2026-09 --month 2026-10 [--test | --schema <name>]
 */
import mysql from 'mysql2/promise';
import { dbConfig } from '../../src/lib/db/config';
import { schemaFromArgs } from './grants';
import { localMonthBounds } from '../../src/lib/time/local-month';

export { localMonthBounds };

const num = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as Record<string, number>;

async function main() {
  const args = process.argv.slice(2);
  const months = args.flatMap((a, i) => (a === '--month' ? [args[i + 1]] : []));
  if (!months.length) throw new Error('give at least one --month YYYY-MM');
  const conn = await mysql.createConnection({ ...dbConfig('app', { schema: schemaFromArgs(args) }), dateStrings: true });
  let failures = 0;
  try {
    for (const month of months) {
      const [from, to] = localMonthBounds(month);
      const [[period]] = (await conn.query('CALL sp_report_rollforward(?, ?, NULL)', [from, to])) as any;
      const [[cumulative]] = (await conn.query('CALL sp_report_cumulative(?, NULL)', [
        new Date(new Date(to.replace(' ', 'T') + 'Z').getTime() - 1).toISOString().replace('T', ' ').replace('Z', ''),
      ])) as any;
      const rows = (period as any[]).map(num);
      const total = rows.reduce((acc, r) => {
        for (const k of Object.keys(r)) if (k !== 'reader_id') acc[k] = (acc[k] ?? 0) + r[k];
        return acc;
      }, {} as Record<string, number>);
      console.log(`\n${month} (local)  [${from}, ${to}) UTC`);
      console.table([...rows, { reader_id: 'TOTAL', ...total }]);
      for (const r of rows) {
        const expected = r.opening_outstanding + r.assessed_in_period + r.adjusted_in_period - r.collected_in_period;
        if (expected !== r.closing_outstanding) {
          failures++;
          console.error(`roll-forward mismatch for reader ${r.reader_id}: expected ${expected}, got ${r.closing_outstanding}`);
        }
      }
      for (const c of (cumulative as any[]).map(num)) {
        if (c.net_assessed !== c.collected + c.outstanding) {
          failures++;
          console.error(`cumulative identity fails for reader ${c.reader_id}`);
        }
      }
    }
  } finally {
    await conn.end();
  }
  if (failures) process.exit(1);
  console.log('\nSC-006: cumulative identity and roll-forward hold for every reader.');
}

if (process.argv[1]?.endsWith('report.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
