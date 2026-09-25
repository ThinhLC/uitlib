import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { endpoints, ERROR_KEYS } from '@/lib/api/contract';
import { mountedEndpoints } from '@/server/api/define-route';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { createTestApp } from './helpers/app';

afterAll(closeTestPools);

/** Flip to true once every story's routes exist (tasks T071). */
const ALL_PROCEDURES_ROUTED = true;

describe('Contract coverage (FR-002, SC-001)', () => {
  it('every contract endpoint is mounted', () => {
    const { app } = createTestApp();
    const mounted = mountedEndpoints(app);
    const missing = Object.entries(endpoints).filter(([, e]) => !mounted.has(e)).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('endpoint paths are unique per method', () => {
    const seen = new Map<string, string>();
    for (const [name, e] of Object.entries(endpoints)) {
      const key = `${e.method} ${e.path}`;
      expect(seen.get(key), `${name} duplicates ${seen.get(key)}`).toBeUndefined();
      seen.set(key, name);
    }
  });

  it.runIf(ALL_PROCEDURES_ROUTED)('every public procedure has an endpoint', async () => {
    const rows = await ownerQuery(
      `SELECT ROUTINE_NAME name FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'
          AND ROUTINE_NAME LIKE 'sp\\_%' AND ROUTINE_NAME NOT LIKE 'sp\\_\\_%'`,
    );
    const routed = new Set(Object.values(endpoints).map((e) => (e as { procedure?: string }).procedure));
    expect(rows.map((r) => r.name).filter((n) => !routed.has(n)).sort()).toEqual([]);
  });

  it('every key signalled by a migration is a contract error key', () => {
    const dir = join(process.cwd(), 'drizzle');
    const keys = new Set<string>();
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const sql = readFileSync(join(dir, d.name, 'migration.sql'), 'utf8');
      for (const stmt of sql.match(/MESSAGE_TEXT\s*=[\s\S]*?;/g) ?? []) {
        for (const m of stmt.matchAll(/'([A-Z][A-Z_]+):/g)) keys.add(m[1]);
      }
    }
    expect(keys.size).toBeGreaterThan(15);
    const known = new Set<string>(ERROR_KEYS);
    expect([...keys].filter((k) => !known.has(k)).sort()).toEqual([]);
  });
});
