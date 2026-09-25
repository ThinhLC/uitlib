import { categoryOf, type ErrorCategory, type ErrorKey } from '@/lib/api/contract';

export interface FieldError {
  path: string;
  message: string;
}

/** An error the API answers with (contracts/errors.md). */
export class ApiError extends Error {
  readonly category: ErrorCategory;

  constructor(
    readonly key: ErrorKey,
    readonly detail = '',
    readonly fields?: FieldError[],
  ) {
    super(`${key}${detail ? `: ${detail}` : ''}`);
    this.name = 'ApiError';
    this.category = categoryOf(key);
  }
}

export const notFound = (detail = '') => new ApiError('NOT_FOUND', detail);
export const forbidden = (permission = '') => new ApiError('FORBIDDEN', permission);
export const validation = (fields: FieldError[], detail = '') => new ApiError('VALIDATION', detail, fields);
