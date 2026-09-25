import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  CardScan,
  CardStatus,
  CirculationStatus,
  CopyCondition,
  CopyScan,
  FineRef,
  FineType,
  LoanItem,
  LoanItemStatus,
  Page,
  PageQuery,
  ReaderStatus,
} from '@/lib/api/contract';
import { fromDbTime } from '@/lib/time/db-time';
import { isNil, mapNullable, toNumberOrNull } from '@/lib/utils';
import { one, paged, rows } from './sql';

export interface LoanItemFilter extends PageQuery {
  status?: LoanItemStatus;
  overdue?: boolean;
}

/**
 * A reader's loan items, newest first (`borrowed_at DESC, id DESC`), with their fines.
 * `overdue` means `on_loan` with `due_at < now`. `withBarcode` is false for the reader's own view.
 */
export async function listReaderLoanItems(
  pool: Pool,
  readerId: number,
  now: string,
  filter: LoanItemFilter,
  withBarcode: boolean,
): Promise<Page<LoanItem>> {
  const where = ['l.reader_id = ?'];
  const params: unknown[] = [readerId];
  if (filter.status) {
    where.push('li.status = ?');
    params.push(filter.status);
  }
  if (!isNil(filter.overdue)) {
    where.push(filter.overdue ? "(li.status = 'on_loan' AND li.due_at < ?)" : "NOT (li.status = 'on_loan' AND li.due_at < ?)");
    params.push(now);
  }
  const from = `FROM loan_items li
      JOIN loans l ON l.id = li.loan_id
      JOIN book_copies c ON c.id = li.copy_id
      JOIN books b ON b.id = c.book_id
     WHERE ${where.join(' AND ')}`;
  const page = await paged(pool, {
    select: `SELECT li.id, li.loan_id, li.copy_id, c.barcode, b.id AS book_id, b.title, li.borrowed_at, li.due_at,
                    li.status, li.returned_at, li.return_condition, li.renewal_count, li.applied_max_renewals
             ${from}
             ORDER BY li.borrowed_at DESC, li.id DESC`,
    count: `SELECT COUNT(*) AS n ${from}`,
    params,
    page: filter,
    map: (r): LoanItem => ({
      id: Number(r.id),
      loanId: Number(r.loan_id),
      copy: withBarcode ? { id: Number(r.copy_id), barcode: String(r.barcode) } : { id: Number(r.copy_id) },
      book: { id: Number(r.book_id), title: String(r.title) },
      borrowedAt: fromDbTime(String(r.borrowed_at)),
      dueAt: fromDbTime(String(r.due_at)),
      status: r.status as LoanItemStatus,
      returnedAt: fromDbTime(r.returned_at as string | null),
      returnCondition: (r.return_condition ?? null) as CopyCondition | null,
      renewalCount: Number(r.renewal_count),
      maxRenewals: Number(r.applied_max_renewals),
      // Both sides are DATETIME(3) UTC text, so text order is time order.
      overdue: r.status === 'on_loan' && String(r.due_at) < now,
      fines: [],
    }),
  });
  if (page.items.length) {
    const fines = await rows(
      pool,
      `SELECT id, loan_item_id, fine_type, assessed_amount_vnd FROM fines WHERE loan_item_id IN (?) ORDER BY id`,
      [page.items.map((i) => i.id)],
    );
    const byItem = new Map<number, FineRef[]>();
    for (const f of fines) {
      const list = byItem.get(Number(f.loan_item_id)) ?? [];
      list.push({ id: Number(f.id), type: f.fine_type as FineType, amountVnd: Number(f.assessed_amount_vnd) });
      byItem.set(Number(f.loan_item_id), list);
    }
    for (const item of page.items) item.fines = byItem.get(item.id) ?? [];
  }
  return page;
}

/** True when the reader exists. */
export async function readerExists(pool: Pool, readerId: number): Promise<boolean> {
  return !isNil(await one(pool, 'SELECT id FROM readers WHERE id = ?', [readerId]));
}

/** A copy by barcode, with its open loan item and ready hold; null when unknown. */
export async function copyByBarcode(pool: Pool, barcode: string): Promise<CopyScan | null> {
  const r = await one(
    pool,
    `SELECT c.id, c.book_id, c.barcode, c.shelf_code, c.acquired_at, c.physical_condition, c.circulation_status,
            li.id AS open_loan_item_id, rs.id AS reservation_id, rs.reader_id AS hold_reader_id, rs.hold_expires_at
       FROM book_copies c
       LEFT JOIN loan_items li ON li.open_copy_id = c.id
       LEFT JOIN reservations rs ON rs.ready_copy_id = c.id
      WHERE c.barcode = ?`,
    [barcode],
  );
  if (!r) return null;
  return {
    id: Number(r.id),
    bookId: Number(r.book_id),
    barcode: String(r.barcode),
    shelfCode: r.shelf_code ?? null,
    acquiredAt: fromDbTime(r.acquired_at as string | null),
    physicalCondition: r.physical_condition as CopyCondition,
    circulationStatus: r.circulation_status as CirculationStatus,
    heldFor: mapNullable(r.reservation_id, (reservationId) => ({
      reservationId: Number(reservationId),
      readerId: Number(r.hold_reader_id),
      holdExpiresAt: fromDbTime(String(r.hold_expires_at)),
    })),
    openLoanItemId: toNumberOrNull(r.open_loan_item_id),
  };
}

/** A card by number with its reader; null when unknown. `validNow` is judged at `now`. */
export async function cardByNumber(pool: Pool, cardNumber: string, now: string): Promise<CardScan | null> {
  const r: RowDataPacket | null = await one(
    pool,
    `SELECT k.id, k.reader_id, k.card_number, k.issued_at, k.expires_at, k.status,
            (k.status = 'active' AND k.expires_at > ?) AS valid_now,
            r.full_name, r.email, r.phone, rt.code AS reader_type, r.status AS reader_status, r.user_id, r.created_at
       FROM library_cards k
       JOIN readers r ON r.id = k.reader_id
       JOIN reader_types rt ON rt.id = r.reader_type_id
      WHERE k.card_number = ?`,
    [now, cardNumber],
  );
  if (!r) return null;
  return {
    id: Number(r.id),
    readerId: Number(r.reader_id),
    cardNumber: String(r.card_number),
    issuedAt: fromDbTime(String(r.issued_at)),
    expiresAt: fromDbTime(String(r.expires_at)),
    status: r.status as CardStatus,
    validNow: Number(r.valid_now) === 1,
    reader: {
      id: Number(r.reader_id),
      fullName: String(r.full_name),
      email: r.email ?? null,
      phone: r.phone ?? null,
      readerType: String(r.reader_type),
      status: r.reader_status as ReaderStatus,
      accountId: toNumberOrNull(r.user_id),
      createdAt: fromDbTime(String(r.created_at)),
    },
  };
}
