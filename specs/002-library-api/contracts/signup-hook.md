# Contract: Supabase Before User Created hook (FR-008b)

`POST /api/v1/auth/hooks/before-user-created`

Supabase calls this route before it inserts a new user. The route verifies the signature,
checks that the user is signing up with Google, and runs "ensure account" (data-model.md). It
answers so that Supabase allows the sign-up. It is enabled only when `AUTH_HOOK_SECRET` is set.
Without the secret, the route returns 404 `ROUTE_NOT_FOUND`.

## Configuration (per environment)

1. Supabase Dashboard → Authentication → Hooks → *Before User Created* → type HTTPS. The URL is
   `https://<public host>/api/v1/auth/hooks/before-user-created`.
2. Copy the generated secret (`v1,whsec_…`) into `AUTH_HOOK_SECRET`.
3. Enable the hook **only** where Supabase can reach the URL (a deployed app, or a tunnel in
   development). An unreachable hook makes Supabase deny every sign-up. When it is off, the
   first-request path (FR-008a) creates accounts.

## Request (from Supabase)

Headers: `webhook-id`, `webhook-timestamp`, `webhook-signature` (Standard Webhooks),
`content-type: application/json`.

The route validates this body with zod after the signature check. Unknown fields are allowed,
because Supabase may add fields:

```json
{
  "metadata": { "uuid": "…", "time": "2026-09-25T10:00:00Z", "name": "before-user-created", "ip_address": "…" },
  "user": { "id": "<uuid>", "email": "a@gmail.com", "app_metadata": { "provider": "google", "providers": ["google"] }, "is_anonymous": false }
}
```

## Processing

1. Read the raw body as text. Verify it with `new Webhook(secret without "v1,whsec_")
   .verify(raw, headers)`: timing-safe signature check, timestamp within ±5 minutes.
2. `user.id` must be a UUID, and `metadata.name` must be `before-user-created`.
3. `user.app_metadata.provider` must be `google`, and `is_anonymous` must not be `true`.
4. Run "ensure account"(`user.id`, `now`): account `active`, role `reader` when it is new. An
   existing account is left unchanged.
5. Log `{requestId, webhookId, subject, created}`. The email is not logged.

## Responses

| Case | HTTP | Body | Effect on the sign-up |
| --- | --- | --- | --- |
| Account created, or it already existed | 200 | `{}` | allowed |
| Signature missing, invalid or stale | 401 | `{"error": {"http_code": 401, "message": "invalid signature"}}` | denied. Only a misconfigured secret causes this, and it shows up at once in testing |
| Payload shape invalid | 400 | `{"error": {"http_code": 400, "message": "invalid payload"}}` | denied |
| Provider is neither Google nor email, or anonymous | 403 | `{"error": {"http_code": 403, "message": "Sign in with Google or email to use the library."}}` | denied, and the user sees the message |
| Database busy or unreachable (1213/1205 on the single attempt, connection error) | 503 + `Retry-After: 1` | `{"error": {"http_code": 503, "message": "try again"}}` | Supabase retries (up to 3 times). After that the sign-up fails, and the user can try again |
| Any other error | 500 | `{"error": {"http_code": 500, "message": "internal error"}}` | denied. Logged with `requestId` |

The whole handler must finish well within Supabase's 5-second budget. "Ensure account" is two
indexed statements in one transaction. The route calls it with **one attempt** (no in-process
retry) on a connection with `innodb_lock_wait_timeout = 2`. The worst case is therefore about
2 s, and a stuck lock turns into 503, which makes Supabase retry, rather than a timeout.

## Tests (tests/api/signup-hook.test.ts)

- A valid signed Google payload → 200, one account with the `reader` role. The same `webhook-id`
  again → 200 and still one account (SC-010).
- The hook and a first `GET /me` for the same subject at the same time → one account.
- A wrong secret, a tampered body, or a timestamp 6 minutes old → 401, nothing written (SC-003).
- Provider `github` → 403, nothing written; provider `email` → 200.
- `AUTH_HOOK_SECRET` unset → 404.
