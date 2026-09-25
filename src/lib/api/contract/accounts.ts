import { z } from 'zod';
import { Id, PageQuery, type Instant, type Page } from './common';
import { defineEndpoint } from './endpoint';

/** Contract: US7 account and role administration (tasks T068; data-model.md "Administration"). */

export const ACCOUNT_STATUSES = ['active', 'inactive'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** A role code such as `librarian`. */
export const RoleCode = z.string().trim().min(1).max(64);

export const AccountsQuery = PageQuery.extend({
  status: z.enum(ACCOUNT_STATUSES).optional(),
  /** Accounts holding this role code. */
  role: RoleCode.optional(),
});

export const SetAccountStatusInput = z.strictObject({ status: z.enum(ACCOUNT_STATUSES) });

/** An application account (admin view). */
export interface Account {
  id: number;
  status: AccountStatus;
  createdAt: Instant;
  /** Role codes, sorted. */
  roles: string[];
  readerId: number | null;
  /** The Supabase user id; lets an admin find an account whose Supabase user was deleted. */
  subject: string;
}

const AccountParams = z.object({ accountId: Id });
const AccountRoleParams = z.object({ accountId: Id, roleCode: RoleCode });
const roleManage = { kind: 'perm', any: ['role.manage'] } as const;

export const accountEndpoints = {
  /** Accounts, oldest first. `role.manage`. Errors: FORBIDDEN. */
  listAccounts: defineEndpoint<Page<Account>>()({
    method: 'GET',
    path: '/accounts',
    query: AccountsQuery,
    access: roleManage,
    errors: ['FORBIDDEN'],
  }),
  /** One account. `role.manage`. Errors: FORBIDDEN, NOT_FOUND (account). */
  getAccount: defineEndpoint<Account>()({
    method: 'GET',
    path: '/accounts/:accountId',
    params: AccountParams,
    access: roleManage,
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /**
   * Give an account a role; idempotent (204 when already held). `role.manage`.
   * Errors: FORBIDDEN, NOT_FOUND (account, role).
   */
  assignRole: defineEndpoint<void>()({
    method: 'PUT',
    path: '/accounts/:accountId/roles/:roleCode',
    params: AccountRoleParams,
    access: roleManage,
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /**
   * Take a role from an account; 204 also when it was not held. `role.manage`. An admin cannot
   * remove their own `admin` role. Errors: FORBIDDEN, NOT_FOUND (account, role), VALIDATION.
   */
  removeRole: defineEndpoint<void>()({
    method: 'DELETE',
    path: '/accounts/:accountId/roles/:roleCode',
    params: AccountRoleParams,
    access: roleManage,
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION'],
  }),
  /**
   * Activate or deactivate an account (FR-011a); an inactive account can only call `GET /me`.
   * `role.manage`. An admin cannot deactivate themself. 200 Account.
   * Errors: FORBIDDEN, NOT_FOUND (account), VALIDATION.
   */
  setAccountStatus: defineEndpoint<Account>()({
    method: 'POST',
    path: '/accounts/:accountId/status',
    params: AccountParams,
    body: SetAccountStatusInput,
    access: roleManage,
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION'],
  }),
};
