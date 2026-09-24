import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appUserName, mainSchemaName, testSchemaName } from '../../src/lib/db/config';
import { EXPECTED_TABLES } from '../../scripts/db/objects';
import { appConn, closeTestPools, expectErrno, ownerQuery } from '../helpers/db';
import { expectNoViolations } from '../helpers/concurrency';
import { truncateAll } from '../helpers/fixtures';

afterAll(closeTestPools);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('Foundation (T031)', () => {
  it('FR-029: all 27 tables exist after a fresh migrate', async () => {
    const rows = await ownerQuery<{ name: string }>(
      `SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`);
    const names = rows.map((r) => r.name);
    for (const t of EXPECTED_TABLES) expect(names).toContain(t);
    expect(EXPECTED_TABLES).toHaveLength(27);
  });

  it('reference data rows exist', async () => {
    const [[mt], [rt], [perm], [roles]] = await Promise.all([
      ownerQuery(`SELECT COUNT(*) n FROM material_types WHERE code = 'BOOK_PRINT'`),
      ownerQuery(`SELECT COUNT(*) n FROM reader_types WHERE code IN ('STUDENT','LECTURER','EXTERNAL')`),
      ownerQuery(`SELECT COUNT(*) n FROM permissions`),
      ownerQuery(`SELECT COUNT(*) n FROM roles WHERE code IN ('admin','librarian','reader')`),
    ]);
    expect(Number(mt.n)).toBe(1);
    expect(Number(rt.n)).toBe(3);
    expect(Number(perm.n)).toBe(12);
    expect(Number(roles.n)).toBe(3);
  });

  it('R-26: the app account cannot INSERT into loans (1142) and can EXECUTE fn_due_at', async () => {
    const conn = await appConn();
    try {
      await expectErrno(
        conn.query(`INSERT INTO loans (reader_id, processed_by_user_id, borrowed_at, status, created_at)
                    VALUES (1, 1, UTC_TIMESTAMP(3), 'open', UTC_TIMESTAMP(3))`),
        1142,
      );
      const [[r]] = (await conn.query(`SELECT fn_due_at('2026-09-30 16:59:59.900', 14) d`)) as any;
      expect(r.d).toBe('2026-10-14 16:59:59.999');
    } finally {
      await conn.end();
    }
  });

  it('FR-030: migrations hard-code no schema or account; every definer is root', async () => {
    // Source check: MySQL itself schema-qualifies stored view bodies, so SHOW CREATE is not a
    // reliable signal. The migration files are the source of truth.
    const names = [mainSchemaName(), testSchemaName()].map(esc);
    const qualified = new RegExp(`(^|[^A-Za-z0-9_])\`?(${names.join('|')})\`?\\.`, 'i');
    const account = new RegExp(`'${esc(appUserName())}'\\s*@`, 'i');
    const files = readdirSync('drizzle').map((d) => path.join('drizzle', d, 'migration.sql'));
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const sql = readFileSync(f, 'utf8');
      expect(sql, f).not.toMatch(qualified);
      expect(sql, f).not.toMatch(account);
      expect(sql, `${f} must not set DEFINER`).not.toMatch(/\bDEFINER\s*=/i);
    }
    // Every stored object is owned by the owner account (root).
    const definers = await ownerQuery<{ kind: string; name: string; definer: string }>(`
      SELECT 'ROUTINE' kind, ROUTINE_NAME name, DEFINER definer FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()
      UNION ALL SELECT 'VIEW', TABLE_NAME, DEFINER FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()
      UNION ALL SELECT 'TRIGGER', TRIGGER_NAME, DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
      UNION ALL SELECT 'EVENT', EVENT_NAME, DEFINER FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()`);
    expect(definers.length).toBeGreaterThan(0);
    for (const d of definers) expect(d.definer, `${d.kind} ${d.name}`).toBe('root@%');
  });

  it('FR-029: every invariant view returns 0 rows on an empty schema', async () => {
    await truncateAll();
    await expectNoViolations();
  });
});
