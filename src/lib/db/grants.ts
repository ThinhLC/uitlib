/**
 * Declarative privileges for the application account (research R6, spec FR-026 / R-26).
 * The account name comes from DB_USER; migrations never name an account (spec FR-030).
 */

/** Tables the app account may write directly: catalog and people data with no cross-row rules. */
export const APP_WRITABLE_TABLES = [
  'books',
  'authors',
  'publishers',
  'categories',
  'book_authors',
  'book_categories',
  'book_identifiers',
  'book_external_refs',
  'readers',
  'app_users',
  'user_roles',
] as const;

/** Circulation and money tables: written only through operation procedures (R-26). */
export const PROCEDURE_ONLY_TABLES = [
  'book_copies',
  'library_cards',
  'loan_policies',
  'loans',
  'loan_items',
  'loan_renewals',
  'reservations',
  'fines',
  'fine_adjustments',
  'fine_payments',
  'fine_payment_allocations',
] as const;

/** Public routines: `fn_*` and `sp_*`, excluding internal `sp__*` helpers. */
export function isPublicRoutine(name: string): boolean {
  return (name.startsWith('fn_') || name.startsWith('sp_')) && !name.startsWith('sp__');
}
