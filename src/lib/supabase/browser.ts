'use client';

import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/env';

/**
 * Supabase client for Client Components. Session cookies are shared with the server routes
 * (`/api/v1/auth/callback` sets them; this client reads and refreshes them).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
