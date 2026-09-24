import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testSchemaName } from '../../src/lib/db/config';
import { parsePredicates } from '../../scripts/db/dictionary';
import { embedInArchitecture, relationalDiagram } from '../../scripts/erd/relational';
import { parseChen } from '../../scripts/erd/chen-views';
import { ownerQuery } from '../helpers/db';

const tableNames = async () =>
  (await ownerQuery<{ t: string }>(
    `SELECT TABLE_NAME t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> '__drizzle_migrations'`))
    .map((r) => r.t).sort();

describe('US6 ERD and data dictionary stay in sync with the schema (T071)', () => {
  it('US6-4 SC-001: the committed relational diagram equals the one generated from the migrated schema', async () => {
    const generated = await relationalDiagram(testSchemaName());
    expect(generated).toBe(readFileSync('docs/erd/relational.mmd', 'utf8'));
  });

  it('US6-4: the relational ERD in ARCHITECTURE.md equals the one generated from the migrated schema', async () => {
    const doc = readFileSync('ARCHITECTURE.md', 'utf8');
    expect(embedInArchitecture(doc, await relationalDiagram(testSchemaName()))).toBe(doc);
  });

  it('US6-3: every relation in mapping.md exists, and every table is mapped', async () => {
    const mapping = readFileSync('docs/erd/mapping.md', 'utf8');
    const tables = await tableNames();
    // The relation column differs per section: Entities → 2nd, Relationships → 3rd, Technical → 1st.
    const relationColumn: Record<string, number> = { Entities: 2, 'Relationships and multi-valued attributes': 3,
      'Technical additions (not ERD elements)': 1 };
    const named = new Set<string>();
    for (const section of mapping.split('\n## ').slice(1)) {
      const [title, ...lines] = section.split('\n');
      const col = relationColumn[title.trim()];
      expect(col, `unexpected section ${title}`).toBeDefined();
      for (const row of lines.filter((l) => l.startsWith('|') && !l.startsWith('| ---')).slice(1)) {
        for (const m of (row.split('|')[col] ?? '').matchAll(/`([a-z_]+)`/g)) named.add(m[1]);
      }
    }
    named.delete('__drizzle_migrations');
    for (const n of named) expect(tables, `mapping names unknown relation ${n}`).toContain(n);
    for (const t of tables) expect(mapping, `table ${t} is not in mapping.md`).toContain(`\`${t}\``);
  });

  it('US6-1: every entity of data-model.md "Conceptual model" is in the Chen ERD', () => {
    const dataModel = readFileSync('specs/001-library-db-design/data-model.md', 'utf8');
    const section = dataModel.split('## Conceptual model')[1].split('Relationship types')[0];
    const entities = [...section.matchAll(/^\| ([A-Z][A-Z /]+?)(?: \[Ext\])?(?: \([^)]*\))? \|/gm)]
      .flatMap((m) => m[1].split('/').map((s) => s.trim().replace(/ /g, '_')))
      .filter((e) => e !== 'Entity');
    const chen = parseChen(readFileSync('docs/erd/conceptual.puml', 'utf8'))
      .filter((b) => b.kind === 'entity').map((b) => b.name);
    expect(entities.length).toBeGreaterThanOrEqual(20);
    for (const e of entities) expect(chen, `entity ${e} missing in conceptual.puml`).toContain(e);
  });

  it('FR-024: every table has a Vietnamese and an English predicate', async () => {
    const predicates = parsePredicates(readFileSync('docs/erd/predicates.yaml', 'utf8'));
    for (const t of await tableNames()) {
      expect(predicates[t]?.vi, `vi predicate for ${t}`).toBeTruthy();
      expect(predicates[t]?.en, `en predicate for ${t}`).toBeTruthy();
    }
  });
});
