import type { Pool } from 'mysql2/promise';
import type { SupabaseAuthFactory } from '@/integrations/supabase/server-client';

/** The verified caller of a request (data-model.md "Verified caller"). */
export interface Caller {
  accountId: number;
  subject: string;
  status: 'active' | 'inactive';
  roles: string[];
  permissions: Set<string>;
  readerId: number | null;
}

/** Claims the server uses from a verified access token. */
export interface VerifiedToken {
  sub: string;
  /** Verified email and display name from the token, used only to create a reader profile (FR-008e). */
  email?: string;
  fullName?: string;
}

export interface ApiDeps {
  /** Pool of the restricted application account. */
  pool: Pool;
  /** Business time source; every procedure gets `p_now` from it (research R8). */
  clock: () => Date;
  /** Verifies a bearer token or throws ApiError(UNAUTHENTICATED | AUTH_UNAVAILABLE). */
  verifyToken: (token: string) => Promise<VerifiedToken>;
  /** Supabase hook secret (`v1,whsec_…`); the hook route is off when unset. */
  hookSecret?: string;
  /** Accepted sign-in providers (FR-008); default Google and email. */
  allowedProviders?: readonly string[];
  /** Supabase auth for the callback/confirm redirects; unset until the project keys are configured. */
  supabaseAuth?: SupabaseAuthFactory;
  logger?: Pick<Console, 'error' | 'info'>;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    now: Date;
    /** `now` as DATETIME(3) UTC text, passed as `p_now`. */
    dbNow: string;
    caller: Caller;
  };
}
