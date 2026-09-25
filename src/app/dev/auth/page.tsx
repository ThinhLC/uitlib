import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DevAuthPanel } from './dev-auth-panel';

export const metadata: Metadata = { title: 'Dev: Supabase sign-in' };

/**
 * Development-only page to test the real Supabase Google sign-in against the API
 * (specs/002-library-api/quickstart.md). Returns 404 in production.
 */
export default function DevAuthPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="mx-auto w-full max-w-3xl p-6 font-sans">
      <h1 className="text-2xl font-semibold">Dev: Supabase sign-in</h1>
      <p className="mt-1 text-sm opacity-70">
        Google sign-in → <code>/api/v1/auth/callback</code> → session cookies → call the API with the access token.
      </p>
      <DevAuthPanel />
    </main>
  );
}
