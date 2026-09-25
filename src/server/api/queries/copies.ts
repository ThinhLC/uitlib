import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Copy } from '@/lib/api/contract';
import { fromDbTime } from '@/lib/time/db-time';
import { notFound } from '@/server/api/errors/api-error';
import { mapNullable } from '@/lib/utils';
import { one, rows } from './sql';

/** Copy columns plus the ready reservation holding it (`heldFor`). */
const COPY_SELECT = `SELECT c.id, c.book_id, c.barcode, c.shelf_code, c.acquired_at, c.physical_condition,
       c.circulation_status, r.id AS reservation_id, r.reader_id, r.hold_expires_at
  FROM book_copies c
  LEFT JOIN reservations r ON r.ready_copy_id = c.id`;

/** A `book_copies` row (with the hold columns of COPY_SELECT) as the staff Copy resource. */
export function toCopy(r: RowDataPacket): Copy {
  return {
    id: Number(r.id),
    bookId: Number(r.book_id),
    barcode: r.barcode,
    shelfCode: r.shelf_code,
    acquiredAt: r.acquired_at,
    physicalCondition: r.physical_condition,
    circulationStatus: r.circulation_status,
    heldFor: mapNullable(r.reservation_id, (reservationId) => ({
      reservationId: Number(reservationId),
      readerId: Number(r.reader_id),
      holdExpiresAt: fromDbTime(r.hold_expires_at),
    })),
  };
}

/** One copy; NOT_FOUND `copy` when missing. */
export async function getCopy(pool: Pool, id: number): Promise<Copy> {
  const r = await one(pool, `${COPY_SELECT} WHERE c.id = ?`, [id]);
  if (!r) throw notFound('copy');
  return toCopy(r);
}

/** Every copy of a book, by id; NOT_FOUND `book` when the book does not exist. */
export async function listCopies(pool: Pool, bookId: number): Promise<Copy[]> {
  if (!(await one(pool, `SELECT id FROM books WHERE id = ?`, [bookId]))) throw notFound('book');
  return (await rows(pool, `${COPY_SELECT} WHERE c.book_id = ? ORDER BY c.id`, [bookId])).map(toCopy);
}
