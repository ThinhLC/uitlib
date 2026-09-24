import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appConn, call, closeTestPools, expectErrno, expectRule, ownerQuery } from '../helpers/db';
import { account, admin, card, reader, readerTypeId, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const NOW = vn('2026-09-01 09:00');
const issue = (actor: number, readerId: number, number: string, expires = vn('2027-09-01 00:00'), now = NOW) =>
  call('sp_issue_card', [actor, now, readerId, number, expires], { outParams: ['p_card_id'] });
const cardStatus = async (id: number) =>
  (await ownerQuery(`SELECT status FROM library_cards WHERE id = ?`, [id]))[0].status;

describe('US2 readers and cards (T038)', () => {
  it('US2-1: a reader without an account can later be linked to exactly one account', async () => {
    const acct = await account(['reader']);
    const conn = await appConn();
    try {
      const [r1] = (await conn.query(
        `INSERT INTO readers (reader_type_id, full_name, status, created_at) VALUES (?, 'An', 'active', UTC_TIMESTAMP(3))`,
        [await readerTypeId('STUDENT')])) as any;
      await conn.query(`UPDATE readers SET user_id = ? WHERE id = ?`, [acct, r1.insertId]);
      const [r2] = (await conn.query(
        `INSERT INTO readers (reader_type_id, full_name, status, created_at) VALUES (?, 'Binh', 'active', UTC_TIMESTAMP(3))`,
        [await readerTypeId('STUDENT')])) as any;
      await expectErrno(conn.query(`UPDATE readers SET user_id = ? WHERE id = ?`, [acct, r2.insertId]), 1062);
    } finally {
      await conn.end();
    }
  });

  it('US2-2 R-08c: a second active card is rejected; after revoking, a new one is accepted', async () => {
    const staff = await account(['librarian']);
    const r = await reader();
    const { out } = await issue(staff, r, 'C001');
    await expectErrno(issue(staff, r, 'C002'), 1062);
    await call('sp_set_card_status', [staff, NOW, (out as any).p_card_id, 'revoked']);
    await issue(staff, r, 'C003');
    const [n] = await ownerQuery(`SELECT COUNT(*) n FROM library_cards WHERE reader_id = ? AND status = 'active'`, [r]);
    expect(Number(n.n)).toBe(1);
  });

  it('US2-7 R-08b: expiry not after issue is rejected (VALIDATION via procedure, 3819 via CHECK)', async () => {
    const staff = await account(['librarian']);
    const r = await reader();
    await expectRule(issue(staff, r, 'C001', NOW), 'VALIDATION');
    await expectErrno(ownerQuery(
      `INSERT INTO library_cards (reader_id, card_number, issued_at, expires_at, status, created_at)
       VALUES (?, 'C009', ?, ?, 'active', ?)`, [r, NOW, NOW, NOW]), 3819);
  });

  it('US2-9 R-08a: a duplicate card number is rejected (1062)', async () => {
    const staff = await account(['librarian']);
    await issue(staff, await reader(), 'C001');
    await expectErrno(issue(staff, await reader(), 'C001'), 1062);
  });

  it('FR-008: card status moves only from active; FORBIDDEN without card.manage', async () => {
    const staff = await account(['librarian']);
    const r = await reader();
    const c = await card(staff, NOW, r);
    await call('sp_set_card_status', [staff, NOW, c, 'lost']);
    expect(await cardStatus(c)).toBe('lost');
    await expectRule(call('sp_set_card_status', [staff, NOW, c, 'active']), 'INVALID_TRANSITION');
    const readerAcct = await account(['reader']);
    await expectRule(issue(readerAcct, r, 'C777'), 'FORBIDDEN');
    await expectRule(call('sp_set_card_status', [staff, NOW, 999999, 'revoked']), 'NOT_FOUND');
  });

  it('FR-028 cursor: sp_expire_cards expires exactly the active cards past their expiry', async () => {
    const staff = await admin();
    const a = await card(staff, NOW, await reader(), vn('2026-12-31 23:59'));
    const b = await card(staff, NOW, await reader(), vn('2026-10-01 00:00'));
    const c = await card(staff, NOW, await reader(), vn('2027-06-30 00:00'));
    const revoked = await card(staff, NOW, await reader(), vn('2026-10-01 00:00'));
    await call('sp_set_card_status', [staff, NOW, revoked, 'revoked']);
    const { out } = await call('sp_expire_cards', [staff, vn('2027-01-01 00:00')], { outParams: ['p_count'] });
    expect(Number((out as any).p_count)).toBe(2);
    expect([await cardStatus(a), await cardStatus(b), await cardStatus(c), await cardStatus(revoked)])
      .toEqual(['expired', 'expired', 'active', 'revoked']);
    await expectRule(call('sp_expire_cards', [await account(['reader']), NOW], { outParams: ['p_count'] }),
      'FORBIDDEN');
  });
});
