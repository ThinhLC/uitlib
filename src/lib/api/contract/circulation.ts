import { z } from 'zod';
import { Id, Money, PageQuery, type Instant, type Page } from './common';
import { defineEndpoint } from './endpoint';
import type { BookRef, Card, Copy, CopyCondition, FineRef, LoanItemStatus, Reader } from './resources';

/** Contract: US2 circulation desk (data-model.md "Circulation"). */

export const CheckoutInput = z.strictObject({
  readerId: Id,
  copyIds: z
    .array(Id)
    .min(1)
    .max(20)
    .refine((xs) => new Set(xs).size === xs.length, 'copy ids must be distinct'),
});

export interface CheckoutResult {
  loanId: number;
  items: { loanItemId: number; copyId: number; dueAt: Instant }[];
}

export const ReturnInput = z.strictObject({
  condition: z.enum(['good', 'worn', 'damaged']),
  damagedFineVnd: Money.optional(),
  reason: z.string().trim().max(255).optional(),
});

export const LostInput = z.strictObject({
  lostFineVnd: Money.optional(),
  reason: z.string().trim().max(255).optional(),
});

/** Fines assessed by a return or a lost declaration. */
export interface FinesResult {
  fines: FineRef[];
}

export interface RenewResult {
  loanItemId: number;
  newDueAt: Instant;
}

/** A loan item. The reader's own view omits `copy.barcode`. */
export interface LoanItem {
  id: number;
  loanId: number;
  copy: { id: number; barcode?: string };
  book: BookRef;
  borrowedAt: Instant;
  dueAt: Instant;
  status: LoanItemStatus;
  returnedAt: Instant | null;
  returnCondition: CopyCondition | null;
  renewalCount: number;
  maxRenewals: number;
  /** `on_loan` and `dueAt` before the server's now. */
  overdue: boolean;
  fines: FineRef[];
}

export const LoanItemsQuery = PageQuery.extend({
  status: z.enum(['on_loan', 'returned', 'lost']).optional(),
  overdue: z.stringbool().optional(),
});

/** Desk scan of a copy: the copy plus its open loan item, if any. */
export type CopyScan = Copy & { openLoanItemId: number | null };

/** Desk scan of a card: the card plus its reader. */
export type CardScan = Card & { reader: Omit<Reader, 'activeCard'> };

const LoanItemParam = z.object({ loanItemId: Id });

export const circulationEndpoints = {
  /**
   * Lend 1–20 copies to a reader in one loan (201). Access: `loan.checkout`.
   * Errors: FORBIDDEN, NOT_FOUND (reader, copy), VALIDATION, READER_NOT_ACTIVE, CARD_INVALID,
   * COPY_NOT_AVAILABLE, NO_POLICY, DEBT_BLOCKED, OVERDUE_BLOCKED, LIMIT_REACHED, COPY_STATE.
   */
  checkout: defineEndpoint<CheckoutResult>()({
    method: 'POST',
    path: '/loans',
    body: CheckoutInput,
    access: { kind: 'perm', any: ['loan.checkout'] },
    procedure: 'sp_checkout',
    errors: [
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION',
      'READER_NOT_ACTIVE',
      'CARD_INVALID',
      'COPY_NOT_AVAILABLE',
      'NO_POLICY',
      'DEBT_BLOCKED',
      'OVERDUE_BLOCKED',
      'LIMIT_REACHED',
      'COPY_STATE',
    ],
  }),
  /**
   * Receive a returned copy and assess its fines. Access: `loan.return`.
   * Errors: FORBIDDEN, NOT_FOUND (loan item), VALIDATION, INVALID_TRANSITION, FINE_RULE.
   */
  returnItem: defineEndpoint<FinesResult>()({
    method: 'POST',
    path: '/loan-items/:loanItemId/return',
    params: LoanItemParam,
    body: ReturnInput,
    access: { kind: 'perm', any: ['loan.return'] },
    procedure: 'sp_return_item',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INVALID_TRANSITION', 'FINE_RULE'],
  }),
  /**
   * Declare a loaned copy lost: late fine to now plus the lost fine. Access: `loan.return`.
   * Errors: FORBIDDEN, NOT_FOUND (loan item), INVALID_TRANSITION, FINE_RULE.
   */
  declareLost: defineEndpoint<FinesResult>()({
    method: 'POST',
    path: '/loan-items/:loanItemId/lost',
    params: LoanItemParam,
    body: LostInput,
    access: { kind: 'perm', any: ['loan.return'] },
    procedure: 'sp_declare_lost',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'INVALID_TRANSITION', 'FINE_RULE'],
  }),
  /**
   * Extend a loan item by its applied loan days. Access: `loan.renew`.
   * Errors: FORBIDDEN, NOT_FOUND (loan item), RENEWAL_REJECTED (not_on_loan, overdue, limit, reserved).
   */
  renew: defineEndpoint<RenewResult>()({
    method: 'POST',
    path: '/loan-items/:loanItemId/renew',
    params: LoanItemParam,
    access: { kind: 'perm', any: ['loan.renew'] },
    procedure: 'sp_renew',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'RENEWAL_REJECTED'],
  }),
  /**
   * A reader's loan items, newest first. Access: the reader themself, or `loan.checkout` /
   * `loan.return`; anyone else gets NOT_FOUND. Errors: NOT_FOUND (reader).
   */
  readerLoanItems: defineEndpoint<Page<LoanItem>>()({
    method: 'GET',
    path: '/readers/:readerId/loan-items',
    params: z.object({ readerId: Id }),
    query: LoanItemsQuery,
    access: { kind: 'self-or', any: ['loan.checkout', 'loan.return'], readerParam: 'readerId' },
    errors: ['NOT_FOUND'],
  }),
  /**
   * Desk scan of a copy barcode. Access: `catalog.write`, `loan.checkout` or `loan.return`.
   * Errors: FORBIDDEN, NOT_FOUND (copy).
   */
  copyByBarcode: defineEndpoint<CopyScan>()({
    method: 'GET',
    path: '/copies/by-barcode/:barcode',
    params: z.object({ barcode: z.string().trim().min(1).max(32) }),
    access: { kind: 'perm', any: ['catalog.write', 'loan.checkout', 'loan.return'] },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /**
   * Desk scan of a card number. Access: `card.manage` or `loan.checkout`.
   * Errors: FORBIDDEN, NOT_FOUND (card).
   */
  cardByNumber: defineEndpoint<CardScan>()({
    method: 'GET',
    path: '/cards/by-number/:cardNumber',
    params: z.object({ cardNumber: z.string().trim().min(1).max(32) }),
    access: { kind: 'perm', any: ['card.manage', 'loan.checkout'] },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
};
