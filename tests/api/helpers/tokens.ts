import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createLocalVerifier } from '@/integrations/supabase/verify-token';

export const TEST_ISSUER = 'https://test.supabase.local/auth/v1';

const keys = generateKeyPair('ES256', { extractable: true });
const otherKeys = generateKeyPair('ES256', { extractable: true });

async function jwksOf(k: Promise<CryptoKeyPair>) {
  const jwk: JWK = { ...(await exportJWK((await k).publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  return { keys: [jwk] };
}

let verifier: ((t: string) => Promise<{ sub: string }>) | undefined;

/** Verifies tokens signed by `signToken` (same issuer/audience rules as production). */
export async function localVerifier(token: string) {
  verifier ??= createLocalVerifier(await jwksOf(keys), TEST_ISSUER);
  return verifier(token);
}


export interface TokenOptions {
  sub?: string;
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
  /** Sign with a key the verifier does not know. */
  foreignKey?: boolean;
  claims?: Record<string, unknown>;
}

/** A Supabase-like access token: aud authenticated, role authenticated, Google provider. */
export async function signToken(opts: TokenOptions = {}): Promise<string> {
  const { privateKey } = await (opts.foreignKey ? otherKeys : keys);
  return new SignJWT({
    role: 'authenticated',
    is_anonymous: false,
    app_metadata: { provider: 'google', providers: ['google'] },
    ...opts.claims,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(opts.sub ?? randomUUID())
    .setIssuer(opts.issuer ?? TEST_ISSUER)
    .setAudience(opts.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(privateKey);
}
