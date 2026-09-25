import { z } from 'zod';
import { Id, PageQuery, SignedMoney, type Instant, type Page } from './common';
import { defineEndpoint } from './endpoint';
import type { BookRef, FineType } from './resources';

/** Contract: US5 fines, balance, payments, adjustments (data-model.md "Money"). */

const PositiveVnd = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const PaymentInput = z.strictObject({
  readerId: Id,
  amountVnd: PositiveVnd,
  method: z.enum(['cash', 'bank_transfer']),
  referenceNo: z.string().trim().max(64).nullish(),
  /** Client-generated; the same key replays the same payment (FR-017). */
  requestKey: z.uuid(),
  allocations: z
    .array(z.strictObject({ fineId: Id, amountVnd: PositiveVnd }))
    .min(1)
    .max(50)
    .refine((xs) => new Set(xs.map((a) => a.fineId)).size === xs.length, 'fines must be distinct'),
});
export type PaymentInput = z.output<typeof PaymentInput>;

export const AdjustmentInput = z.strictObject({
  amountVnd: SignedMoney,
  reason: z.string().trim().min(1).max(255),
});

export const FinesQuery = PageQuery.extend({
  /** Only fines with `remainingVnd > 0`. */
  open: z.stringbool().optional(),
});

export interface Fine {
  id: number;
  loanItemId: number;
  type: FineType;
  defaultAmountVnd: number;
  assessedAmountVnd: number;
  adjustmentsVnd: number;
  netVnd: number;
  allocatedVnd: number;
  remainingVnd: number;
  reason: string | null;
  assessedAt: Instant;
  book: BookRef;
}

export interface Balance {
  readerId: number;
  outstandingVnd: number;
  asOf: Instant;
}

export interface PaymentAllocation {
  fineId: number;
  amountVnd: number;
}

export interface Payment {
  id: number;
  amountVnd: number;
  method: 'cash' | 'bank_transfer';
  referenceNo: string | null;
  paidAt: Instant;
  /** Account id of the collector. */
  receivedBy: number;
  allocations: PaymentAllocation[];
}

export interface PaymentResult {
  paymentId: number;
  replayed: boolean;
}

export interface AdjustmentResult {
  adjustmentId: number;
}

const ReaderParams = z.object({ readerId: Id });

export const moneyEndpoints = {
  /** A reader's fines, newest first. Access: self or fine.collect. Errors: NOT_FOUND. */
  readerFines: defineEndpoint<Page<Fine>>()({
    method: 'GET',
    path: '/readers/:readerId/fines',
    params: ReaderParams,
    query: FinesQuery,
    access: { kind: 'self-or', any: ['fine.collect'], readerParam: 'readerId' },
    errors: ['NOT_FOUND'],
  }),
  /** A reader's outstanding debt now. Access: self or fine.collect or loan.checkout. Errors: NOT_FOUND. */
  readerBalance: defineEndpoint<Balance>()({
    method: 'GET',
    path: '/readers/:readerId/balance',
    params: ReaderParams,
    access: { kind: 'self-or', any: ['fine.collect', 'loan.checkout'], readerParam: 'readerId' },
    errors: ['NOT_FOUND'],
  }),
  /** A reader's payments with allocations, newest first. Access: self or fine.collect. Errors: NOT_FOUND. */
  readerPayments: defineEndpoint<Page<Payment>>()({
    method: 'GET',
    path: '/readers/:readerId/payments',
    params: ReaderParams,
    query: PageQuery,
    access: { kind: 'self-or', any: ['fine.collect'], readerParam: 'readerId' },
    errors: ['NOT_FOUND'],
  }),
  /**
   * Record a payment fully allocated to the reader's fines; idempotent by `requestKey`
   * (201 new, 200 replayed). Access: fine.collect (procedure). Errors: FORBIDDEN, NOT_FOUND,
   * VALIDATION, ALLOCATION_MISMATCH, PAYMENT_EXCEEDS_DEBT, IDEMPOTENCY_CONFLICT.
   */
  recordPayment: defineEndpoint<PaymentResult>()({
    method: 'POST',
    path: '/payments',
    body: PaymentInput,
    access: { kind: 'procedure' },
    procedure: 'sp_record_payment',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'ALLOCATION_MISMATCH', 'PAYMENT_EXCEEDS_DEBT', 'IDEMPOTENCY_CONFLICT'],
  }),
  /**
   * Record a signed correction to a fine. Access: fine.adjust (procedure). Errors: FORBIDDEN,
   * NOT_FOUND, FINE_RULE.
   */
  adjustFine: defineEndpoint<AdjustmentResult>()({
    method: 'POST',
    path: '/fines/:fineId/adjustments',
    params: z.object({ fineId: Id }),
    body: AdjustmentInput,
    access: { kind: 'procedure' },
    procedure: 'sp_adjust_fine',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'FINE_RULE'],
  }),
};
