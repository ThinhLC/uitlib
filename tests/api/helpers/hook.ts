import { Webhook } from 'standardwebhooks';

/** A Supabase-style hook secret (`v1,whsec_<base64>`). */
export const TEST_HOOK_SECRET = `v1,whsec_${Buffer.from('test-hook-secret-0123456789abcdef').toString('base64')}`;

export function hookPayload(userId: string, provider = 'google', extra: Record<string, unknown> = {}) {
  return {
    metadata: { uuid: crypto.randomUUID(), time: new Date().toISOString(), name: 'before-user-created', ip_address: '127.0.0.1' },
    user: {
      id: userId,
      aud: 'authenticated',
      role: '',
      email: 'someone@gmail.com',
      app_metadata: { provider, providers: [provider] },
      user_metadata: {},
      identities: [],
      is_anonymous: false,
      ...extra,
    },
  };
}

/** Standard Webhooks headers and body for a payload. */
export function signHook(
  payload: unknown,
  opts: { secret?: string; timestamp?: Date; id?: string; tamper?: boolean } = {},
): { body: string; headers: Record<string, string> } {
  const secret = (opts.secret ?? TEST_HOOK_SECRET).replace(/^v1,/, '').replace(/^whsec_/, '');
  const body = JSON.stringify(payload);
  const id = opts.id ?? `msg_${crypto.randomUUID()}`;
  const ts = opts.timestamp ?? new Date();
  const signature = new Webhook(secret).sign(id, ts, body);
  return {
    body: opts.tamper ? body.replace('before-user-created', 'before-user-createX') : body,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)),
      'webhook-signature': signature,
    },
  };
}
