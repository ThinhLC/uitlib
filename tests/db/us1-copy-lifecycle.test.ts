import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { call, closeTestPools, expectRule, ownerQuery } from '../helpers/db';
import { account, book, copy, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const NOW = vn('2026-09-01 09:00');

const status = async (copyId: number) =>
  (await ownerQuery(`SELECT circulation_status s FROM book_copies WHERE id = ?`, [copyId]))[0].s;

/** Insert a copy directly in a given status (INSERT does not fire the BEFORE UPDATE trigger). */
async function copyIn(bookId: number, s: string, cond = 'good') {
  const rows: any = await ownerQuery(
    `INSERT INTO book_copies (book_id, barcode, physical_condition, circulation_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [bookId, `X-${Math.random().toString(36).slice(2, 10)}`, cond, s]);
  return Number(rows.insertId);
}

describe('US1 copy lifecycle (T034)', () => {
  it('FR-006a: allowed transitions through sp_change_copy_status', async () => {
    const staff = await account(['librarian']);
    const bookId = await book();
    const c = await copy(staff, NOW, bookId);
    await call('sp_change_copy_status', [staff, NOW, c, 'in_repair', 'damaged']);
    expect(await status(c)).toBe('in_repair');
    await call('sp_change_copy_status', [staff, NOW, c, 'available', 'good']);
    expect(await status(c)).toBe('available');
    await call('sp_change_copy_status', [staff, NOW, c, 'retired', null]);
    expect(await status(c)).toBe('retired');

    const repaired = await copyIn(bookId, 'in_repair', 'damaged');
    await call('sp_change_copy_status', [staff, NOW, repaired, 'retired', null]);
    expect(await status(repaired)).toBe('retired');

    // D9 lost-then-found: lost → available / in_repair / retired
    for (const target of ['available', 'in_repair', 'retired']) {
      const lost = await copyIn(bookId, 'lost');
      await call('sp_change_copy_status', [staff, NOW, lost, target, target === 'in_repair' ? 'damaged' : null]);
      expect(await status(lost)).toBe(target);
    }
  });

  it('F3: a copy registered damaged starts in_repair', async () => {
    const staff = await account(['librarian']);
    const c = await copy(staff, NOW, await book(), { condition: 'damaged' });
    expect(await status(c)).toBe('in_repair');
  });

  it('B-5 R-06b: illegal transitions are rejected by procedure and by trigger', async () => {
    const staff = await account(['librarian']);
    const bookId = await book();
    const retired = await copyIn(bookId, 'retired');
    await expectRule(call('sp_change_copy_status', [staff, NOW, retired, 'available', null]), 'INVALID_TRANSITION');
    await expectRule(ownerQuery(`UPDATE book_copies SET circulation_status = 'available' WHERE id = ?`, [retired]),
      'INVALID_TRANSITION');

    const available = await copy(staff, NOW, bookId);
    await expectRule(ownerQuery(`UPDATE book_copies SET circulation_status = 'lost' WHERE id = ?`, [available]),
      'INVALID_TRANSITION');
    // on_loan / on_hold are set only by circulation procedures
    await expectRule(call('sp_change_copy_status', [staff, NOW, available, 'on_loan', null]), 'INVALID_TRANSITION');
    await expectRule(call('sp_change_copy_status', [staff, NOW, available, 'on_hold', null]), 'INVALID_TRANSITION');

    const lost = await copyIn(bookId, 'lost');
    await expectRule(ownerQuery(`UPDATE book_copies SET circulation_status = 'on_loan' WHERE id = ?`, [lost]),
      'INVALID_TRANSITION');
  });

  it('R-12c: a copy cannot enter on_loan without an open loan item', async () => {
    const staff = await account(['librarian']);
    const c = await copy(staff, NOW, await book());
    await expectRule(ownerQuery(`UPDATE book_copies SET circulation_status = 'on_loan' WHERE id = ?`, [c]),
      'COPY_STATE');
  });

  it('R-20: accounts without catalog.write, or inactive, are FORBIDDEN', async () => {
    const readerAcct = await account(['reader']);
    const inactive = await account(['librarian'], { status: 'inactive' });
    const bookId = await book();
    for (const actor of [readerAcct, inactive]) {
      await expectRule(call('sp_register_copy', [actor, NOW, bookId, `F-${actor}`, 'A1', null, 'good'],
        { outParams: ['p_copy_id'] }), 'FORBIDDEN');
    }
    const staff = await account(['librarian']);
    const c = await copy(staff, NOW, bookId);
    await expectRule(call('sp_change_copy_status', [readerAcct, NOW, c, 'in_repair', 'damaged']), 'FORBIDDEN');
    const [row] = await ownerQuery(`SELECT COUNT(*) n FROM book_copies`);
    expect(Number(row.n)).toBe(1);
  });

  it('NOT_FOUND: registering a copy for a missing book', async () => {
    const staff = await account(['librarian']);
    await expectRule(call('sp_register_copy', [staff, NOW, 999999, 'B-NF', 'A1', null, 'good'],
      { outParams: ['p_copy_id'] }), 'NOT_FOUND');
  });
});
