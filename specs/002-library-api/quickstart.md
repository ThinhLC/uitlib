# Quickstart: Library API (spec 002)

This guide checks that the API works end to end. For the endpoint list see
[contracts/http-api.md](./contracts/http-api.md), and for the error rules see
[contracts/errors.md](./contracts/errors.md).

## Prerequisites

- Complete spec 001's quickstart: Docker MySQL is up and migrated (`pnpm db:up && pnpm db:migrate`).
  Run `pnpm db:seed` for demo data.
- A Supabase project that uses **JWT Signing Keys** (asymmetric; the default for new projects).
  Legacy HS256 secrets are not supported (research R4).
  - Authentication → Providers: turn on **Google** (the client id and secret are entered here
    only) and **Email** (email/password). Turn off Phone, Anonymous and any other provider.
  - Test accounts: Authentication → Users → Add user (email/password, auto-confirm). The seeded
    ones are in `data/seed/people.json`: `account+admin|librarian|student|lecturer|external@gmail.com`.
    Sign in with them on `/dev/auth`.
- `.env.local` additions (see `.env.example`):
  - `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co` (required).
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…` (required for the auth redirects). Also add
    `http://localhost:3000/api/v1/auth/callback` under Authentication → URL Configuration →
    Redirect URLs.
  - `AUTH_HOOK_SECRET=v1,whsec_…` (optional). Set it only where Supabase can reach the app
    (see [signup-hook.md](./contracts/signup-hook.md)).

## Automated validation (no Supabase needed)

```bash
pnpm db:reset-test    # fresh test schema
pnpm test:api         # tests/api: identity, contract sync, every route, error mapping, hook
pnpm test:db          # spec 001 suites still pass
pnpm lint && pnpm typecheck
```

What `pnpm test:api` must show:

| Check | Spec |
| --- | --- |
| `coverage`: every `endpoints` entry is mounted, and every public `sp_*` has an entry (drift in shapes is caught earlier, by `pnpm typecheck`) | FR-001, FR-002, SC-001 |
| `identity`: missing, malformed, expired, wrong-issuer, wrong-audience and anonymous tokens → 401; spoofed `actorUserId` in the body → 400; inactive account → 403; forged `user_metadata.role` → 403 | FR-006–FR-011, SC-003 |
| `provisioning`: 20 parallel first requests for one subject → 1 account with 1 `reader` role | FR-008, SC-010 |
| `signup-hook`: see the test list in signup-hook.md | FR-008b |
| `errors`: each spec 001 key a route can produce comes back with its category and status | FR-019, SC-002 |
| `circulation`: the spec 001 desk scenarios replayed over HTTP with an injected clock | US2, SC-008 |
| `concurrency`: 20 parallel `POST /loans` for one copy → exactly one 201, the rest 409 `COPY_NOT_AVAILABLE`, invariants clean | SC-004 |
| `payments`: the same `requestKey` 20 times → one payment; a changed amount → 409 `IDEMPOTENCY_CONFLICT` | FR-017, SC-005 |
| `isolation`: reader A reading B's loans, fines, payments, reservations and cards → 404, the same as a missing id | FR-010, SC-006 |

## Manual validation

1. `pnpm dev`, then `curl http://localhost:3000/api/v1/health` → `{"status":"ok"}`. For
   request and response shapes, read `src/lib/api/contract/`.
2. Public catalog, no token:
   ```bash
   curl 'http://localhost:3000/api/v1/catalog/books?q=clean&pageSize=5'
   ```
   The response is a page of books with `copies.available/total`, and no barcodes.
3. Get a token through the dev page (development only; it returns 404 in production):
   1. Open `http://localhost:3000/dev/auth` and click **Sign in with Google**.
   2. Google redirects to Supabase, which redirects to `/api/v1/auth/callback`. The callback sets
      the session cookies and creates the `app_users` row with the `reader` role, then returns to
      `/dev/auth`.
   3. Click **Call GET /api/v1/me**. Expect `roles: ["reader"]`, `permissions: []`,
      `reader: null`. Note the `accountId`.
   4. Click **Copy access token** for curl (`TOKEN=…`).
   5. A failed redirect lands on `/auth/error?reason=…`.
4. Make yourself staff for the demo. As MySQL root, `INSERT INTO user_roles` the `librarian`
   role for that account, or ask an admin account to call
   `PUT /api/v1/accounts/{id}/roles/librarian`.
5. Desk flow with the seeded data:
   1. `GET /cards/by-number/{card}`
   2. `GET /copies/by-barcode/{barcode}`
   3. `POST /loans {readerId, copyIds}` → 201 with due times
   4. `POST /loan-items/{id}/return {condition: "good"}` → fines, if any
   5. `POST /payments {…, requestKey: <uuid>}` → 201; repeat → 200 `replayed: true`
6. Reports: `GET /reports/debt/rollforward?month=2026-10` has rows where closing = opening +
   assessed + adjusted − collected. `GET /admin/health` shows zero violations.
7. Hook (optional; needs a public URL, e.g. `cloudflared tunnel --url http://localhost:3000`):
   1. Register the URL in Supabase.
   2. Set `AUTH_HOOK_SECRET` and restart.
   3. Sign up with a new Google account. `app_users` has its row before the first API call.

## Operating procedure: removing a user (FR-011a)

1. Delete or ban the user in Supabase (Authentication → Users). They can no longer get new
   tokens.
2. Right away, as an admin, call `POST /api/v1/accounts/{accountId}/status {"status":
   "inactive"}`. Find the account with `GET /api/v1/accounts` (admins see the Supabase subject).
3. From then on, every call with that account's still-valid token is refused with
   `ACCOUNT_INACTIVE`. Without step 2, the token keeps working until it expires: at most the
   project's access-token lifetime, 1 hour by default. History (loans processed, payments
   received) is kept.

## Expected failure modes

- A missing or invalid variable (e.g. `NEXT_PUBLIC_SUPABASE_URL`): `pnpm dev` and `pnpm build`
  stop at start with the list of invalid variables (src/env.ts). Nothing is served.
- Supabase unreachable (JWKS fetch fails): authenticated routes answer 503 `AUTH_UNAVAILABLE`.
  Public routes still work.
- The hook is enabled in Supabase but the app is unreachable: every new sign-up fails at
  Supabase. Disable the hook, or fix the tunnel.
- A token from another provider (e.g. GitHub enabled by mistake): 401 `UNAUTHENTICATED`
  with detail `provider`, and no account is created.
