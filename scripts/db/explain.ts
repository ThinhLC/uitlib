/**
 * Save EXPLAIN FORMAT=TREE for the report views and the checkout eligibility queries
 * (tasks T087, constitution: key queries need an EXPLAIN). Usage: pnpm db:explain [--schema <name>]
 * Writes docs/report/explain/<name>.txt.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { dbConfig } from '../../src/lib/db/config';
import { schemaFromArgs } from './grants';

const QUERIES: Record<string, string> = {
  'report-overdue': 'SELECT * FROM v_report_overdue',
  'report-loans-by-month': 'SELECT * FROM v_report_loans_by_month',
  'report-popular-books': 'SELECT * FROM v_report_popular_books ORDER BY loan_items DESC LIMIT 10',
  'report-copy-status': 'SELECT * FROM v_report_copy_status',
  // The eligibility reads inside sp_checkout (reader id 1 as a representative value).
  'checkout-overdue-items': `SELECT COUNT(*) FROM loans l JOIN loan_items li ON li.loan_id = l.id
     WHERE l.reader_id = 1 AND li.status = 'on_loan' AND li.due_at < UTC_TIMESTAMP(3)`,
  'checkout-debt-assessed': `SELECT COALESCE(SUM(f.assessed_amount_vnd), 0)
     FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN fines f ON f.loan_item_id = li.id
     WHERE l.reader_id = 1`,
  'checkout-policy-in-effect': `SELECT id FROM loan_policies WHERE reader_type_id = 1 AND material_type_id = 1
     AND valid_from <= UTC_TIMESTAMP(3) AND (valid_to IS NULL OR valid_to > UTC_TIMESTAMP(3))`,
  'search-title-fulltext': `SELECT id, title FROM books WHERE MATCH(title, subtitle) AGAINST ('database' IN NATURAL LANGUAGE MODE)`,
};

async function main() {
  const conn = await mysql.createConnection(dbConfig('owner', { schema: schemaFromArgs(process.argv.slice(2)) }));
  mkdirSync('docs/report/explain', { recursive: true });
  try {
    for (const [name, sql] of Object.entries(QUERIES)) {
      const [rows] = (await conn.query(`EXPLAIN FORMAT=TREE ${sql}`)) as any;
      const plan = String(Object.values(rows[0])[0]);
      writeFileSync(`docs/report/explain/${name}.txt`, `-- ${sql.replace(/\s+/g, ' ')}\n\n${plan}\n`);
      // A scan of a materialized view result or a <temporary> table reads rows that were already
      // aggregated; only a scan of a base table means a missing index.
      const scans = [...plan.matchAll(/Table scan on (\w+)/g)]
        .map((m) => m[1])
        .filter((t) => !t.startsWith('v_'))
        .join(', ');
      console.log(`${name.padEnd(28)} ${scans ? `full scans: ${scans}` : 'index access only'}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
