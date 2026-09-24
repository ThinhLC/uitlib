import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { loanItems } from './circulation';
import { big, id, ts } from './common';
import { appUsers, readers } from './people';

// Fines, adjustments, payments and allocations (data-model.md "Fines and payments").
// Money rows are append-only (triggers); balances are always derived (FR-018).

/** Loan item `loan_item_id` incurred a `fine_type` fine of `assessed_amount_vnd`. */
export const fines = mysqlTable('fines', {
  id: id(),
  loanItemId: big('loan_item_id').notNull(),
  fineType: mysqlEnum('fine_type', ['late', 'damaged', 'lost']).notNull(),
  defaultAmountVnd: big('default_amount_vnd').notNull(),
  assessedAmountVnd: big('assessed_amount_vnd').notNull(),
  reason: varchar('reason', { length: 500 }),
  assessedAt: ts('assessed_at').notNull(),
  assessedByUserId: big('assessed_by_user_id').notNull(),
}, (t) => [
  uniqueIndex('fines_item_type_uq').on(t.loanItemId, t.fineType),
  index('fines_assessed_at_ix').on(t.assessedAt),
  check('fines_amounts_ck', sql`default_amount_vnd >= 0 AND assessed_amount_vnd >= 0`),
  check('fines_reason_ck',
    sql`assessed_amount_vnd = default_amount_vnd OR (reason IS NOT NULL AND CHAR_LENGTH(TRIM(reason)) > 0)`),
  foreignKey({ name: 'fines_item_fk', columns: [t.loanItemId], foreignColumns: [loanItems.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'fines_assessed_by_fk', columns: [t.assessedByUserId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** An audited, signed correction to fine `fine_id` (FR-017). */
export const fineAdjustments = mysqlTable('fine_adjustments', {
  id: id(),
  fineId: big('fine_id').notNull(),
  amountVnd: big('amount_vnd').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  adjustedByUserId: big('adjusted_by_user_id').notNull(),
  adjustedAt: ts('adjusted_at').notNull(),
}, (t) => [
  index('fine_adjustments_fine_ix').on(t.fineId),
  index('fine_adjustments_adjusted_at_ix').on(t.adjustedAt),
  check('fine_adjustments_amount_ck', sql`amount_vnd <> 0`),
  check('fine_adjustments_reason_ck', sql`CHAR_LENGTH(TRIM(reason)) > 0`),
  foreignKey({ name: 'fine_adjustments_fine_fk', columns: [t.fineId], foreignColumns: [fines.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'fine_adjustments_by_fk', columns: [t.adjustedByUserId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Staff `received_by_user_id` received `amount_vnd` from reader `reader_id`, fully allocated. */
export const finePayments = mysqlTable('fine_payments', {
  id: id(),
  readerId: big('reader_id').notNull(),
  receivedByUserId: big('received_by_user_id').notNull(),
  amountVnd: big('amount_vnd').notNull(),
  paidAt: ts('paid_at').notNull(),
  method: mysqlEnum('method', ['cash', 'bank_transfer']).notNull(),
  referenceNo: varchar('reference_no', { length: 64 }),
  requestKey: varchar('request_key', { length: 64 }).notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [
  uniqueIndex('fine_payments_request_key_uq').on(t.requestKey),
  index('fine_payments_reader_paid_ix').on(t.readerId, t.paidAt),
  index('fine_payments_paid_ix').on(t.paidAt),
  check('fine_payments_amount_ck', sql`amount_vnd > 0`),
  foreignKey({ name: 'fine_payments_reader_fk', columns: [t.readerId], foreignColumns: [readers.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'fine_payments_received_by_fk', columns: [t.receivedByUserId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Payment `payment_id` settles `amount_vnd` of fine `fine_id` (junction). */
export const finePaymentAllocations = mysqlTable('fine_payment_allocations', {
  paymentId: big('payment_id').notNull(),
  fineId: big('fine_id').notNull(),
  amountVnd: big('amount_vnd').notNull(),
}, (t) => [
  primaryKey({ columns: [t.paymentId, t.fineId] }),
  index('fine_payment_allocations_fine_ix').on(t.fineId),
  check('fine_payment_allocations_amount_ck', sql`amount_vnd > 0`),
  foreignKey({ name: 'fine_payment_allocations_payment_fk', columns: [t.paymentId], foreignColumns: [finePayments.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'fine_payment_allocations_fine_fk', columns: [t.fineId], foreignColumns: [fines.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);
