import { z } from 'zod';
import { Id, InstantInput, PageQuery, type Instant, type Items, type Page } from './common';
import { defineEndpoint } from './endpoint';
import type { Card, Reader } from './resources';

/** Contract: US4 readers, account links, cards, policies (data-model.md "People"). */

const TypeCode = z.string().trim().min(1).max(32);
const ReaderStatusInput = z.enum(['active', 'suspended', 'inactive']);
const FullName = z.string().trim().min(1).max(200);
const Email = z.string().trim().max(320).pipe(z.email());
const Phone = z.string().trim().max(20);

export const ReaderInput = z.strictObject({
  fullName: FullName,
  email: Email.nullish(),
  phone: Phone.nullish(),
  readerType: TypeCode,
  status: ReaderStatusInput.optional(),
});
export type ReaderInput = z.output<typeof ReaderInput>;

/** Every field optional; `email` / `phone` may be `null` to clear them. */
export const ReaderUpdateInput = z.strictObject({
  fullName: FullName.optional(),
  email: Email.nullish(),
  phone: Phone.nullish(),
  readerType: TypeCode.optional(),
  status: ReaderStatusInput.optional(),
});
export type ReaderUpdateInput = z.output<typeof ReaderUpdateInput>;

export const LinkAccountInput = z.strictObject({ accountId: Id });

export const IssueCardInput = z.strictObject({
  cardNumber: z.string().trim().min(1).max(32),
  expiresAt: InstantInput,
});

/** A card can only be moved away from `active`; `active` is not an allowed target. */
export const SetCardStatusInput = z.strictObject({ status: z.enum(['expired', 'lost', 'revoked']) });

const Count = z.number().int().min(0).max(32767);
const Vnd = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const CreatePolicyInput = z.strictObject({
  readerType: TypeCode,
  materialType: TypeCode,
  /** The database requires at least one item (`loan_policies_max_items_ck`). */
  maxActiveItems: Count.min(1),
  loanDays: Count.min(1),
  maxRenewals: Count,
  dailyLateFeeVnd: Vnd,
  debtBlockThresholdVnd: Vnd,
  validFrom: InstantInput,
});
export type CreatePolicyInput = z.output<typeof CreatePolicyInput>;

export const ClosePolicyInput = z.strictObject({ validTo: InstantInput });

export const ReadersQuery = PageQuery.extend({
  q: z.string().trim().max(200).optional(),
  status: ReaderStatusInput.optional(),
  readerType: TypeCode.optional(),
});

export const PoliciesQuery = PageQuery.extend({
  readerType: TypeCode.optional(),
  materialType: TypeCode.optional(),
  activeAt: InstantInput.optional(),
});

export interface PolicyVersion {
  id: number;
  readerType: string;
  materialType: string;
  maxActiveItems: number;
  loanDays: number;
  maxRenewals: number;
  dailyLateFeeVnd: number;
  debtBlockThresholdVnd: number;
  validFrom: Instant;
  validTo: Instant | null;
}

/** A reader type or material type. */
export interface ReferenceType {
  id: number;
  code: string;
  name: string;
}

export interface ExpireCardsResult {
  count: number;
}

const ReaderParams = z.object({ readerId: Id });

export const peopleEndpoints = {
  /** Search readers. Access: card.manage or loan.checkout. Errors: FORBIDDEN. */
  listReaders: defineEndpoint<Page<Reader>>()({
    method: 'GET',
    path: '/readers',
    query: ReadersQuery,
    access: { kind: 'perm', any: ['card.manage', 'loan.checkout'] },
    errors: ['FORBIDDEN'],
  }),
  /** Register a reader (direct write). Access: card.manage. Errors: FORBIDDEN, NOT_FOUND (readerType). */
  createReader: defineEndpoint<Reader>()({
    method: 'POST',
    path: '/readers',
    body: ReaderInput,
    access: { kind: 'perm', any: ['card.manage'] },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /** One reader. Access: self or card.manage or loan.checkout. Errors: NOT_FOUND. */
  getReader: defineEndpoint<Reader>()({
    method: 'GET',
    path: '/readers/:readerId',
    params: ReaderParams,
    access: { kind: 'self-or', any: ['card.manage', 'loan.checkout'], readerParam: 'readerId' },
    errors: ['NOT_FOUND'],
  }),
  /** Edit a reader (direct write). Access: card.manage. Errors: FORBIDDEN, NOT_FOUND (reader, readerType). */
  updateReader: defineEndpoint<Reader>()({
    method: 'PATCH',
    path: '/readers/:readerId',
    params: ReaderParams,
    body: ReaderUpdateInput,
    access: { kind: 'perm', any: ['card.manage'] },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /**
   * Link an active account to an unlinked reader. Access: card.manage. Errors: FORBIDDEN,
   * NOT_FOUND (reader, account), VALIDATION (account inactive, reader already linked),
   * DUPLICATE `readers_user_uq` (the account already has a reader).
   */
  linkAccount: defineEndpoint<Reader>()({
    method: 'PUT',
    path: '/readers/:readerId/account',
    params: ReaderParams,
    body: LinkAccountInput,
    access: { kind: 'perm', any: ['card.manage'] },
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'DUPLICATE'],
  }),
  /** Unlink the reader's account (idempotent). Access: card.manage. Errors: FORBIDDEN, NOT_FOUND. */
  unlinkAccount: defineEndpoint<Reader>()({
    method: 'DELETE',
    path: '/readers/:readerId/account',
    params: ReaderParams,
    access: { kind: 'perm', any: ['card.manage'] },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /** Every card of a reader, newest first. Access: self or card.manage. Errors: NOT_FOUND. */
  readerCards: defineEndpoint<Items<Card>>()({
    method: 'GET',
    path: '/readers/:readerId/cards',
    params: ReaderParams,
    access: { kind: 'self-or', any: ['card.manage'], readerParam: 'readerId' },
    errors: ['NOT_FOUND'],
  }),
  /**
   * Issue an active card. Access: card.manage (procedure). Errors: FORBIDDEN, NOT_FOUND,
   * VALIDATION, DUPLICATE (`library_cards_active_reader_uq`, `library_cards_number_uq`).
   */
  issueCard: defineEndpoint<Card>()({
    method: 'POST',
    path: '/readers/:readerId/cards',
    params: ReaderParams,
    body: IssueCardInput,
    access: { kind: 'procedure' },
    procedure: 'sp_issue_card',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'DUPLICATE'],
  }),
  /**
   * Move an active card to expired, lost or revoked. Access: card.manage (procedure).
   * Errors: FORBIDDEN, NOT_FOUND, VALIDATION, INVALID_TRANSITION.
   */
  setCardStatus: defineEndpoint<Card>()({
    method: 'POST',
    path: '/cards/:cardId/status',
    params: z.object({ cardId: Id }),
    body: SetCardStatusInput,
    access: { kind: 'procedure' },
    procedure: 'sp_set_card_status',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INVALID_TRANSITION'],
  }),
  /** Reader types. Access: signed-in. */
  readerTypes: defineEndpoint<Items<ReferenceType>>()({
    method: 'GET',
    path: '/reference/reader-types',
    access: { kind: 'signed-in' },
    errors: [],
  }),
  /** Material types. Access: signed-in. */
  materialTypes: defineEndpoint<Items<ReferenceType>>()({
    method: 'GET',
    path: '/reference/material-types',
    access: { kind: 'signed-in' },
    errors: [],
  }),
  /** Policy versions, newest first. Access: policy.manage or loan.checkout. Errors: FORBIDDEN. */
  listPolicies: defineEndpoint<Page<PolicyVersion>>()({
    method: 'GET',
    path: '/policies',
    query: PoliciesQuery,
    access: { kind: 'perm', any: ['policy.manage', 'loan.checkout'] },
    errors: ['FORBIDDEN'],
  }),
  /**
   * Create an open-ended policy version. Access: policy.manage (procedure). Errors: FORBIDDEN,
   * NOT_FOUND (readerType, materialType), VALIDATION, POLICY_OVERLAP.
   */
  createPolicy: defineEndpoint<PolicyVersion>()({
    method: 'POST',
    path: '/policies',
    body: CreatePolicyInput,
    access: { kind: 'procedure' },
    procedure: 'sp_create_policy_version',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'POLICY_OVERLAP'],
  }),
  /**
   * Close a policy version at `validTo`. Access: policy.manage (procedure). Errors: FORBIDDEN,
   * NOT_FOUND, VALIDATION, POLICY_CLOSE_REJECTED.
   */
  closePolicy: defineEndpoint<PolicyVersion>()({
    method: 'POST',
    path: '/policies/:policyId/close',
    params: z.object({ policyId: Id }),
    body: ClosePolicyInput,
    access: { kind: 'procedure' },
    procedure: 'sp_close_policy_version',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'POLICY_CLOSE_REJECTED'],
  }),
  /** Expire every active card past its expiry. Access: card.manage (procedure). Errors: FORBIDDEN. */
  expireCards: defineEndpoint<ExpireCardsResult>()({
    method: 'POST',
    path: '/jobs/expire-cards',
    access: { kind: 'procedure' },
    procedure: 'sp_expire_cards',
    errors: ['FORBIDDEN'],
  }),
};
