import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { bookCopies, books } from './catalog';
import { big, id, ts } from './common';
import { appUsers, readers } from './people';
import { loanPolicies } from './policies';

// Loans, loan items, renewals and reservations (data-model.md "Circulation").

/** Staff `processed_by_user_id` lent items to reader `reader_id` at `borrowed_at`. */
export const loans = mysqlTable('loans', {
  id: id(),
  readerId: big('reader_id').notNull(),
  processedByUserId: big('processed_by_user_id').notNull(),
  borrowedAt: ts('borrowed_at').notNull(),
  status: mysqlEnum('status', ['open', 'closed']).notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [
  index('loans_reader_status_ix').on(t.readerId, t.status),
  index('loans_reader_borrowed_ix').on(t.readerId, t.borrowedAt),
  foreignKey({ name: 'loans_reader_fk', columns: [t.readerId], foreignColumns: [readers.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'loans_processed_by_fk', columns: [t.processedByUserId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Copy `copy_id` was lent in loan `loan_id` under policy `policy_id`, due `due_at`. */
export const loanItems = mysqlTable('loan_items', {
  id: id(),
  loanId: big('loan_id').notNull(),
  copyId: big('copy_id').notNull(),
  policyId: big('policy_id').notNull(),
  borrowedAt: ts('borrowed_at').notNull(),
  dueAt: ts('due_at').notNull(),
  returnedAt: ts('returned_at'),
  returnCondition: mysqlEnum('return_condition', ['good', 'worn', 'damaged']),
  lostDeclaredAt: ts('lost_declared_at'),
  status: mysqlEnum('status', ['on_loan', 'returned', 'lost']).notNull(),
  renewalCount: smallint('renewal_count').notNull().default(0),
  appliedLoanDays: smallint('applied_loan_days').notNull(),
  appliedMaxRenewals: smallint('applied_max_renewals').notNull(),
  appliedDailyFeeVnd: big('applied_daily_fee_vnd').notNull(),
  // At most one open loan item per copy (R-12a).
  openCopyId: big('open_copy_id').generatedAlwaysAs(
    sql`IF(status = 'on_loan', copy_id, NULL)`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('loan_items_open_copy_uq').on(t.openCopyId),
  index('loan_items_copy_status_ix').on(t.copyId, t.status),
  index('loan_items_status_due_ix').on(t.status, t.dueAt),
  index('loan_items_loan_ix').on(t.loanId),
  index('loan_items_policy_borrowed_ix').on(t.policyId, t.borrowedAt),
  check('loan_items_due_ck', sql`due_at > borrowed_at`),
  check('loan_items_returned_ck', sql`returned_at IS NULL OR returned_at >= borrowed_at`),
  check('loan_items_lost_ck', sql`lost_declared_at IS NULL OR lost_declared_at >= borrowed_at`),
  check('loan_items_renewals_ck', sql`renewal_count >= 0 AND renewal_count <= applied_max_renewals`),
  check('loan_items_applied_ck',
    sql`applied_loan_days > 0 AND applied_max_renewals >= 0 AND applied_daily_fee_vnd >= 0`),
  check('loan_items_status_ck', sql`(status = 'on_loan' AND returned_at IS NULL AND return_condition IS NULL AND lost_declared_at IS NULL)
    OR (status = 'returned' AND returned_at IS NOT NULL AND return_condition IS NOT NULL AND lost_declared_at IS NULL)
    OR (status = 'lost' AND lost_declared_at IS NOT NULL AND returned_at IS NULL)`),
  foreignKey({ name: 'loan_items_loan_fk', columns: [t.loanId], foreignColumns: [loans.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'loan_items_copy_fk', columns: [t.copyId], foreignColumns: [bookCopies.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'loan_items_policy_fk', columns: [t.policyId], foreignColumns: [loanPolicies.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Loan item `loan_item_id` was extended from `old_due_at` to `new_due_at`. */
export const loanRenewals = mysqlTable('loan_renewals', {
  id: id(),
  loanItemId: big('loan_item_id').notNull(),
  oldDueAt: ts('old_due_at').notNull(),
  newDueAt: ts('new_due_at').notNull(),
  renewedAt: ts('renewed_at').notNull(),
  performedByUserId: big('performed_by_user_id').notNull(),
}, (t) => [
  index('loan_renewals_item_ix').on(t.loanItemId),
  check('loan_renewals_due_ck', sql`new_due_at > old_due_at`),
  foreignKey({ name: 'loan_renewals_item_fk', columns: [t.loanItemId], foreignColumns: [loanItems.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'loan_renewals_performed_by_fk', columns: [t.performedByUserId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Reader `reader_id` queued for book `book_id` at `requested_at` ([Ext] workflow, Core schema). */
export const reservations = mysqlTable('reservations', {
  id: id(),
  readerId: big('reader_id').notNull(),
  bookId: big('book_id').notNull(),
  requestedAt: ts('requested_at').notNull(),
  status: mysqlEnum('status', ['waiting', 'ready', 'fulfilled', 'cancelled', 'expired']).notNull(),
  assignedCopyId: big('assigned_copy_id'),
  readyAt: ts('ready_at'),
  holdExpiresAt: ts('hold_expires_at'),
  fulfilledLoanItemId: big('fulfilled_loan_item_id'),
  closedAt: ts('closed_at'),
  closeReason: varchar('close_reason', { length: 64 }),
  closedByKind: mysqlEnum('closed_by_kind', ['staff', 'reader', 'system']),
  closedByUserId: big('closed_by_user_id'),
  // At most one waiting/ready reservation per reader and book (R-14a).
  activeFlag: tinyint('active_flag').generatedAlwaysAs(
    sql`IF(status IN ('waiting', 'ready'), 1, NULL)`, { mode: 'stored' }),
  // A copy is held by at most one ready reservation (R-14d).
  readyCopyId: big('ready_copy_id').generatedAlwaysAs(
    sql`IF(status = 'ready', assigned_copy_id, NULL)`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('reservations_active_uq').on(t.readerId, t.bookId, t.activeFlag),
  uniqueIndex('reservations_ready_copy_uq').on(t.readyCopyId),
  uniqueIndex('reservations_fulfilled_item_uq').on(t.fulfilledLoanItemId),
  index('reservations_queue_ix').on(t.bookId, t.status, t.requestedAt, t.id),
  check('reservations_ready_ck',
    sql`status <> 'ready' OR (assigned_copy_id IS NOT NULL AND ready_at IS NOT NULL AND hold_expires_at IS NOT NULL AND hold_expires_at > ready_at)`),
  check('reservations_fulfilled_ck', sql`status <> 'fulfilled' OR fulfilled_loan_item_id IS NOT NULL`),
  check('reservations_closed_ck',
    sql`status NOT IN ('cancelled', 'expired', 'fulfilled') OR closed_at IS NOT NULL`),
  foreignKey({ name: 'reservations_reader_fk', columns: [t.readerId], foreignColumns: [readers.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'reservations_book_fk', columns: [t.bookId], foreignColumns: [books.id] })
    .onDelete('restrict').onUpdate('restrict'),
  // The held copy must belong to the reserved book (R-14c).
  foreignKey({
    name: 'reservations_copy_book_fk',
    columns: [t.assignedCopyId, t.bookId],
    foreignColumns: [bookCopies.id, bookCopies.bookId],
  }).onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'reservations_fulfilled_item_fk', columns: [t.fulfilledLoanItemId], foreignColumns: [loanItems.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'reservations_closed_by_fk', columns: [t.closedByUserId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);
