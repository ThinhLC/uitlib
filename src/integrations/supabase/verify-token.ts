import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { ApiError } from '@/server/api/errors/api-error';
import { DEFAULT_ALLOWED_PROVIDERS, usesAllowedProvider } from './providers';
import type { VerifiedToken } from '@/server/api/context';
import { isUndefined } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SupabaseClaims extends JWTPayload {
  role?: string;
  is_anonymous?: boolean;
  app_metadata?: { provider?: string; providers?: string[] };
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
}

/**
 * Rules after the signature, issuer, audience and expiry checks (research R4, FR-008): a UUID
 * subject, the `authenticated` role, not anonymous, and an allowed sign-in provider (Google or
 * email).
 */
export function checkClaims(payload: SupabaseClaims, allowedProviders: readonly string[] = DEFAULT_ALLOWED_PROVIDERS): VerifiedToken {
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) throw new ApiError('UNAUTHENTICATED', 'sub');
  if (payload.role !== 'authenticated') throw new ApiError('UNAUTHENTICATED', 'role');
  if (payload.is_anonymous === true) throw new ApiError('UNAUTHENTICATED', 'anonymous');
  if (!usesAllowedProvider(payload.app_metadata, allowedProviders)) throw new ApiError('UNAUTHENTICATED', 'provider');
  return {
    sub: payload.sub.toLowerCase(),
    email: payload.email || undefined,
    fullName: payload.user_metadata?.full_name || payload.user_metadata?.name || undefined,
  };
}

/** Errors that mean "the key set could not be fetched", not "the token is bad". */
function isKeySetUnavailable(err: unknown): boolean {
  if (err instanceof joseErrors.JWKSTimeout) return true;
  if (err instanceof joseErrors.JOSEError) return false;
  // A network failure while fetching the JWKS surfaces as a plain (non-jose) error.
  return err instanceof Error;
}

function verifierFor(keys: JWTVerifyGetKey, issuer: string, allowedProviders: readonly string[]) {
  return async (token: string): Promise<VerifiedToken> => {
    let payload: SupabaseClaims;
    try {
      ({ payload } = await jwtVerify<SupabaseClaims>(token, keys, {
        issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      }));
    } catch (err) {
      if (isKeySetUnavailable(err)) throw new ApiError('AUTH_UNAVAILABLE');
      throw new ApiError('UNAUTHENTICATED');
    }
    return checkClaims(payload, allowedProviders);
  };
}

const remoteSets = new Map<string, JWTVerifyGetKey>();

/** Verifier for a Supabase project: JWKS and issuer derived from its URL (research R4, R6). */
export function createSupabaseVerifier(supabaseUrl: string, allowedProviders: readonly string[] = DEFAULT_ALLOWED_PROVIDERS) {
  const base = supabaseUrl.replace(/\/+$/, '');
  let keys = remoteSets.get(base);
  if (isUndefined(keys)) {
    keys = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    remoteSets.set(base, keys);
  }
  return verifierFor(keys, `${base}/auth/v1`, allowedProviders);
}

/** Verifier over a fixed key set (tests; no network). */
export function createLocalVerifier(jwks: JSONWebKeySet, issuer: string, allowedProviders: readonly string[] = DEFAULT_ALLOWED_PROVIDERS) {
  return verifierFor(createLocalJWKSet(jwks), issuer, allowedProviders);
}
