import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PROCEDURE_ONLY_TABLES } from '../../src/lib/db/grants';
import { appConn, call, closeTestPools, expectErrno, expectRule, ownerQuery } from '../helpers/db';
import { account, book, card, checkout, copy, policy, reader, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const T = vn('2026-09-10 10:00');

/** Every public operation procedure with dummy arguments (permission is checked first). */
const OPERATIONS: { name: string; args: unknown[]; out?: string[] }[] = [
  { name: 'sp_create_policy_version', args: [1, 1, 5, 14, 2, 2000, 50000, T], out: ['p_policy_id'] },
  { name: 'sp_close_policy_version', args: [1, vn('2026-12-01 00:00')] },
  { name: 'sp_issue_card', args: [1, 'C-X', vn('2027-01-01 00:00')], out: ['p_card_id'] },
  { name: 'sp_set_card_status', args: [1, 'revoked'] },
  { name: 'sp_expire_cards', args: [], out: ['p_count'] },
  { name: 'sp_register_copy', args: [1, 'B-X', 'A1', null, 'good'], out: ['p_copy_id'] },
  { name: 'sp_change_copy_status', args: [1, 'retired', null] },
  { name: 'sp_checkout', args: [1, '[1]'] },
  { name: 'sp_return_item', args: [1, 'good', null, null] },
  { name: 'sp_declare_lost', args: [1, null, null] },
  { name: 'sp_renew', args: [1], out: ['p_new_due_at'] },
  { name: 'sp_record_payment', args: [1, 1000, 'cash', null, 'K-X', '[{"fine_id":1,"amount_vnd":1000}]'],
    out: ['p_payment_id', 'p_replayed'] },
  { name: 'sp_adjust_fine', args: [1, -1000, 'reason'], out: ['p_adjustment_id'] },
];

async function rowCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of PROCEDURE_ONLY_TABLES) out[t] = Number((await ownerQuery(`SELECT COUNT(*) n FROM ${t}`))[0].n);
  return out;
}

describe('US5 accounts and RBAC (T068)', () => {
  it('US5-1 R-19a: one application account per Supabase user (1062)', async () => {
    const conn = await appConn();
    try {
      const uuid = '11111111-2222-3333-4444-555555555555';
      await conn.query(`INSERT INTO app_users (supabase_user_id, status, created_at) VALUES (?, 'active', ?)`, [uuid, T]);
      await expectErrno(conn.query(
        `INSERT INTO app_users (supabase_user_id, status, created_at) VALUES (?, 'active', ?)`, [uuid, T]), 1062);
    } finally {
      await conn.end();
    }
  });

  it('US5-4: a deactivated librarian keeps its 20 loans and can no longer check out', async () => {
    const admin = await account(['admin']);
    const librarian = await account(['librarian']);
    await policy(admin, T, 'STUDENT', { maxItems: 5 });
    const bookId = await book();
    const copies: number[] = [];
    for (let i = 0; i < 21; i++) copies.push(await copy(librarian, T, bookId));
    const readers: number[] = [];
    for (let i = 0; i < 5; i++) {
      readers.push(await reader());
      await card(librarian, T, readers[i]);
    }
    for (let i = 0; i < 20; i++) await checkout(librarian, T, readers[Math.floor(i / 5)], [copies[i]]);
    const conn = await appConn();
    try {
      await conn.query(`UPDATE app_users SET status = 'inactive' WHERE id = ?`, [librarian]);
    } finally {
      await conn.end();
    }
    const [n] = await ownerQuery(`SELECT COUNT(*) n FROM loans WHERE processed_by_user_id = ?`, [librarian]);
    expect(Number(n.n)).toBe(20);
    await expectRule(checkout(librarian, T, readers[4], [copies[20]]), 'FORBIDDEN');
  });

  it('US5-6 R-20: every operation procedure refuses an unauthorized or inactive account, writing nothing', async () => {
    const noRights = await account(['reader']);
    const inactiveAdmin = await account(['admin'], { status: 'inactive' });
    const before = await rowCounts();
    for (const op of OPERATIONS) {
      for (const actor of [noRights, inactiveAdmin]) {
        await expectRule(call(op.name, [actor, T, ...op.args], { outParams: op.out }), 'FORBIDDEN');
      }
    }
    expect(await rowCounts()).toEqual(before);
  });

  it('R-26: the app account cannot INSERT, UPDATE or DELETE any procedure-only table (1142)', async () => {
    const conn = await appConn();
    try {
      for (const t of PROCEDURE_ONLY_TABLES) {
        await expectErrno(conn.query(`INSERT INTO ${t} () VALUES ()`), 1142);
        await expectErrno(conn.query(`UPDATE ${t} SET id = id WHERE 1 = 0`).catch((e) => {
          // allocations have no `id`; any column works for the privilege check
          if (e.errno === 1054) return conn.query(`UPDATE ${t} SET amount_vnd = amount_vnd WHERE 1 = 0`);
          throw e;
        }), 1142);
        await expectErrno(conn.query(`DELETE FROM ${t} WHERE 1 = 0`), 1142);
      }
    } finally {
      await conn.end();
    }
  });

  it('grants: every public routine is executable; internal sp__ helpers are not (1370)', async () => {
    const routines = await ownerQuery<{ name: string }>(
      `SELECT ROUTINE_NAME name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()`);
    const names = routines.map((r) => r.name);
    for (const op of OPERATIONS) expect(names).toContain(op.name);
    const conn = await appConn();
    try {
      const [grants] = (await conn.query(`SHOW GRANTS`)) as any;
      const text = grants.map((g: any) => Object.values(g)[0]).join('\n');
      for (const name of names.filter((n) => !n.startsWith('sp__'))) expect(text).toContain(`\`${name}\``);
      await expectErrno(conn.query(`CALL sp__assess_fines(1, 1, ?, 'returned', NULL, NULL, NULL)`, [T]), 1370);
    } finally {
      await conn.end();
    }
  });
});
