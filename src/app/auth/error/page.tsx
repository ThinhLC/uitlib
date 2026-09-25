import type { Metadata } from 'next';
import Link from 'next/link';
import type { AuthErrorReason } from '@/lib/api/contract';

export const metadata: Metadata = { title: 'Sign-in failed' };

const MESSAGES: Record<AuthErrorReason, string> = {
  not_configured: 'Sign-in is not configured on this server.',
  provider_error: 'Google sign-in was cancelled or failed.',
  missing_code: 'The sign-in link is incomplete.',
  exchange_failed: 'The sign-in could not be completed. Please try again from the start.',
  invalid_link: 'The link is invalid.',
  verify_failed: 'The link has expired or was already used.',
  provider_not_allowed: 'Please sign in with Google or your library email account.',
  account_unavailable: 'Your library account could not be prepared. Please try again shortly.',
};

/** Landing page of failed Supabase redirects (`/api/v1/auth/callback|confirm`, FR-008d). */
export default async function AuthErrorPage({ searchParams }: PageProps<'/auth/error'>) {
  const { reason } = await searchParams;
  const key = (typeof reason === 'string' ? reason : '') as AuthErrorReason;
  return (
    <main className="mx-auto w-full max-w-xl p-6 font-sans">
      <h1 className="text-2xl font-semibold">Sign-in failed</h1>
      <p className="mt-2">{MESSAGES[key] ?? 'Something went wrong while signing in.'}</p>
      {key && <p className="mt-1 text-sm opacity-60">Reason: {key}</p>}
      {process.env.NODE_ENV !== 'production' && (
        <Link className="mt-4 inline-block underline" href="/dev/auth">
          Back to /dev/auth
        </Link>
      )}
    </main>
  );
}
