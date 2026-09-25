import { createServerClient, parseCookieHeader, serializeCookieHeader, type CookieMethodsServer } from '@supabase/ssr';
import type { EmailOtpType, Session } from '@supabase/supabase-js';
import type { Context } from 'hono';

/** The Supabase auth calls the redirect routes need (a stub in tests). */
export interface SupabaseRedirectAuth {
  exchangeCodeForSession(code: string): Promise<{ data: { session: Session | null }; error: unknown }>;
  verifyOtp(params: { type: EmailOtpType; token_hash: string }): Promise<{ data: { session: Session | null }; error: unknown }>;
  /** Clears this browser's session cookies (`scope: 'local'` does not revoke other devices). */
  signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
}

/** Builds the auth client for one request from its cookie adapter. */
export type SupabaseAuthFactory = (cookies: CookieMethodsServer) => SupabaseRedirectAuth;

/**
 * Cookie adapter for `@supabase/ssr` on a Hono request: reads the request's cookies (the PKCE
 * code verifier among them) and writes the session cookies, plus the no-cache headers the library
 * passes with them, to the response.
 */
export function honoCookies(c: Context): CookieMethodsServer {
  return {
    getAll: () => parseCookieHeader(c.req.header('cookie') ?? '').map(({ name, value }) => ({ name, value: value ?? '' })),
    setAll: (cookies, headers) => {
      for (const { name, value, options } of cookies) {
        c.header('Set-Cookie', serializeCookieHeader(name, value, options), { append: true });
      }
      for (const [key, value] of Object.entries(headers ?? {})) c.header(key, value);
    },
  };
}

/** Server client of a Supabase project (research R13). A new client per request, as the library requires. */
export function createSupabaseAuthFactory(supabaseUrl: string, publishableKey: string): SupabaseAuthFactory {
  return (cookies) => createServerClient(supabaseUrl, publishableKey, { cookies }).auth;
}
