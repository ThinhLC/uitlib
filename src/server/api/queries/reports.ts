import type { Pool } from 'mysql2/promise';
import type {
  CopyStatusRow,
  InvariantHealth,
  Items,
  LoansByMonthRow,
  OverdueRow,
  Page,
  PageQuery,
  PopularBookRow,
} from '@/lib/api/contract';
import { findViolations, listInvariantViews } from '@/lib/db/invariants';
import { fromDbTime } from '@/lib/time/db-time';
import { paged, rows } from './sql';

/** v_report_overdue, oldest due first. */
export function overdue(pool: Pool, page: PageQuery): Promise<Page<OverdueRow>> {
  return paged(pool, {
    select: `SELECT * FROM v_report_overdue ORDER BY due_at, loan_item_id`,
    count: `SELECT COUNT(*) n FROM v_report_overdue`,
    params: [],
    page,
    map: (r) => ({
      readerId: Number(r.reader_id),
      fullName: String(r.full_name),
      title: String(r.title),
      barcode: String(r.barcode),
      loanItemId: Number(r.loan_item_id),
      dueAt: fromDbTime(String(r.due_at)),
      daysLate: Number(r.days_late),
    }),
  });
}

/** v_report_loans_by_month, optionally between two local months (inclusive). */
export async function loansByMonth(pool: Pool, q: { fromMonth?: string; toMonth?: string }): Promise<Items<LoansByMonthRow>> {
  const where: string[] = [];
  const params: string[] = [];
  if (q.fromMonth) {
    where.push('month_local >= ?');
    params.push(q.fromMonth);
  }
  if (q.toMonth) {
    where.push('month_local <= ?');
    params.push(q.toMonth);
  }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const found = await rows(pool, `SELECT * FROM v_report_loans_by_month${w} ORDER BY month_local, reader_type`, params);
  return {
    items: found.map((r) => ({
      monthLocal: String(r.month_local),
      readerType: String(r.reader_type),
      loans: Number(r.loans),
      items: Number(r.items),
    })),
  };
}

/** v_report_popular_books, most borrowed first. */
export async function popularBooks(pool: Pool, limit: number): Promise<Items<PopularBookRow>> {
  const found = await rows(pool, `SELECT * FROM v_report_popular_books ORDER BY loan_items DESC, book_id LIMIT ?`, [limit]);
  return { items: found.map((r) => ({ bookId: Number(r.book_id), title: String(r.title), loanItems: Number(r.loan_items) })) };
}

/** v_report_copy_status by book. */
export function copyStatus(pool: Pool, page: PageQuery): Promise<Page<CopyStatusRow>> {
  return paged(pool, {
    select: `SELECT * FROM v_report_copy_status ORDER BY book_id`,
    count: `SELECT COUNT(*) n FROM v_report_copy_status`,
    params: [],
    page,
    map: (r) => ({
      bookId: Number(r.book_id),
      title: String(r.title),
      available: Number(r.available),
      onLoan: Number(r.on_loan),
      onHold: Number(r.on_hold),
      inRepair: Number(r.in_repair),
      lost: Number(r.lost),
      retired: Number(r.retired),
      total: Number(r.total),
    }),
  });
}

/** Every invariant view and the ones with rows (spec 001 I-1…I-9). */
export async function health(pool: Pool): Promise<InvariantHealth> {
  const [views, violations] = await Promise.all([listInvariantViews(pool), findViolations(pool)]);
  return { views, violations };
}
