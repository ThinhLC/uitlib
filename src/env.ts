import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Environment of the Next.js app, validated with zod at startup (and at build: next.config.ts
 * imports this file). Server variables are never readable from client code; `NEXT_PUBLIC_*`
 * variables are inlined into the browser bundle, so they must stay public values.
 *
 * Scripts and tests (tsx, vitest) reach it through `src/lib/db/config.ts`, which loads
 * .env.local first. `GOOGLE_BOOKS_API_KEY` is not part of it (one seed script only).
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive().max(65535),
    DB_NAME: z.string().min(1),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    /** MySQL root password; only the owner role of the DB tooling uses it, never the app. */
    MYSQL_ROOT_PASSWORD: z.string().min(1),
    /** Supabase Before User Created hook secret; the hook route is off when unset. */
    AUTH_HOOK_SECRET: z
      .string()
      .regex(/^v1,whsec_[A-Za-z0-9+/=]+$/, 'expected v1,whsec_<base64>')
      .optional(),
  },
  client: {
    /** Supabase project URL; the JWKS URL and token issuer are derived from it. */
    NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
    /** Supabase publishable key (`sb_publishable_…`, or a legacy anon JWT). */
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .regex(/^(sb_publishable_\S+|eyJ\S+)$/, 'expected a Supabase publishable key'),
  },
  // Next.js only inlines NEXT_PUBLIC_* values it can see statically, so they are listed here.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  // `KEY=` in an env file counts as unset, so optional variables can be left blank.
  emptyStringAsUndefined: true,
});

