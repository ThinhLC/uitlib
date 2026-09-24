import { sql } from 'drizzle-orm';
import {
  char,
  check,
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { big, id, ts } from './common';

// Accounts, RBAC, readers and cards (data-model.md "People, identity, access").

/** Supabase user `supabase_user_id` is known to the library as account `id` (no cross-DB FK). */
export const appUsers = mysqlTable('app_users', {
  id: id(),
  supabaseUserId: char('supabase_user_id', { length: 36 }).notNull(),
  status: mysqlEnum('status', ['active', 'inactive']).notNull().default('active'),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('app_users_supabase_uq').on(t.supabaseUserId)]);

/** A security role. */
export const roles = mysqlTable('roles', {
  id: id(),
  code: varchar('code', { length: 64 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
}, (t) => [uniqueIndex('roles_code_uq').on(t.code)]);

/** A permission checked by operation procedures (fn_has_permission). */
export const permissions = mysqlTable('permissions', {
  id: id(),
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
}, (t) => [uniqueIndex('permissions_code_uq').on(t.code)]);

/** Account `user_id` holds role `role_id` (junction). */
export const userRoles = mysqlTable('user_roles', {
  userId: big('user_id').notNull(),
  roleId: big('role_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index('user_roles_role_ix').on(t.roleId),
  foreignKey({ name: 'user_roles_user_fk', columns: [t.userId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'user_roles_role_fk', columns: [t.roleId], foreignColumns: [roles.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Role `role_id` grants permission `permission_id` (junction). */
export const rolePermissions = mysqlTable('role_permissions', {
  roleId: big('role_id').notNull(),
  permissionId: big('permission_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.permissionId] }),
  index('role_permissions_permission_ix').on(t.permissionId),
  foreignKey({ name: 'role_permissions_role_fk', columns: [t.roleId], foreignColumns: [roles.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'role_permissions_permission_fk', columns: [t.permissionId], foreignColumns: [permissions.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** A borrowing category (student, lecturer, external); never a security role. */
export const readerTypes = mysqlTable('reader_types', {
  id: id(),
  code: varchar('code', { length: 32 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
}, (t) => [uniqueIndex('reader_types_code_uq').on(t.code)]);

/** Reader `id` of type `reader_type_id` may borrow from the library. */
export const readers = mysqlTable('readers', {
  id: id(),
  userId: big('user_id'),
  readerTypeId: big('reader_type_id').notNull(),
  fullName: varchar('full_name', { length: 200 }).notNull(),
  email: varchar('email', { length: 320 }),
  phone: varchar('phone', { length: 20 }),
  status: mysqlEnum('status', ['active', 'suspended', 'inactive']).notNull().default('active'),
  createdAt: ts('created_at').notNull(),
}, (t) => [
  uniqueIndex('readers_user_uq').on(t.userId),
  index('readers_type_ix').on(t.readerTypeId),
  foreignKey({ name: 'readers_user_fk', columns: [t.userId], foreignColumns: [appUsers.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'readers_type_fk', columns: [t.readerTypeId], foreignColumns: [readerTypes.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Card `card_number` was issued to reader `reader_id`, valid until `expires_at` while `active`. */
export const libraryCards = mysqlTable('library_cards', {
  id: id(),
  readerId: big('reader_id').notNull(),
  cardNumber: varchar('card_number', { length: 32 }).notNull(),
  issuedAt: ts('issued_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  status: mysqlEnum('status', ['active', 'expired', 'lost', 'revoked']).notNull(),
  createdAt: ts('created_at').notNull(),
  // At most one active card per reader (R-08c): NULL when not active, so UNIQUE ignores it.
  activeReaderId: big('active_reader_id').generatedAlwaysAs(
    sql`IF(status = 'active', reader_id, NULL)`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('library_cards_number_uq').on(t.cardNumber),
  uniqueIndex('library_cards_active_reader_uq').on(t.activeReaderId),
  index('library_cards_reader_ix').on(t.readerId),
  check('library_cards_expiry_ck', sql`expires_at > issued_at`),
  foreignKey({ name: 'library_cards_reader_fk', columns: [t.readerId], foreignColumns: [readers.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);
