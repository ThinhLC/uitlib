/**
 * Sign-in providers the library accepts (FR-008): Google and Supabase email/password. Any other
 * provider (GitHub, anonymous, …) is refused.
 */
export const DEFAULT_ALLOWED_PROVIDERS: readonly string[] = ['google', 'email'];

/** Providers of a Supabase user from its `app_metadata` (`providers`, else `provider`). */
export function providersOf(meta: { provider?: unknown; providers?: unknown } | null | undefined): string[] {
  if (Array.isArray(meta?.providers)) return meta.providers.map(String);
  return meta?.provider ? [String(meta.provider)] : [];
}

/** True when the user signed in with at least one allowed provider. */
export function usesAllowedProvider(
  meta: { provider?: unknown; providers?: unknown } | null | undefined,
  allowed: readonly string[] = DEFAULT_ALLOWED_PROVIDERS,
): boolean {
  return providersOf(meta).some((p) => allowed.includes(p));
}
