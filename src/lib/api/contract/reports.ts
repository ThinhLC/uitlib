import { z } from 'zod';
import { Id, InstantInput, LocalMonth, PageQuery, type Instant, type Items, type Page } from './common';
import { defineEndpoint } from './endpoint';

/**
 * Contract: US7 reports and health (tasks T067). Columns follow spec 001
 * reports-and-invariants.md in camelCase; money columns carry the `Vnd` suffix (FR-005).
 */

export const CumulativeQuery = z.object({
  /** Default: the server's now. */
  asOf: InstantInput.optional(),
  readerId: Id.optional(),
});

export const RollforwardQuery = z.object({
  month: LocalMonth,
  readerId: Id.optional(),
});

export const LoansByMonthQuery = z.object({
  fromMonth: LocalMonth.optional(),
  toMonth: LocalMonth.optional(),
});

export const PopularQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/** Cumulative debt at `asOf`: `netAssessedVnd = collectedVnd + outstandingVnd`. */
export interface CumulativeRow {
  readerId: number;
  netAssessedVnd: number;
  collectedVnd: number;
  outstandingVnd: number;
}

/** Period roll-forward: `closing = opening + assessed + adjusted − collected`. */
export interface RollforwardRow {
  readerId: number;
  openingOutstandingVnd: number;
  assessedInPeriodVnd: number;
  adjustedInPeriodVnd: number;
  collectedInPeriodVnd: number;
  closingOutstandingVnd: number;
}

export interface CumulativeReport {
  asOf: Instant;
  rows: CumulativeRow[];
}

export interface RollforwardReport {
  month: string;
  /** UTC bounds `[from, to)` of the library-local month. */
  from: Instant;
  to: Instant;
  rows: RollforwardRow[];
}

/** An item past due (compared with the database wall clock). */
export interface OverdueRow {
  readerId: number;
  fullName: string;
  title: string;
  barcode: string;
  loanItemId: number;
  dueAt: Instant;
  daysLate: number;
}

export interface LoansByMonthRow {
  /** `YYYY-MM`, library-local. */
  monthLocal: string;
  readerType: string;
  loans: number;
  items: number;
}

export interface PopularBookRow {
  bookId: number;
  title: string;
  loanItems: number;
}

/** Copies of a book by status: the six counts add up to `total`. */
export interface CopyStatusRow {
  bookId: number;
  title: string;
  available: number;
  onLoan: number;
  onHold: number;
  inRepair: number;
  lost: number;
  retired: number;
  total: number;
}

/** Invariant health: every `v_inv_*` view, and those that return rows (at most 20 each). */
export interface InvariantHealth {
  views: string[];
  violations: { view: string; rows: Record<string, unknown>[] }[];
}

const reportRead = { kind: 'perm', any: ['report.read'] } as const;

export const reportEndpoints = {
  /** Cumulative debt per reader at `asOf` (`sp_report_cumulative`). `report.read`. Errors: FORBIDDEN. */
  reportCumulative: defineEndpoint<CumulativeReport>()({
    method: 'GET',
    path: '/reports/debt/cumulative',
    query: CumulativeQuery,
    access: reportRead,
    procedure: 'sp_report_cumulative',
    errors: ['FORBIDDEN'],
  }),
  /** Debt roll-forward for a library-local month (`sp_report_rollforward`). `report.read`. Errors: FORBIDDEN. */
  reportRollforward: defineEndpoint<RollforwardReport>()({
    method: 'GET',
    path: '/reports/debt/rollforward',
    query: RollforwardQuery,
    access: reportRead,
    procedure: 'sp_report_rollforward',
    errors: ['FORBIDDEN'],
  }),
  /** Overdue items (`v_report_overdue`), oldest due first. `report.read`. Errors: FORBIDDEN. */
  reportOverdue: defineEndpoint<Page<OverdueRow>>()({
    method: 'GET',
    path: '/reports/overdue',
    query: PageQuery,
    access: reportRead,
    errors: ['FORBIDDEN'],
  }),
  /** Loans per local month and reader type (`v_report_loans_by_month`). `report.read`. Errors: FORBIDDEN. */
  reportLoansByMonth: defineEndpoint<Items<LoansByMonthRow>>()({
    method: 'GET',
    path: '/reports/loans-by-month',
    query: LoansByMonthQuery,
    access: reportRead,
    errors: ['FORBIDDEN'],
  }),
  /** Most borrowed books (`v_report_popular_books`). `report.read`. Errors: FORBIDDEN. */
  reportPopularBooks: defineEndpoint<Items<PopularBookRow>>()({
    method: 'GET',
    path: '/reports/popular-books',
    query: PopularQuery,
    access: reportRead,
    errors: ['FORBIDDEN'],
  }),
  /** Copies by status per book (`v_report_copy_status`). `report.read`. Errors: FORBIDDEN. */
  reportCopyStatus: defineEndpoint<Page<CopyStatusRow>>()({
    method: 'GET',
    path: '/reports/copy-status',
    query: PageQuery,
    access: reportRead,
    errors: ['FORBIDDEN'],
  }),
  /**
   * Invariant check over every `v_inv_*` view. `report.read`. Still 200 when violations exist.
   * Errors: FORBIDDEN.
   */
  adminHealth: defineEndpoint<InvariantHealth>()({
    method: 'GET',
    path: '/admin/health',
    access: reportRead,
    errors: ['FORBIDDEN'],
  }),
};
