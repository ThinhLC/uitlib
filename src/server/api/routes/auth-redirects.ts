import type { Session } from '@supabase/supabase-js';
import type { Context, Hono } from 'hono';
import { AUTH_ERROR_PATH, NextPath, endpoints, type AuthErrorReason } from '@/lib/api/contract';
import { usesAllowedProvider } from '@/integrations/supabase/providers';
import { honoCookies, type SupabaseRedirectAuth } from '@/integrations/supabase/server-client';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { markMounted } from '@/server/api/define-route';
import { ensureAccount } from '@/server/api/services/accounts';
import { isNil, isUndefined } from '@/lib/utils';

/**
 * Origin to redirect to, as in the Supabase Next.js guide: behind a proxy in production the public
 * host comes from `x-forwarded-host`; locally the request origin is used.
 */
function publicOrigin(c: Context<AppEnv>): string {
  const forwardedHost = c.req.header('x-forwarded-host');
  if (process.env.NODE_ENV === 'production' && forwardedHost) return `https://${forwardedHost}`;
  return new URL(c.req.url).origin;
}

/** `next` when it is a path on this site, else `/` (no open redirect). */
function safeNext(next: string | undefined): string {
  return NextPath.safeParse(next).success ? (next as string) : '/';
}

/**
 * Supabase redirect targets (FR-008d): OAuth PKCE callback and email-link confirmation. Both set
 * the session cookies through `@supabase/ssr`, create the library account for a Google user
 * (FR-008, same idempotent step as the first request), and redirect; failures redirect to
 * AUTH_ERROR_PATH with a reason. They never answer JSON.
 */
export function registerAuthRedirects(app: Hono<AppEnv>, deps: ApiDeps): void {
  const logger = deps.logger ?? console;

  const fail = (c: Context<AppEnv>, reason: AuthErrorReason, cause?: unknown) => {
    if (cause) logger.info(`[api] ${c.var.requestId} auth redirect failed: ${reason}`, cause);
    return c.redirect(`${publicOrigin(c)}${AUTH_ERROR_PATH}?reason=${reason}`, 302);
  };

  /**
   * After a session exists: Google or email users get their library account now. Anyone else is signed out
   * again (their session cookies are cleared) and refused: only Google and email sign-ins are accepted.
   */
  const finish = async (c: Context<AppEnv>, auth: SupabaseRedirectAuth, session: Session | null, next: string) => {
    if (isNil(session)) return fail(c, 'exchange_failed');

    if (usesAllowedProvider(session.user.app_metadata, deps.allowedProviders)) {
      try {
        const meta = session.user.user_metadata ?? {};
        await ensureAccount(deps.pool, session.user.id.toLowerCase(), c.var.dbNow, {
          email: session.user.email,
          fullName: (meta.full_name as string | undefined) ?? (meta.name as string | undefined),
        });
      } catch (err) {
        // The session cookies are already set, so a retry (or the first API request, FR-008a)
        // can still create the account; the user is told instead of landing as if all was fine.
        logger.error(`[api] ${c.var.requestId} ensureAccount failed`, err);
        return fail(c, 'account_unavailable');
      }
      return c.redirect(`${publicOrigin(c)}${next}`, 302);
    }

    await auth.signOut({ scope: 'local' });
    return fail(c, 'provider_not_allowed');
  };

  const callback = endpoints.authCallback;
  markMounted(app, callback);

  app.get(callback.path, async (c) => {
    const q = callback.query.safeParse(c.req.query());

    if (q.error) return fail(c, 'invalid_link', q.error);
    if (q.data.error) return fail(c, 'provider_error', q.data.error_description ?? q.data.error);
    if (isUndefined(deps.supabaseAuth)) return fail(c, 'not_configured');
    if (isUndefined(q.data.code)) return fail(c, 'missing_code');

    const auth = deps.supabaseAuth(honoCookies(c));
    const { data, error } = await auth.exchangeCodeForSession(q.data.code);
    if (error) return fail(c, 'exchange_failed', error);
    return finish(c, auth, data.session, safeNext(q.data.next));
  });

  const confirm = endpoints.authConfirm;
  markMounted(app, confirm);

  app.get(confirm.path, async (c) => {
    const q = confirm.query.safeParse(c.req.query());
    
    if (q.error) return fail(c, 'invalid_link', q.error);
    if (isUndefined(q.data.token_hash) || isUndefined(q.data.type)) return fail(c, 'invalid_link');
    if (isUndefined(deps.supabaseAuth)) return fail(c, 'not_configured');

    const auth = deps.supabaseAuth(honoCookies(c));
    const { data, error } = await auth.verifyOtp({ type: q.data.type, token_hash: q.data.token_hash });
    if (error) return fail(c, 'verify_failed', error);

    return finish(c, auth, data.session, safeNext(q.data.next));
  });
}
