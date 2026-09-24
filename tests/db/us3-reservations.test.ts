import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appConn, call, closeTestPools, expectErrno, expectRule, ownerQuery } from '../helpers/db';
import {
  account, book, cancelReservation, checkout, copy, expireHolds, lendingWorld, otherReader, renew, reserve,
  returnItem, truncateAll,
} from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { testSchemaName } from '../../src/lib/db/config';

afterAll(closeTestPools);
beforeEach(truncateAll);

const res = async (id: number) => (await ownerQuery(`SELECT * FROM reservations WHERE id = ?`, [id]))[0];
const copyStatus = async (id: number) =>
  (await ownerQuery(`SELECT circulation_status s FROM book_copies WHERE id = ?`, [id]))[0].s;

/**
 * Book K with one copy, lent to R0 on 2026-09-02 (due 2026-09-16), and readers R1, R2, R3 with
 * valid cards who reserve K in that order on 2026-09-03.
 */
async function queueWorld(queue = 3) {
  const w = await lendingWorld({ copies: 1 });
  const [li] = await checkout(w.staff, vn('2026-09-02 10:00'), w.readerId, [w.copies[0]]);
  const readers: number[] = [];
  const reservations: number[] = [];
  for (let i = 0; i < queue; i++) {
    const r = (await otherReader(w)).readerId;
    readers.push(r);
    reservations.push(await reserve(w.staff, vn(`2026-09-03 10:0${i}`), r, w.bookId));
  }
  return { w, copyId: w.copies[0], loanItemId: li.loanItemId, readers, reservations };
}

describe('US3 [Ext] reservations and holds (T092)', () => {
  it('US3-7 R-14e: a return promotes the queue head; the others keep waiting', async () => {
    const q = await queueWorld();
    await returnItem(q.w.staff, vn('2026-09-05 10:00'), q.loanItemId);
    expect(await copyStatus(q.copyId)).toBe('on_hold');
    expect(await res(q.reservations[0])).toMatchObject({
      status: 'ready', assigned_copy_id: q.copyId, ready_at: vn('2026-09-05 10:00'),
      hold_expires_at: vn('2026-09-08 10:00') });
    expect((await res(q.reservations[1])).status).toBe('waiting');
    expect((await res(q.reservations[2])).status).toBe('waiting');
  });

  it('US3-8 R-14e: an expired hold passes to the next reader, then releases the copy', async () => {
    const q = await queueWorld(2);
    await returnItem(q.w.staff, vn('2026-09-05 10:00'), q.loanItemId);
    expect(await expireHolds(q.w.staff, vn('2026-09-08 09:59'))).toBe(0);
    expect(await expireHolds(q.w.staff, vn('2026-09-08 10:00'))).toBe(1);
    expect(await res(q.reservations[0])).toMatchObject({
      status: 'expired', closed_by_kind: 'system', closed_at: vn('2026-09-08 10:00') });
    expect(await res(q.reservations[1])).toMatchObject({
      status: 'ready', assigned_copy_id: q.copyId, hold_expires_at: vn('2026-09-11 10:00') });
    expect(await copyStatus(q.copyId)).toBe('on_hold');

    expect(await expireHolds(q.w.staff, vn('2026-09-11 10:00'))).toBe(1);
    expect((await res(q.reservations[1])).status).toBe('expired');
    expect(await copyStatus(q.copyId)).toBe('available');
  });

  it('US3-9 R-14f: only the holder can borrow a held copy; the loan fulfils the reservation', async () => {
    const q = await queueWorld(2);
    await returnItem(q.w.staff, vn('2026-09-05 10:00'), q.loanItemId);
    const [r1, r2] = q.readers;
    await expectRule(checkout(q.w.staff, vn('2026-09-06 10:00'), r2, [q.copyId]), 'COPY_NOT_AVAILABLE');
    await expectRule(checkout(q.w.staff, vn('2026-09-06 10:00'), q.w.readerId, [q.copyId]), 'COPY_NOT_AVAILABLE');
    const [li] = await checkout(q.w.staff, vn('2026-09-06 10:00'), r1, [q.copyId]);
    expect(await res(q.reservations[0])).toMatchObject({
      status: 'fulfilled', fulfilled_loan_item_id: li.loanItemId, closed_at: vn('2026-09-06 10:00') });
    expect(await copyStatus(q.copyId)).toBe('on_loan');
    expect((await res(q.reservations[1])).status).toBe('waiting');
  });

  it('FR-014c: checking out a copy whose hold has expired expires it first', async () => {
    // Nobody else waits: the late holder's own checkout expires the hold, frees the copy and lends it.
    const q = await queueWorld(1);
    await returnItem(q.w.staff, vn('2026-09-05 10:00'), q.loanItemId);
    const [li] = await checkout(q.w.staff, vn('2026-09-09 10:00'), q.readers[0], [q.copyId]);
    expect(await res(q.reservations[0])).toMatchObject({ status: 'expired', fulfilled_loan_item_id: null });
    expect(li.copyId).toBe(q.copyId);
    expect(await copyStatus(q.copyId)).toBe('on_loan');
  });

  it('FR-014c: an expired hold scanned at checkout passes to the next reader, not to a walk-in', async () => {
    const q = await queueWorld(2);
    await returnItem(q.w.staff, vn('2026-09-05 10:00'), q.loanItemId);
    const outsider = (await otherReader(q.w)).readerId;
    // the scan expires R1's hold and promotes R2, so the outsider is refused (the rollback undoes both)
    await expectRule(checkout(q.w.staff, vn('2026-09-09 10:00'), outsider, [q.copyId]), 'COPY_NOT_AVAILABLE');
    expect((await res(q.reservations[0])).status).toBe('ready');
    // R2's own scan runs the same expiry and promotion, then lends the copy to R2
    const [li] = await checkout(q.w.staff, vn('2026-09-09 10:05'), q.readers[1], [q.copyId]);
    expect((await res(q.reservations[0])).status).toBe('expired');
    expect(await res(q.reservations[1])).toMatchObject({ status: 'fulfilled', fulfilled_loan_item_id: li.loanItemId });
  });

  it('US3-14 R-14a/g: duplicate reservations and reservations with a way to borrow now are rejected', async () => {
    const q = await queueWorld(1);
    const [r1] = q.readers;
    const dup = await expectRule(reserve(q.w.staff, vn('2026-09-04 10:00'), r1, q.w.bookId), 'DUPLICATE');
    expect(dup.message).toContain('reservations_active_uq');
    // the reader who has the book on loan
    await expectRule(reserve(q.w.staff, vn('2026-09-04 10:00'), q.w.readerId, q.w.bookId), 'VALIDATION');
    // a book with an available copy
    const other = await book();
    await copy(q.w.staff, vn('2026-09-01 09:00'), other);
    await expectRule(reserve(q.w.staff, vn('2026-09-04 10:00'), r1, other), 'VALIDATION');
    await expectRule(reserve(q.w.staff, vn('2026-09-04 10:00'), r1, 999_999), 'NOT_FOUND');
  });

  it('US3-15 R-14e: a revoked-card head is cancelled; an indebted head gets the hold, then expires', async () => {
    const w = await lendingWorld({ copies: 1 });
    const [k] = await checkout(w.staff, vn('2026-09-02 10:00'), w.readerId, [w.copies[0]]);
    const [r1, r2, r3] = [(await otherReader(w)).readerId, (await otherReader(w)).readerId, (await otherReader(w)).readerId];
    // R2 builds a 58,000 VND debt (29 days × 2,000) on another book
    const b2 = await book();
    const c2 = await copy(w.staff, vn('2026-09-01 09:00'), b2);
    const [l2] = await checkout(w.staff, vn('2026-09-02 10:00'), r2, [c2]);
    for (const [i, r] of [r1, r2, r3].entries()) await reserve(w.staff, vn(`2026-09-03 10:0${i}`), r, w.bookId);
    await returnItem(w.staff, vn('2026-10-15 10:00'), l2.loanItemId);
    const [c1] = await ownerQuery(`SELECT id FROM library_cards WHERE reader_id = ?`, [r1]);
    await call('sp_set_card_status', [w.staff, vn('2026-10-15 11:00'), c1.id, 'revoked']);

    await returnItem(w.staff, vn('2026-10-16 10:00'), k.loanItemId);
    const byReader = async (r: number) =>
      (await ownerQuery(`SELECT * FROM reservations WHERE reader_id = ?`, [r]))[0];
    expect(await byReader(r1)).toMatchObject({
      status: 'cancelled', close_reason: 'ineligible_at_promotion', closed_by_kind: 'system' });
    expect(await byReader(r2)).toMatchObject({ status: 'ready', assigned_copy_id: w.copies[0] });
    await expectRule(checkout(w.staff, vn('2026-10-17 10:00'), r2, [w.copies[0]]), 'DEBT_BLOCKED');

    expect(await expireHolds(w.staff, vn('2026-10-19 10:00'))).toBe(1);
    expect((await byReader(r2)).status).toBe('expired');
    expect(await byReader(r3)).toMatchObject({ status: 'ready', assigned_copy_id: w.copies[0] });
  });

  it('US3-6 R-13a [Ext]: renewal is rejected while the book has a waiting reservation', async () => {
    const q = await queueWorld(1);
    const err = await expectRule(renew(q.w.staff, vn('2026-09-10 10:00'), q.loanItemId), 'RENEWAL_REJECTED');
    expect(err.message).toContain('reserved');
  });

  it('FR-014b: a registered or repaired copy goes to the queue before becoming available', async () => {
    const q = await queueWorld(2);
    const fresh = await copy(q.w.staff, vn('2026-09-04 09:00'), q.w.bookId);
    expect(await copyStatus(fresh)).toBe('on_hold');
    expect((await res(q.reservations[0])).assigned_copy_id).toBe(fresh);

    const repaired = await copy(q.w.staff, vn('2026-09-04 09:30'), q.w.bookId, { condition: 'damaged' });
    expect(await copyStatus(repaired)).toBe('in_repair');
    await call('sp_change_copy_status', [q.w.staff, vn('2026-09-05 09:00'), repaired, 'available', 'good']);
    expect(await copyStatus(repaired)).toBe('on_hold');
    expect((await res(q.reservations[1])).assigned_copy_id).toBe(repaired);
  });

  it('FR-014c: cancelling — by the reader or by staff with a reason; a ready cancel re-runs promotion', async () => {
    const q = await queueWorld(2);
    const acct = await account(['reader']);
    await ownerQuery(`UPDATE readers SET user_id = ? WHERE id = ?`, [acct, q.readers[1]]);
    await returnItem(q.w.staff, vn('2026-09-05 10:00'), q.loanItemId);

    await expectRule(cancelReservation(q.w.staff, vn('2026-09-06 10:00'), q.reservations[0], null), 'VALIDATION');
    await cancelReservation(q.w.staff, vn('2026-09-06 10:00'), q.reservations[0], 'reader asked at the desk');
    expect(await res(q.reservations[0])).toMatchObject({
      status: 'cancelled', closed_by_kind: 'staff', closed_by_user_id: q.w.staff,
      close_reason: 'reader asked at the desk' });
    expect(await res(q.reservations[1])).toMatchObject({ status: 'ready', assigned_copy_id: q.copyId });

    // the reader cancels their own hold without a reason; nobody waits, so the copy is released
    await cancelReservation(acct, vn('2026-09-07 10:00'), q.reservations[1], null);
    expect(await res(q.reservations[1])).toMatchObject({ status: 'cancelled', closed_by_kind: 'reader' });
    expect(await copyStatus(q.copyId)).toBe('available');
    await expectRule(cancelReservation(q.w.staff, vn('2026-09-07 11:00'), q.reservations[1], 'again'),
      'INVALID_TRANSITION');
  });

  it('R-14g: a reader account may reserve and cancel only for itself', async () => {
    const q = await queueWorld(0);
    const [mine, theirs] = [(await otherReader(q.w)).readerId, (await otherReader(q.w)).readerId];
    const acct = await account(['reader']);
    await ownerQuery(`UPDATE readers SET user_id = ? WHERE id = ?`, [acct, mine]);
    const id = await reserve(acct, vn('2026-09-04 10:00'), mine, q.w.bookId);
    expect((await res(id)).status).toBe('waiting');
    await expectRule(reserve(acct, vn('2026-09-04 10:00'), theirs, q.w.bookId), 'FORBIDDEN');
    const staffMade = await reserve(q.w.staff, vn('2026-09-04 10:01'), theirs, q.w.bookId);
    await expectRule(cancelReservation(acct, vn('2026-09-04 11:00'), staffMade, null), 'FORBIDDEN');
  });

  it('FR-014d: reservation status moves only waiting → ready | cancelled and ready → fulfilled | expired | cancelled', async () => {
    const q = await queueWorld(1);
    await cancelReservation(q.w.staff, vn('2026-09-04 10:00'), q.reservations[0], 'duplicate request');
    await expectRule(ownerQuery(`UPDATE reservations SET status = 'waiting', closed_at = NULL WHERE id = ?`,
      [q.reservations[0]]), 'INVALID_TRANSITION');
    await expectRule(ownerQuery(`UPDATE reservations SET status = 'expired' WHERE id = ?`, [q.reservations[0]]),
      'INVALID_TRANSITION');
  });

  it('FR-014c: the hold-expiry event runs every 15 minutes; its batch helper is not granted (1370)', async () => {
    const [ev] = await ownerQuery(
      `SELECT INTERVAL_VALUE v, INTERVAL_FIELD f, EVENT_DEFINITION d FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = ? AND EVENT_NAME = 'ev_expire_holds'`, [testSchemaName()]);
    expect(ev).toMatchObject({ v: '15', f: 'MINUTE' });
    expect(ev.d).toContain('sp__expire_holds_batch');
    const conn = await appConn();
    try {
      await expectErrno(conn.query(`CALL sp__expire_holds_batch(UTC_TIMESTAMP(3), @n)`), 1370);
    } finally {
      await conn.end();
    }
    await expectRule(call('sp_expire_holds', [(await account(['reader'])), vn('2026-09-01 00:00')],
      { outParams: ['p_count'] }), 'FORBIDDEN');
  });
});
