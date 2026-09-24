/**
 * Spike S0 (plan Phase A): prove every MySQL / Drizzle mechanism the design relies on, on the
 * real server, in a scratch schema `${DB_NAME}_spike` that is dropped at the end.
 * Usage: pnpm db:spike
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import mysql, { type Connection } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { appUserName, dbConfig, mainSchemaName } from '../../src/lib/db/config';

const schema = `${mainSchemaName()}_spike`;
const appUser = appUserName();
const tmpDir = path.resolve('.tmp/spike');
const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    record(name, true, detail ?? '');
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function expectError(p: Promise<unknown>, test: (e: any) => boolean, label: string) {
  try {
    await p;
  } catch (e) {
    assert(test(e), `${label}: unexpected error ${(e as any).errno} ${(e as any).message}`);
    return e as any;
  }
  throw new Error(`${label}: expected an error, got success`);
}

async function connect(role: 'owner' | 'app', database?: string): Promise<Connection> {
  const cfg = dbConfig(role, { schema: database ?? schema });
  return mysql.createConnection({ ...cfg, timezone: 'Z', dateStrings: true });
}

async function main() {
  const root = await connect('owner', 'mysql');
  await root.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  await root.query(`CREATE DATABASE \`${schema}\``);
  await root.end();
  const owner = await connect('owner');

  await check('Server: version 8.4, UTC, trust flag, event scheduler', async () => {
    const [[row]] = (await owner.query(
      `SELECT VERSION() v, @@global.time_zone tz, @@time_zone stz,
              @@log_bin_trust_function_creators trust, @@event_scheduler ev`,
    )) as any;
    assert(String(row.v).startsWith('8.4'), `version ${row.v}`);
    assert(row.tz === '+00:00' && row.stz === '+00:00', `time_zone ${row.tz}/${row.stz}`);
    assert(Number(row.trust) === 1, 'log_bin_trust_function_creators != 1');
    assert(row.ev === 'ON', `event_scheduler ${row.ev}`);
    return `MySQL ${row.v}`;
  });

  await check('Constraints: CHECK (3819) and generated-column UNIQUE (1062)', async () => {
    await owner.query(`CREATE TABLE t_ck (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ref_id BIGINT NOT NULL,
        status ENUM('a','x') NOT NULL,
        amount BIGINT NOT NULL,
        open_ref BIGINT GENERATED ALWAYS AS (IF(status='x', ref_id, NULL)) STORED,
        CONSTRAINT t_ck_amount CHECK (amount >= 0),
        UNIQUE KEY t_ck_open (open_ref))`);
    await expectError(owner.query(`INSERT INTO t_ck (ref_id,status,amount) VALUES (1,'a',-1)`),
      (e) => e.errno === 3819, 'CHECK');
    await owner.query(`INSERT INTO t_ck (ref_id,status,amount) VALUES (1,'x',1),(1,'a',1),(1,'a',1)`);
    await expectError(owner.query(`INSERT INTO t_ck (ref_id,status,amount) VALUES (1,'x',1)`),
      (e) => e.errno === 1062, 'generated UNIQUE');
  });

  await check('Trigger: SIGNAL 45000 reaches mysql2 with message', async () => {
    await owner.query(`CREATE TABLE t_trg (id INT PRIMARY KEY)`);
    await owner.query(`CREATE TRIGGER trg_t_trg_bi BEFORE INSERT ON t_trg FOR EACH ROW
      BEGIN
        IF NEW.id < 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'KEY: negative id';
        END IF;
      END`);
    const e = await expectError(owner.query(`INSERT INTO t_trg VALUES (-1)`),
      (x) => x.sqlState === '45000', 'trigger');
    assert(e.message === 'KEY: negative id', `message ${e.message}`);
  });

  await check('Procedure: JSON_TABLE + FOR UPDATE + EXIT HANDLER rollback/RESIGNAL', async () => {
    await owner.query(`CREATE TABLE t_proc (id INT PRIMARY KEY, amount INT NOT NULL)`);
    await owner.query(`INSERT INTO t_proc VALUES (1, 0)`);
    await owner.query(`CREATE PROCEDURE p_json(IN p_items JSON, IN p_fail BOOLEAN)
      SQL SECURITY DEFINER
      BEGIN
        DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
        START TRANSACTION;
        SELECT id FROM t_proc WHERE id = 1 FOR UPDATE;
        INSERT INTO t_proc (id, amount)
          SELECT j.id, j.amount FROM JSON_TABLE(p_items, '$[*]'
            COLUMNS (id INT PATH '$.id', amount INT PATH '$.amount')) AS j;
        IF p_fail THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORCED: rollback expected';
        END IF;
        COMMIT;
      END`);
    await owner.query(`CALL p_json('[{"id":2,"amount":5},{"id":3,"amount":6}]', FALSE)`);
    const e = await expectError(
      owner.query(`CALL p_json('[{"id":4,"amount":5},{"id":5,"amount":6}]', TRUE)`),
      (x) => x.sqlState === '45000', 'forced error');
    assert(e.message.startsWith('FORCED:'), `message ${e.message}`);
    const [[c]] = (await owner.query(`SELECT COUNT(*) n FROM t_proc`)) as any;
    assert(Number(c.n) === 3, `expected 3 rows, got ${c.n}`);
  });

  await check('Deadlock inside procedures surfaces as 1213 and leaves no rows', async () => {
    await owner.query(`CREATE TABLE t_dl (id INT PRIMARY KEY)`);
    await owner.query(`CREATE TABLE t_dl_log (who VARCHAR(8))`);
    await owner.query(`INSERT INTO t_dl VALUES (1),(2)`);
    await owner.query(`CREATE PROCEDURE p_dl(IN p_first INT, IN p_second INT, IN p_who VARCHAR(8))
      SQL SECURITY DEFINER
      BEGIN
        DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
        START TRANSACTION;
        SELECT id FROM t_dl WHERE id = p_first FOR UPDATE;
        INSERT INTO t_dl_log VALUES (p_who);
        DO SLEEP(0.5);
        SELECT id FROM t_dl WHERE id = p_second FOR UPDATE;
        COMMIT;
      END`);
    const a = await connect('owner');
    const b = await connect('owner');
    const res = await Promise.allSettled([
      a.query(`CALL p_dl(1, 2, 'a')`),
      b.query(`CALL p_dl(2, 1, 'b')`),
    ]);
    await a.end();
    await b.end();
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    assert(failed.length === 1, `expected exactly one failure, got ${failed.length}`);
    assert(failed[0].reason.errno === 1213, `errno ${failed[0].reason.errno}`);
    const [[c]] = (await owner.query(`SELECT COUNT(*) n FROM t_dl_log`)) as any;
    assert(Number(c.n) === 1, `loser left rows: ${c.n}`);
  });

  await check('Cursor: loop commits once per row', async () => {
    await owner.query(`CREATE TABLE t_cur (id INT PRIMARY KEY, done BOOLEAN NOT NULL DEFAULT FALSE)`);
    await owner.query(`INSERT INTO t_cur (id) VALUES (1),(2),(3)`);
    await owner.query(`CREATE PROCEDURE p_cur(OUT p_count INT)
      SQL SECURITY DEFINER
      BEGIN
        DECLARE v_id INT;
        DECLARE v_done BOOLEAN DEFAULT FALSE;
        DECLARE cur CURSOR FOR SELECT id FROM t_cur WHERE done = FALSE ORDER BY id;
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
        SET p_count = 0;
        OPEN cur;
        read_loop: LOOP
          FETCH cur INTO v_id;
          IF v_done THEN LEAVE read_loop; END IF;
          START TRANSACTION;
          UPDATE t_cur SET done = TRUE WHERE id = v_id;
          COMMIT;
          SET p_count = p_count + 1;
        END LOOP;
        CLOSE cur;
      END`);
    await owner.query(`CALL p_cur(@n)`);
    const [[r]] = (await owner.query(`SELECT @n n, (SELECT COUNT(*) FROM t_cur WHERE done) d`)) as any;
    assert(Number(r.n) === 3 && Number(r.d) === 3, `count ${r.n}, done ${r.d}`);
  });

  await check('Function: DETERMINISTIC fn_due_at gives US2-10 values', async () => {
    await owner.query(`CREATE FUNCTION fn_due_at(p_borrowed_at DATETIME(3), p_loan_days INT)
      RETURNS DATETIME(3) DETERMINISTIC
      RETURN TIMESTAMP(DATE(p_borrowed_at + INTERVAL 7 HOUR) + INTERVAL p_loan_days DAY,
                       '23:59:59.999') - INTERVAL 7 HOUR`);
    const [[r]] = (await owner.query(
      `SELECT fn_due_at('2026-09-30 16:59:59.900', 14) a, fn_due_at('2026-09-30 17:00:00.000', 7) b`,
    )) as any;
    assert(r.a === '2026-10-14 16:59:59.999', `a=${r.a}`);
    assert(r.b === '2026-10-08 16:59:59.999', `b=${r.b}`);
  });

  await check('Privileges: app INSERT → 1142, CALL of DEFINER procedure works', async () => {
    await owner.query(`CREATE TABLE t_priv (id INT AUTO_INCREMENT PRIMARY KEY, v INT)`);
    await owner.query(`CREATE PROCEDURE p_priv_ins(IN p_v INT) SQL SECURITY DEFINER
      INSERT INTO t_priv (v) VALUES (p_v)`);
    await owner.query(`GRANT SELECT ON \`${schema}\`.* TO ?@'%'`, [appUser]);
    await owner.query(`GRANT EXECUTE ON PROCEDURE \`${schema}\`.p_priv_ins TO ?@'%'`, [appUser]);
    const app = await connect('app');
    try {
      await expectError(app.query(`INSERT INTO t_priv (v) VALUES (1)`), (e) => e.errno === 1142, 'direct insert');
      await app.query(`CALL p_priv_ins(7)`);
      const [[r]] = (await app.query(`SELECT COUNT(*) n FROM t_priv WHERE v = 7`)) as any;
      assert(Number(r.n) === 1, 'procedure insert missing');
    } finally {
      await app.end();
    }
  });

  await check('Lock waits visible in performance_schema.data_lock_waits', async () => {
    await owner.query(`CREATE TABLE t_lw (id INT PRIMARY KEY)`);
    await owner.query(`INSERT INTO t_lw VALUES (1)`);
    const holder = await connect('owner');
    const waiter = await connect('owner');
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM t_lw WHERE id = 1 FOR UPDATE');
    await waiter.query('BEGIN');
    const waiting = waiter.query('SELECT id FROM t_lw WHERE id = 1 FOR UPDATE');
    let seen = 0;
    for (let i = 0; i < 50 && seen === 0; i++) {
      const [[r]] = (await owner.query(
        `SELECT COUNT(*) n FROM performance_schema.data_lock_waits w
           JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
          WHERE l.OBJECT_SCHEMA = ?`, [schema])) as any;
      seen = Number(r.n);
      if (!seen) await new Promise((res) => setTimeout(res, 100));
    }
    await holder.query('ROLLBACK');
    await waiting;
    await waiter.query('ROLLBACK');
    await holder.end();
    await waiter.end();
    assert(seen >= 1, 'no waiter observed');
  });

  await check('Drizzle rc.4: generated SQL has CHECK + STORED column; migrate() runs a procedure', async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'schema.ts'), `
import { mysqlTable, bigint, mysqlEnum, check, uniqueIndex } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
export const sample = mysqlTable('d_sample', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  refId: bigint('ref_id', { mode: 'number' }).notNull(),
  status: mysqlEnum('status', ['a', 'x']).notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  openRef: bigint('open_ref', { mode: 'number' }).generatedAlwaysAs(sql\`IF(status = 'x', ref_id, NULL)\`, { mode: 'stored' }),
}, (t) => [check('d_sample_amount_ck', sql\`amount >= 0\`), uniqueIndex('d_sample_open_uq').on(t.openRef)]);
`);
    writeFileSync(path.join(tmpDir, 'drizzle.config.ts'), `
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ out: './.tmp/spike/out', schema: './.tmp/spike/schema.ts', dialect: 'mysql' });
`);
    const kit = (args: string[]) =>
      execFileSync('pnpm', ['exec', 'drizzle-kit', 'generate', '--config', '.tmp/spike/drizzle.config.ts', ...args],
        { stdio: 'pipe' });
    kit(['--name=sample']);
    kit(['--custom', '--name=proc']);
    const outDir = path.join(tmpDir, 'out');
    const dirs = readdirSync(outDir).sort();
    const tableSql = readFileSync(path.join(outDir, dirs[0], 'migration.sql'), 'utf8');
    assert(/CHECK\s*\(/i.test(tableSql), 'no CHECK in generated SQL');
    assert(/GENERATED ALWAYS AS \(.*\) STORED/i.test(tableSql), 'no STORED generated column');
    writeFileSync(path.join(outDir, dirs[1], 'migration.sql'),
      `CREATE PROCEDURE d_proc(IN p_v BIGINT)
SQL SECURITY DEFINER
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  START TRANSACTION;
  INSERT INTO d_sample (ref_id, status, amount) VALUES (p_v, 'a', p_v);
  COMMIT;
END;
--> statement-breakpoint
CREATE TRIGGER d_sample_bi BEFORE INSERT ON d_sample FOR EACH ROW
BEGIN
  IF NEW.amount > 1000 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TOO_BIG: amount';
  END IF;
END;
`);
    const conn = await connect('owner');
    try {
      await migrate(drizzle({ client: conn }), { migrationsFolder: outDir });
      await conn.query('CALL d_proc(5)');
      const [[r]] = (await conn.query('SELECT COUNT(*) n FROM d_sample')) as any;
      assert(Number(r.n) === 1, 'procedure from migration did not insert');
      await expectError(conn.query(`INSERT INTO d_sample (ref_id,status,amount) VALUES (1,'a',-5)`),
        (e) => e.errno === 3819, 'generated CHECK');
      await expectError(conn.query(`INSERT INTO d_sample (ref_id,status,amount) VALUES (1,'a',5000)`),
        (e) => e.sqlState === '45000', 'trigger from migration');
    } finally {
      await conn.end();
    }
    return `migrations: ${dirs.join(', ')}`;
  });

  await check('Drizzle (patched): a changed CHECK expression is detected by generate', async () => {
    // Regression guard for patches/drizzle-kit@1.0.0-rc.4.patch (research "Drizzle-kit findings").
    const schemaFile = path.join(tmpDir, 'schema.ts');
    writeFileSync(schemaFile, readFileSync(schemaFile, 'utf8').replace('amount >= 0', 'amount >= 1'));
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'generate', '--config', '.tmp/spike/drizzle.config.ts',
      '--name=check_change'], { stdio: 'pipe' });
    const outDir = path.join(tmpDir, 'out');
    const last = readdirSync(outDir).sort().pop()!;
    const sql = readFileSync(path.join(outDir, last, 'migration.sql'), 'utf8');
    assert(last.endsWith('check_change'), `no migration generated (last: ${last})`);
    assert(/DROP CONSTRAINT `d_sample_amount_ck`/.test(sql) && /ADD CONSTRAINT `d_sample_amount_ck` CHECK/.test(sql),
      `unexpected SQL: ${sql}`);
  });

  await check('PlantUML: plantuml/plantuml renders @startchen to SVG', async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'chen.puml'), `@startchen
entity BOOK {
  Id <<key>>
  Title
}
entity COPY {
  Barcode <<key>>
}
relationship HAS_COPY {
}
HAS_COPY -1- BOOK
HAS_COPY -N- COPY
@endchen
`);
    execFileSync('docker', ['run', '--rm', '-v', `${tmpDir}:/work`, 'plantuml/plantuml', '-tsvg', '/work/chen.puml'],
      { stdio: 'pipe' });
    assert(existsSync(path.join(tmpDir, 'chen.svg')), 'chen.svg not produced');
  });

  await owner.query(`REVOKE ALL PRIVILEGES ON \`${schema}\`.* FROM ?@'%'`, [appUser]).catch(() => {});
  await owner.query(`REVOKE EXECUTE ON PROCEDURE \`${schema}\`.p_priv_ins FROM ?@'%'`, [appUser]).catch(() => {});
  await owner.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  await owner.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
