import { afterAll, beforeEach, describe, it } from 'vitest';
import { closeTestPools, expectErrno, ownerQuery } from '../helpers/db';
import { admin, book, copy, reader, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { rawFixture } from '../helpers/invariants-after-each';

afterAll(closeTestPools);
beforeEach(truncateAll);

const T = vn('2026-09-10 10:00');

async function insert(r: Record<string, unknown>) {
  const cols = Object.keys(r);
  return ownerQuery(
    `INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(r));
}

describe('RS-1 reservation schema constraints, Core without workflow (T049)', () => {
  it('R-14a/b/c/d: the database rejects invalid reservation rows', async () => {
    rawFixture(); // builds loan/reservation rows directly as the owner
    const staff = await admin();
    const bookA = await book();
    const bookB = await book();
    const copyA = await copy(staff, T, bookA);
    const copyB = await copy(staff, T, bookB);
    const r1 = await reader();
    const r2 = await reader();
    const base = { reader_id: r1, book_id: bookA, requested_at: T };

    // R-14a: one waiting/ready reservation per reader and book
    await insert({ ...base, status: 'waiting' });
    await expectErrno(insert({ ...base, status: 'waiting' }), 1062);
    // closed duplicates are allowed
    await insert({ ...base, status: 'cancelled', closed_at: T });
    await insert({ ...base, status: 'expired', closed_at: T });

    // R-14b: ready needs an assigned copy and a hold expiry after ready_at
    await expectErrno(insert({ reader_id: r2, book_id: bookA, requested_at: T, status: 'ready', ready_at: T,
      hold_expires_at: vn('2026-09-13 10:00') }), 3819);
    await expectErrno(insert({ reader_id: r2, book_id: bookA, requested_at: T, status: 'ready', ready_at: T,
      assigned_copy_id: copyA }), 3819);

    // R-14c: the held copy must belong to the reserved book
    await expectErrno(insert({ reader_id: r2, book_id: bookA, requested_at: T, status: 'ready', ready_at: T,
      assigned_copy_id: copyB, hold_expires_at: vn('2026-09-13 10:00') }), 1452);

    // R-14d: a copy is held by at most one ready reservation
    await insert({ reader_id: r2, book_id: bookA, requested_at: T, status: 'ready', ready_at: T,
      assigned_copy_id: copyA, hold_expires_at: vn('2026-09-13 10:00') });
    const r3 = await reader();
    await expectErrno(insert({ reader_id: r3, book_id: bookA, requested_at: T, status: 'ready', ready_at: T,
      assigned_copy_id: copyA, hold_expires_at: vn('2026-09-13 10:00') }), 1062);

    // closed reservations need closed_at
    await expectErrno(insert({ reader_id: r3, book_id: bookB, requested_at: T, status: 'cancelled' }), 3819);
  });
});
