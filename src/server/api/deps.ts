import { env } from '@/env';
import { pool } from '@/lib/db';
import { createSupabaseAuthFactory } from '@/integrations/supabase/server-client';
import { createSupabaseVerifier } from '@/integrations/supabase/verify-token';
import type { ApiDeps } from './context';

/** Dependencies of the running app, from the validated environment (src/env.ts, research R6). */
export function productionDeps(): ApiDeps {
  return {
    pool,
    clock: () => new Date(),
    verifyToken: createSupabaseVerifier(env.NEXT_PUBLIC_SUPABASE_URL),
    hookSecret: env.AUTH_HOOK_SECRET,
    supabaseAuth: createSupabaseAuthFactory(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  };
}
