import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import { z } from 'zod';
import { DEFAULT_ALLOWED_PROVIDERS, usesAllowedProvider } from './providers';

/** Payload of the Supabase Before User Created hook (contracts/signup-hook.md). Extra fields are kept. */
export const HookPayload = z.looseObject({
  metadata: z.looseObject({ name: z.literal('before-user-created') }),
  user: z.looseObject({
    id: z.uuid(),
    email: z.string().optional(),
    user_metadata: z.looseObject({ full_name: z.string().optional(), name: z.string().optional() }).optional(),
    is_anonymous: z.boolean().optional(),
    app_metadata: z.looseObject({ provider: z.string().optional(), providers: z.array(z.string()).optional() }).optional(),
  }),
});
export type HookPayload = z.output<typeof HookPayload>;

/**
 * Verify a Standard Webhooks signature on the raw body (timing-safe, timestamp within ±5 min).
 * Supabase secrets look like `v1,whsec_<base64>`; the library strips only `whsec_`, so `v1,` is
 * removed here (research R5). Returns false for any signature problem.
 */
export function verifyHookSignature(secret: string, rawBody: string, headers: Record<string, string>): boolean {
  try {
    new Webhook(secret.replace(/^v1,/, '').replace(/^whsec_/, '')).verify(rawBody, headers);
    return true;
  } catch (err) {
    if (err instanceof WebhookVerificationError) return false;
    throw err;
  }
}

/** True when the sign-up uses an allowed provider (Google or email) and is not anonymous (FR-008). */
export function isAllowedSignup(p: HookPayload, allowedProviders: readonly string[] = DEFAULT_ALLOWED_PROVIDERS): boolean {
  if (p.user.is_anonymous === true) return false;
  return usesAllowedProvider(p.user.app_metadata, allowedProviders);
}
