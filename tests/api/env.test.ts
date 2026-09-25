import { afterEach, describe, expect, it, vi } from 'vitest';

/** Import src/env.ts afresh with the given variables (createEnv validates at import). */
async function loadEnv(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v as string);
  return (await import('@/env')).env;
}

const VALID = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'library',
  DB_USER: 'library_app',
  DB_PASSWORD: 'secret',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
  AUTH_HOOK_SECRET: '',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('src/env.ts (research R14)', () => {
  it('accepts a valid environment and coerces the port; a blank optional value is unset', async () => {
    const env = await loadEnv(VALID);
    expect(env.DB_PORT).toBe(3306);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(VALID.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.AUTH_HOOK_SECRET).toBeUndefined();
  });

  it('accepts a Supabase hook secret in v1,whsec_ form', async () => {
    const env = await loadEnv({ ...VALID, AUTH_HOOK_SECRET: 'v1,whsec_dGVzdC1zZWNyZXQ=' });
    expect(env.AUTH_HOOK_SECRET).toBe('v1,whsec_dGVzdC1zZWNyZXQ=');
  });

  it.each([
    ['a missing Supabase URL', { NEXT_PUBLIC_SUPABASE_URL: '' }],
    ['a non-URL Supabase URL', { NEXT_PUBLIC_SUPABASE_URL: 'not a url' }],
    ['a secret key in the publishable slot', { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }],
    ['a malformed hook secret', { AUTH_HOOK_SECRET: 'whsec_only' }],
    ['a non-numeric port', { DB_PORT: 'mysql' }],
  ])('rejects %s', async (_name, override) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadEnv({ ...VALID, ...override })).rejects.toThrow(/Invalid environment variables/);
  });
});
