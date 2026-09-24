/**
 * Generate the crow's-foot relational diagram (Mermaid erDiagram) from the live schema, so the
 * diagram always matches the migrations (spec FR-024, US6-4, SC-001). Output is deterministic.
 * Usage: pnpm erd:relational [--test | --schema <name>] [--out docs/erd/relational.mmd] [--stdout]
 */
import { writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { dbConfig } from '../../src/lib/db/config';
import { schemaFromArgs } from '../db/grants';

interface Column { table: string; name: string; type: string; nullable: boolean; generated: boolean }
interface Fk { name: string; child: string; parent: string; childCols: string[]; parentCols: string[] }

export async function relationalDiagram(schema: string): Promise<string> {
  const conn = await mysql.createConnection(dbConfig('owner', { schema }));
  try {
    const [tablesRows] = (await conn.query(
      `SELECT TABLE_NAME t FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> '__drizzle_migrations'
        ORDER BY TABLE_NAME`, [schema])) as any;
    const tables: string[] = tablesRows.map((r: any) => r.t);
    const [colRows] = (await conn.query(
      `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, IS_NULLABLE n, EXTRA e
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [schema])) as any;
    const columns: Column[] = colRows
      .filter((r: any) => tables.includes(r.t))
      .map((r: any) => ({ table: r.t, name: r.c, type: r.d, nullable: r.n === 'YES',
        generated: /GENERATED/i.test(r.e) }));
    const [keyRows] = (await conn.query(
      `SELECT tc.TABLE_NAME t, tc.CONSTRAINT_NAME k, tc.CONSTRAINT_TYPE ty, kcu.COLUMN_NAME c,
              kcu.ORDINAL_POSITION pos, kcu.REFERENCED_TABLE_NAME rt, kcu.REFERENCED_COLUMN_NAME rc
         FROM information_schema.TABLE_CONSTRAINTS tc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME
          AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE tc.TABLE_SCHEMA = ? AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
        ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, [schema])) as any;

    const pk = new Map<string, Set<string>>();
    const uniques = new Map<string, string[][]>();
    const fkCols = new Map<string, Set<string>>();
    const fks = new Map<string, Fk>();
    for (const r of keyRows) {
      if (!tables.includes(r.t)) continue;
      if (r.ty === 'PRIMARY KEY') (pk.get(r.t) ?? pk.set(r.t, new Set()).get(r.t)!).add(r.c);
      if (r.ty === 'UNIQUE') {
        const list = uniques.get(r.t) ?? uniques.set(r.t, []).get(r.t)!;
        const key = `${r.t}.${r.k}`;
        let entry = list.find((x: any) => x.key === key) as any;
        if (!entry) list.push((entry = Object.assign([], { key })));
        entry.push(r.c);
      }
      if (r.ty === 'FOREIGN KEY') {
        (fkCols.get(r.t) ?? fkCols.set(r.t, new Set()).get(r.t)!).add(r.c);
        const fk: Fk = fks.get(`${r.t}.${r.k}`) ?? { name: r.k, child: r.t, parent: r.rt, childCols: [], parentCols: [] };
        fk.childCols.push(r.c);
        fk.parentCols.push(r.rc);
        fks.set(`${r.t}.${r.k}`, fk);
      }
    }

    const lines = ['erDiagram'];
    for (const t of tables) {
      lines.push(`  ${t} {`);
      for (const c of columns.filter((x) => x.table === t)) {
        const keys = [
          pk.get(t)?.has(c.name) ? 'PK' : '',
          fkCols.get(t)?.has(c.name) ? 'FK' : '',
          // UK only for single-column unique keys; composite keys are listed in the data dictionary.
          (uniques.get(t) ?? []).some((u) => u.length === 1 && u[0] === c.name) && !pk.get(t)?.has(c.name) ? 'UK' : '',
        ].filter(Boolean).join(', ');
        const notes = [c.nullable ? 'nullable' : '', c.generated ? 'generated' : ''].filter(Boolean).join(', ');
        lines.push(`    ${c.type} ${c.name}${keys ? ` ${keys}` : ''}${notes ? ` "${notes}"` : ''}`);
      }
      lines.push('  }');
    }
    const sortedFks = [...fks.values()].sort((a, b) =>
      a.child.localeCompare(b.child) || a.name.localeCompare(b.name));
    for (const fk of sortedFks) {
      const childNullable = fk.childCols.some((c) => columns.find((x) => x.table === fk.child && x.name === c)?.nullable);
      const parentSide = childNullable ? '|o' : '||';
      const childUnique =
        (uniques.get(fk.child) ?? []).some((u) => u.length === fk.childCols.length && fk.childCols.every((c) => u.includes(c)))
        || (pk.get(fk.child)?.size === fk.childCols.length && fk.childCols.every((c) => pk.get(fk.child)!.has(c)));
      const childSide = childUnique ? 'o|' : 'o{';
      lines.push(`  ${fk.parent} ${parentSide}--${childSide} ${fk.child} : "${fk.childCols.join(', ')}"`);
    }
    return lines.join('\n') + '\n';
  } finally {
    await conn.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : 'docs/erd/relational.mmd';
  const text = await relationalDiagram(schemaFromArgs(args));
  if (args.includes('--stdout')) process.stdout.write(text);
  else {
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}

if (process.argv[1]?.endsWith('relational.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
