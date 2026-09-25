import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Page, PageQuery, Reservation, ReservationStatus } from '@/lib/api/contract';
import { fromDbTime } from '@/lib/time/db-time';
import { toNumberOrNull } from '@/lib/utils';
import { one, paged } from './sql';

/**
 * Reservation columns plus `queue_position`: ROW_NUMBER over the book's `waiting` rows in queue
 * order (requested_at, id), computed before any filter so a filtered list keeps true positions.
 */
const SELECT = `
  SELECT r.id, r.reader_id, r.book_id, b.title, r.status, r.requested_at, q.queue_position,
         r.ready_at, r.hold_expires_at, r.assigned_copy_id, r.closed_at, r.close_reason
    FROM reservations r
    JOIN books b ON b.id = r.book_id
    LEFT JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY book_id ORDER BY requested_at, id) AS queue_position
                 FROM reservations WHERE status = 'waiting') q ON q.id = r.id`;

const FROM_COUNT = `SELECT COUNT(*) n FROM reservations r`;

function toReservation(r: RowDataPacket): Reservation {
  return {
    id: Number(r.id),
    readerId: Number(r.reader_id),
    book: { id: Number(r.book_id), title: String(r.title) },
    status: r.status as ReservationStatus,
    requestedAt: fromDbTime(String(r.requested_at)),
    queuePosition: toNumberOrNull(r.queue_position),
    readyAt: fromDbTime(r.ready_at),
    holdExpiresAt: fromDbTime(r.hold_expires_at),
    assignedCopyId: toNumberOrNull(r.assigned_copy_id),
    closedAt: fromDbTime(r.closed_at),
    closeReason: r.close_reason ?? null,
  };
}

/** One reservation, or null. */
export async function getReservation(pool: Pool, id: number): Promise<Reservation | null> {
  const row = await one(pool, `${SELECT} WHERE r.id = ?`, [id]);
  return row ? toReservation(row) : null;
}

/** True when the reader exists. */
export async function readerExists(pool: Pool, readerId: number): Promise<boolean> {
  const row = await one(pool, `SELECT 1 FROM readers WHERE id = ?`, [readerId]);
  return Boolean(row);
}

/** A reader's reservations, newest first. */
export function listReaderReservations(
  pool: Pool,
  readerId: number,
  q: PageQuery & { status?: ReservationStatus },
): Promise<Page<Reservation>> {
  const where = ['r.reader_id = ?'];
  const params: unknown[] = [readerId];
  if (q.status) {
    where.push('r.status = ?');
    params.push(q.status);
  }
  const w = ` WHERE ${where.join(' AND ')}`;
  return paged(pool, {
    select: `${SELECT}${w} ORDER BY r.requested_at DESC, r.id DESC`,
    count: `${FROM_COUNT}${w}`,
    params,
    page: q,
    map: toReservation,
  });
}

/** Every reservation (staff), in queue order: oldest request first. */
export function listReservations(
  pool: Pool,
  q: PageQuery & { status?: ReservationStatus; bookId?: number },
): Promise<Page<Reservation>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status) {
    where.push('r.status = ?');
    params.push(q.status);
  }
  if (q.bookId) {
    where.push('r.book_id = ?');
    params.push(q.bookId);
  }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  return paged(pool, {
    select: `${SELECT}${w} ORDER BY r.requested_at, r.id`,
    count: `${FROM_COUNT}${w}`,
    params,
    page: q,
    map: toReservation,
  });
}
