import { defineEndpoint } from './endpoint';

export interface Health {
  status: 'ok';
}

/** The verified caller (`GET /me`). `accountId` is what a reader shows at the desk to be linked. */
export interface Me {
  accountId: number;
  status: 'active' | 'inactive';
  roles: string[];
  permissions: string[];
  reader: { id: number; fullName: string; readerType: string; status: 'active' | 'suspended' | 'inactive' } | null;
}

export const meEndpoints = {
  /** Liveness. Public; does not touch the database. */
  health: defineEndpoint<Health>()({ method: 'GET', path: '/health', access: { kind: 'public' }, errors: [] }),
  /**
   * The caller's account, roles, permissions and linked reader. Creates the account on first sight
   * (FR-008a). Allowed for inactive accounts. Errors: UNAUTHENTICATED, AUTH_UNAVAILABLE.
   */
  me: defineEndpoint<Me>()({
    method: 'GET',
    path: '/me',
    access: { kind: 'token' },
    errors: ['UNAUTHENTICATED', 'AUTH_UNAVAILABLE'],
  }),
  /**
   * Supabase Before User Created hook (contracts/signup-hook.md). Called by Supabase, not by the UI.
   * Answers `{}` or `{ error: { http_code, message } }`.
   */
  signupHook: defineEndpoint<Record<string, never>>()({
    method: 'POST',
    path: '/auth/hooks/before-user-created',
    access: { kind: 'webhook' },
    errors: [],
  }),
};
