import { sql } from 'drizzle-orm';
import { check, foreignKey, index, mysqlTable, smallint } from 'drizzle-orm/mysql-core';
import { materialTypes } from './catalog';
import { big, id, ts } from './common';
import { appUsers, readerTypes } from './people';

/**
 * Between `valid_from` (inclusive) and `valid_to` (exclusive), readers of type `reader_type_id`
 * borrowing material `material_type_id` follow these values (FR-009). Business values are
 * immutable (trg_loan_policies_bu); versions of one pair never overlap (sp + trg guard).
 */
export const loanPolicies = mysqlTable('loan_policies', {
  id: id(),
  readerTypeId: big('reader_type_id').notNull(),
  materialTypeId: big('material_type_id').notNull(),
  maxActiveItems: smallint('max_active_items').notNull(),
  loanDays: smallint('loan_days').notNull(),
  maxRenewals: smallint('max_renewals').notNull(),
  dailyLateFeeVnd: big('daily_late_fee_vnd').notNull(),
  debtBlockThresholdVnd: big('debt_block_threshold_vnd').notNull(),
  validFrom: ts('valid_from').notNull(),
  validTo: ts('valid_to'),
  createdByUserId: big('created_by_user_id').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [
  index('loan_policies_pair_from_ix').on(t.readerTypeId, t.materialTypeId, t.validFrom),
  check('loan_policies_max_items_ck', sql`max_active_items > 0`),
  check('loan_policies_loan_days_ck', sql`loan_days > 0`),
  check('loan_policies_max_renewals_ck', sql`max_renewals >= 0`),
  check('loan_policies_fee_ck', sql`daily_late_fee_vnd >= 0`),
  check('loan_policies_threshold_ck', sql`debt_block_threshold_vnd >= 0`),
  check('loan_policies_period_ck', sql`valid_to IS NULL OR valid_to > valid_from`),
  foreignKey({ name: 'loan_policies_reader_type_fk', columns: [t.readerTypeId], foreignColumns: [readerTypes.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'loan_policies_material_type_fk', columns: [t.materialTypeId], foreignColumns: [materialTypes.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'loan_policies_created_by_fk', columns: [t.createdByUserId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);
