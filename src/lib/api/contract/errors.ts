/**
 * Error keys, categories and messages of the API (specs/002-library-api/contracts/errors.md).
 * Clients branch on `key`, never on `message`.
 */

/** Keys raised by the spec 001 database (SIGNAL 45000, or 1062 reported as DUPLICATE). */
export const DB_ERROR_KEYS = [
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'COPY_NOT_AVAILABLE',
  'READER_NOT_ACTIVE',
  'CARD_INVALID',
  'DEBT_BLOCKED',
  'OVERDUE_BLOCKED',
  'LIMIT_REACHED',
  'NO_POLICY',
  'RENEWAL_REJECTED',
  'INVALID_TRANSITION',
  'POLICY_OVERLAP',
  'POLICY_CLOSE_REJECTED',
  'POLICY_IMMUTABLE',
  'SNAPSHOT_IMMUTABLE',
  'APPEND_ONLY',
  'COPY_STATE',
  'FINE_RULE',
  'ALLOCATION_MISMATCH',
  'PAYMENT_EXCEEDS_DEBT',
  'DUPLICATE',
  'IDEMPOTENCY_CONFLICT',
] as const;

/** Keys raised by the API layer itself. */
export const API_ERROR_KEYS = [
  'UNAUTHENTICATED',
  'ACCOUNT_INACTIVE',
  'ROUTE_NOT_FOUND',
  'BUSY',
  'AUTH_UNAVAILABLE',
  'INTERNAL',
] as const;

export const ERROR_KEYS = [...DB_ERROR_KEYS, ...API_ERROR_KEYS] as const;
export type ErrorKey = (typeof ERROR_KEYS)[number];

export type ErrorCategory =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'busy'
  | 'unavailable'
  | 'internal';

export const ERROR_CATEGORY: Record<ErrorKey, ErrorCategory> = {
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  ACCOUNT_INACTIVE: 'forbidden',
  NOT_FOUND: 'not_found',
  ROUTE_NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  COPY_NOT_AVAILABLE: 'conflict',
  READER_NOT_ACTIVE: 'conflict',
  CARD_INVALID: 'conflict',
  DEBT_BLOCKED: 'conflict',
  OVERDUE_BLOCKED: 'conflict',
  LIMIT_REACHED: 'conflict',
  NO_POLICY: 'conflict',
  RENEWAL_REJECTED: 'conflict',
  INVALID_TRANSITION: 'conflict',
  POLICY_OVERLAP: 'conflict',
  POLICY_CLOSE_REJECTED: 'conflict',
  POLICY_IMMUTABLE: 'conflict',
  SNAPSHOT_IMMUTABLE: 'conflict',
  APPEND_ONLY: 'conflict',
  COPY_STATE: 'conflict',
  FINE_RULE: 'conflict',
  ALLOCATION_MISMATCH: 'conflict',
  PAYMENT_EXCEEDS_DEBT: 'conflict',
  DUPLICATE: 'conflict',
  IDEMPOTENCY_CONFLICT: 'conflict',
  BUSY: 'busy',
  AUTH_UNAVAILABLE: 'unavailable',
  INTERNAL: 'internal',
};

export const CATEGORY_STATUS: Record<ErrorCategory, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  busy: 503,
  unavailable: 503,
  internal: 500,
};

/** Category of any key; a 45000 key the contract does not know yet is a conflict. */
export function categoryOf(key: string): ErrorCategory {
  return (ERROR_CATEGORY as Record<string, ErrorCategory>)[key] ?? 'conflict';
}

export const ERROR_MESSAGES: Record<ErrorKey, string> = {
  UNAUTHENTICATED: 'Sign in to continue.',
  ACCOUNT_INACTIVE: 'This account is inactive.',
  FORBIDDEN: 'You do not have permission for this action.',
  NOT_FOUND: 'The record was not found.',
  ROUTE_NOT_FOUND: 'Unknown API route.',
  VALIDATION: 'The request is invalid.',
  COPY_NOT_AVAILABLE: 'A requested copy is not available.',
  READER_NOT_ACTIVE: 'The reader is not active.',
  CARD_INVALID: 'The reader has no valid library card.',
  DEBT_BLOCKED: 'The reader owes more than the allowed amount.',
  OVERDUE_BLOCKED: 'The reader has an overdue item.',
  LIMIT_REACHED: 'The reader has reached the item limit.',
  NO_POLICY: 'No loan policy applies to this reader and material.',
  RENEWAL_REJECTED: 'The item cannot be renewed.',
  INVALID_TRANSITION: 'This status change is not allowed.',
  POLICY_OVERLAP: 'The policy version overlaps another version.',
  POLICY_CLOSE_REJECTED: 'The policy version cannot be closed at that time.',
  POLICY_IMMUTABLE: 'Policy values cannot be changed.',
  SNAPSHOT_IMMUTABLE: 'Loan item history cannot be changed.',
  APPEND_ONLY: 'Money records cannot be changed or deleted.',
  COPY_STATE: 'The copy status is inconsistent; contact an administrator.',
  FINE_RULE: 'The fine amount or reason is not allowed.',
  ALLOCATION_MISMATCH: 'The payment allocations do not match.',
  PAYMENT_EXCEEDS_DEBT: 'The payment is larger than what the reader owes.',
  DUPLICATE: 'A record with the same unique value already exists.',
  IDEMPOTENCY_CONFLICT: 'This payment request key was already used with different content.',
  BUSY: 'The library is busy; please retry.',
  AUTH_UNAVAILABLE: 'Sign-in service is unavailable; please retry.',
  INTERNAL: 'Something went wrong.',
};

/** Messages that depend on the detail (renewal reason, unique index name). */
export const DETAIL_MESSAGES: Partial<Record<ErrorKey, Record<string, string>>> = {
  RENEWAL_REJECTED: {
    not_on_loan: 'The item is not on loan.',
    overdue: 'Overdue items cannot be renewed.',
    limit: 'The renewal limit has been reached.',
    reserved: 'Another reader is waiting for this book.',
  },
  DUPLICATE: {
    book_copies_barcode_uq: 'Barcode already in use.',
    library_cards_number_uq: 'Card number already in use.',
    library_cards_active_reader_uq: 'Reader already has an active card.',
    reservations_active_uq: 'Reader already has an active reservation for this book.',
    readers_user_uq: 'This account is already linked to a reader.',
    book_identifiers_uq: 'The book already has this identifier.',
    categories_parent_name_uq: 'A category with this name already exists under the same parent.',
  },
};

/** The message shown for a key and detail. */
export function messageFor(key: string, detail = ''): string {
  const byDetail = DETAIL_MESSAGES[key as ErrorKey];
  const first = detail.split(/[\s:]/)[0];
  return byDetail?.[detail] ?? byDetail?.[first] ?? ERROR_MESSAGES[key as ErrorKey] ?? ERROR_MESSAGES.VALIDATION;
}

export interface ApiErrorBody {
  error: {
    key: ErrorKey | (string & {});
    category: ErrorCategory;
    message: string;
    detail: string;
    fields?: { path: string; message: string }[];
    requestId: string;
  };
}
