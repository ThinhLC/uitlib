import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Balance, Fine, Page, PageQuery, Payment } from '@/lib/api/contract';
import { fromDbTime } from '@/lib/time/db-time';
import { ApiError } from '@/server/api/errors/api-error';
import { one, paged, rows } from './sql';
import { readerExists } from './people';

async function mustExist(pool: Pool, readerId: number): Promise<void> {
  if (!(await readerExists(pool, readerId))) throw new ApiError('NOT_FOUND', 'reader');
}

const FINES_FROM = `
    FROM fines f
    JOIN loan_items li ON li.id = f.loan_item_id
    JOIN loans l ON l.id = li.loan_id
    JOIN book_copies bc ON bc.id = li.copy_id
    JOIN books b ON b.id = bc.book_id
    LEFT JOIN LATERAL (SELECT COALESCE(SUM(a.amount_vnd), 0) AS s FROM fine_adjustments a WHERE a.fine_id = f.id) adj ON TRUE
    LEFT JOIN LATERAL (SELECT COALESCE(SUM(x.amount_vnd), 0) AS s FROM fine_payment_allocations x WHERE x.fine_id = f.id) al ON TRUE
   WHERE l.reader_id = ?`;

const OPEN = ' AND f.assessed_amount_vnd + adj.s - al.s > 0';

function toFine(r: RowDataPacket): Fine {
  const assessed = Number(r.assessed_amount_vnd);
  const adjustments = Number(r.adjustments_vnd);
  const allocated = Number(r.allocated_vnd);
  const net = assessed + adjustments;
  return {
    id: Number(r.id),
    loanItemId: Number(r.loan_item_id),
    type: r.fine_type,
    defaultAmountVnd: Number(r.default_amount_vnd),
    assessedAmountVnd: assessed,
    adjustmentsVnd: adjustments,
    netVnd: net,
    allocatedVnd: allocated,
    remainingVnd: net - allocated,
    reason: r.reason,
    assessedAt: fromDbTime(r.assessed_at),
    book: { id: Number(r.book_id), title: r.title },
  };
}

/**
 * A reader's fines with their adjustment and allocation sums (one grouped query). `open` keeps
 * fines with a remaining balance. Display only; never decides a write.
 */
export async function listReaderFines(
  pool: Pool,
  readerId: number,
  f: PageQuery & { open?: boolean },
): Promise<Page<Fine>> {
  await mustExist(pool, readerId);
  const where = `${FINES_FROM}${f.open ? OPEN : ''}`;
  return paged(pool, {
    select: `SELECT f.id, f.loan_item_id, f.fine_type, f.default_amount_vnd, f.assessed_amount_vnd, f.reason,
                    f.assessed_at, b.id AS book_id, b.title, adj.s AS adjustments_vnd, al.s AS allocated_vnd
             ${where}
             ORDER BY f.assessed_at DESC, f.id DESC`,
    count: `SELECT COUNT(*) ${where}`,
    params: [readerId],
    page: f,
    map: toFine,
  });
}

/**
 * A reader's outstanding debt at `dbNow`: Σ remaining of their fines, counting only fines,
 * adjustments and payments recorded by then (the definition of `fn_reader_outstanding`).
 */
export async function readerBalance(pool: Pool, readerId: number, dbNow: string): Promise<Balance> {
  await mustExist(pool, readerId);
  const row = await one(
    pool,
    `SELECT COALESCE(SUM(f.assessed_amount_vnd + adj.s - al.s), 0) AS outstanding
       FROM fines f
       JOIN loan_items li ON li.id = f.loan_item_id
       JOIN loans l ON l.id = li.loan_id
       LEFT JOIN LATERAL (SELECT COALESCE(SUM(a.amount_vnd), 0) AS s FROM fine_adjustments a
                           WHERE a.fine_id = f.id AND a.adjusted_at <= ?) adj ON TRUE
       LEFT JOIN LATERAL (SELECT COALESCE(SUM(x.amount_vnd), 0) AS s
                            FROM fine_payment_allocations x JOIN fine_payments p ON p.id = x.payment_id
                           WHERE x.fine_id = f.id AND p.paid_at <= ?) al ON TRUE
      WHERE l.reader_id = ? AND f.assessed_at <= ?`,
    [dbNow, dbNow, readerId, dbNow],
  );
  return { readerId, outstandingVnd: Number(row?.outstanding ?? 0), asOf: fromDbTime(dbNow) };
}

/** A reader's payments, newest first, each with its allocations. */
export async function listReaderPayments(pool: Pool, readerId: number, page: PageQuery): Promise<Page<Payment>> {
  await mustExist(pool, readerId);
  const result = await paged(pool, {
    select: `SELECT id, amount_vnd, method, reference_no, paid_at, received_by_user_id
               FROM fine_payments WHERE reader_id = ? ORDER BY paid_at DESC, id DESC`,
    count: 'SELECT COUNT(*) FROM fine_payments WHERE reader_id = ?',
    params: [readerId],
    page,
    map: (r): Payment => ({
      id: Number(r.id),
      amountVnd: Number(r.amount_vnd),
      method: r.method,
      referenceNo: r.reference_no,
      paidAt: fromDbTime(r.paid_at),
      receivedBy: Number(r.received_by_user_id),
      allocations: [],
    }),
  });
  if (result.items.length) {
    const byId = new Map(result.items.map((p) => [p.id, p]));
    const allocs = await rows(
      pool,
      'SELECT payment_id, fine_id, amount_vnd FROM fine_payment_allocations WHERE payment_id IN (?) ORDER BY fine_id',
      [[...byId.keys()]],
    );
    for (const a of allocs) {
      byId.get(Number(a.payment_id))?.allocations.push({ fineId: Number(a.fine_id), amountVnd: Number(a.amount_vnd) });
    }
  }
  return result;
}
