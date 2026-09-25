import { z } from 'zod';
import { defineEndpoint } from './endpoint';

/**
 * Supabase redirect targets (spec 002 FR-008d). The browser arrives here from Supabase, so both
 * answer with a redirect, never JSON: to `next` on success, or to `AUTH_ERROR_PATH?reason=…`.
 */

/** Where a failed callback or confirmation lands; the UI feature provides this page. */
export const AUTH_ERROR_PATH = '/auth/error';

/** A same-site path to continue to after sign-in (`/…`, never `//host` or a full URL). */
export const NextPath = z
  .string()
  .regex(/^\/(?![/\\])[^\s]*$/, 'must be a path on this site')
  .max(2048);

/** Email link types that `verifyOtp` accepts with a `token_hash`. */
export const EMAIL_OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;

export const AuthCallbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  next: z.string().optional(),
  /** Set by Supabase when the provider sign-in failed. */
  error: z.string().max(200).optional(),
  error_description: z.string().max(1000).optional(),
});

export const AuthConfirmQuery = z.object({
  token_hash: z.string().min(1).max(512).optional(),
  type: z.enum(EMAIL_OTP_TYPES).optional(),
  next: z.string().optional(),
});

/** Why a sign-in redirect failed (`?reason=` on AUTH_ERROR_PATH). */
export type AuthErrorReason =
  | 'not_configured'
  | 'provider_error'
  | 'missing_code'
  | 'exchange_failed'
  | 'invalid_link'
  | 'verify_failed'
  | 'provider_not_allowed'
  /** The session was created but the library account could not be written (e.g. database down). */
  | 'account_unavailable';

export const authEndpoints = {
  /**
   * OAuth PKCE callback: Supabase redirects here with `?code=` after Google sign-in; the code is
   * exchanged for a session stored in cookies, the library account is ensured, then the browser
   * is redirected to `next` (default `/`). Register `<origin>/api/v1/auth/callback` in Supabase
   * Auth → URL Configuration. Access: public (the code is the credential). Answers 302 only.
   */
  authCallback: defineEndpoint<never>()({
    method: 'GET',
    path: '/auth/callback',
    query: AuthCallbackQuery,
    access: { kind: 'public' },
    errors: [],
  }),
  /**
   * Email link confirmation: `?token_hash=&type=&next=` from a Supabase email template, verified
   * with `verifyOtp`; the session is stored in cookies, then redirect to `next`. Access: public.
   * Answers 302 only.
   */
  authConfirm: defineEndpoint<never>()({
    method: 'GET',
    path: '/auth/confirm',
    query: AuthConfirmQuery,
    access: { kind: 'public' },
    errors: [],
  }),
};
