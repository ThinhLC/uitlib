# Research: Library API (spec 002)

Checked on 2026-09-25 against the installed Next.js 16.3.6 docs (`node_modules/next/dist/docs/`),
the npm registry and the vendors' documentation. Versions are pinned to releases that are at
least 4 days old, because pnpm enforces a minimum release age (`pnpm-workspace.yaml`).

## R1. Mounting Hono in Next.js 16 App Router

- **Decision:** one optional catch-all Route Handler, `src/app/api/[[...route]]/route.ts`. It
  imports the app built by `createApp(deps)` (`src/server/api/app.ts`, a plain `Hono` with
  `basePath('/api/v1')`) and exports `GET`, `POST`, `PUT`, `PATCH` and `DELETE` as
  `handle(app)` from `hono/vercel`.
- **Rationale:**
  - Route Handlers are the App Router's HTTP primitive (`01-getting-started/15-route-handlers.md`),
    and the Hono guide for Next.js uses exactly this layout.
  - `[[...route]]` also matches `/api` itself (`dynamic-routes.md`).
  - `handle(app)` is `(req) => app.fetch(req)`. Exporting `app.fetch` directly would pass Next's
    `{ params }` context as Hono's `Env`.
  - The runtime stays the default `nodejs`: the edge runtime is deprecated in Next 16
    (`runtime.md`), and `mysql2` needs Node.
  - Route Handlers are not cached by default, and `cacheComponents` is off in
    `next.config.ts`, so every request runs at request time. `export const dynamic =
    'force-dynamic'` is still set, to state intent.
- **Notes from the Next 16 docs:**
  - `middleware` is renamed `proxy`. We use neither: auth lives in Hono middleware, so it runs
    in the same process and is covered by `app.request()` tests.
  - A `route.ts` must not share a segment with a `page.tsx`. `/api` has no page.
- **Alternatives rejected:**
  - One `route.ts` per endpoint: about 70 files, and a spread-out contract.
  - A separate Hono server process: a second deployable, and double configuration.
  - Pages Router API routes: legacy.

## R2. Contract as shared TypeScript definitions (no OpenAPI in the MVP)

- **Decision:** the contract lives in `src/lib/api/contract/`, a module that imports only
  `zod`. It has no server or database imports, so both the Hono server and the Next.js UI
  (client or server components) can import it.
  - **Inputs** are zod schemas (`z.strictObject`), with the TypeScript type from `z.infer`
    (e.g. `CheckoutInput`). The server parses inputs with them in `route()` (no
    separate validator middleware), and the UI can reuse them for form validation.
  - **Outputs** are plain TypeScript interfaces (e.g. `CheckoutResult`, `LoanItem`,
    `Page<T>`). They are not validated at runtime.
  - **Errors:** the union types `ErrorKey` and `ErrorCategory`, and the interface
    `ApiErrorBody`.
  - **Endpoint table:** `endpoints`, one `as const` entry per operation, e.g.
    `checkout: { method: 'POST', path: '/loans', access: { perm: ['loan.checkout'] },
    procedure: 'sp_checkout', errors: ['COPY_NOT_AVAILABLE', …] }`. The input and output types
    are linked to the entry through a phantom type (`defineEndpoint<In, Out>()`). A JSDoc
    comment on each entry repeats the access rule and the error keys (FR-003).
- **How drift is prevented (FR-002):**
  - The server registers each route with `route(app, endpoints.checkout, handler)`. The helper
    takes the method, the path and the input schema from the entry, and requires the handler to
    return `Out`. A handler that reads an undeclared field or returns a wrong shape fails
    `pnpm typecheck`.
  - `tests/api/coverage.test.ts` checks that every entry is mounted, and that every public
    `sp_*` routine appears in some entry's `procedure`.
- **UI usage:** a small typed fetch helper, `src/lib/api/client.ts` (`apiFetch(endpoints.x,
  {params, query, body})` → `Promise<Out>`, throwing `ApiError` with a typed `key`). It is
  written in this feature because tests use it, and the UI reuses it later.
- **Rationale:**
  - The UI lives in the same repository, so a shared module gives the same guarantees as a
    generated document, with less tooling (team decision 2026-09-25).
  - zod schemas can produce an OpenAPI document later (`z.toJSONSchema` or zod-openapi) if an
    outside consumer ever needs one.
- **Alternatives rejected:**
  - `@hono/zod-openapi` with a generated OpenAPI 3.1 file: deferred, not needed for an
    in-repository UI.
  - The Hono RPC client (`hc<AppType>`): it needs every route chained on one expression for
    type inference, which makes route modules awkward and type checking slow with about 70
    routes. It also ties the UI to the server's app type rather than to a plain contract.

## R3. API docs page

- **Decision:** none in the MVP. The endpoint catalogue ([contracts/http-api.md](./contracts/http-api.md))
  and the JSDoc on `endpoints` are the human-readable documentation.

## R4. Verifying Supabase access tokens (FR-006, FR-007)

- **Decision:** `jose` 6.2.12, with verification in our own code:
  - `createRemoteJWKSet(new URL(`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`))`, held at
    module scope so its key cache is shared;
  - `jwtVerify(token, jwks, { issuer: `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1`, audience: 'authenticated',
    algorithms: ['ES256', 'RS256'] })`.

  After verification:
  - `sub` must be a UUID;
  - `role` must be `authenticated`, and `is_anonymous` must not be `true`;
  - `app_metadata.providers` (or `app_metadata.provider` when the list is absent) must include
    `google` (FR-008). This rule holds even when the sign-up hook is off;
  - any other result is `UNAUTHENTICATED`, with detail `provider` for the last rule.

  A JWKS fetch failure with no cached key matching is `AUTH_UNAVAILABLE` (503).
- **Rationale:**
  - Supabase projects use asymmetric signing keys (ES256 recommended), and Supabase documents
    this jose pattern.
  - Only `NEXT_PUBLIC_SUPABASE_URL` is needed: the key-set URL and the issuer are derived (FR-026 of spec
    002, minimal-env rule).
  - `supabase.auth.getClaims()` needs a publishable key (one more variable), checks neither
    `iss` nor `aud`, and silently falls back to a network `getUser` call for HS256 tokens.
- **Legacy HS256:** not supported. The project's Supabase instance must use JWT Signing Keys
  (asymmetric), which is the default for new projects. An HS256 token fails verification, so
  the check fails closed. This is written in quickstart.
- **Testability:** `createApp` takes a `verifyToken(token)` dependency. Production builds it from
  the remote JWKS. Tests build it from a local ES256 key pair (`generateKeyPair` +
  `createLocalJWKSet`), and sign tokens with `SignJWT` using the same issuer and audience. No
  network is used in tests.

## R5. Before User Created hook (FR-008b)

- **Decision:** `POST /api/v1/auth/hooks/before-user-created`, verified with
  `standardwebhooks` 1.1.1:
  - `new Webhook(secret.replace(/^v1,whsec_/, ''))`, because the library strips only `whsec_`,
    not `v1,`;
  - `.verify(rawBody, headers)` on the **raw** request text, before any JSON parsing.

  The route is outside the bearer-token middleware and outside zod body validation. The payload
  is parsed with zod after the signature check. Full behaviour: [contracts/signup-hook.md](./contracts/signup-hook.md).
- **Facts (Supabase docs):**
  - Payload `{ metadata: {uuid, time, name, ip_address}, user: {id, email, app_metadata:
    {provider, providers}, …} }`.
  - Allow = 200 `{}`. Reject = `{"error": {"http_code": 403, "message": …}}`.
  - Retries happen on 429/503 only (up to 3, with a 2 s back-off), within a 5 s total budget.
  - The signature timestamp tolerance is ±5 minutes (hard-coded in the library).
- **Provider backstop:** the hook rejects, with 403 and a message, a sign-up whose providers
  include neither `google` nor `email`. The rule then holds even if someone enables another
  provider in the dashboard. The allowed list is `DEFAULT_ALLOWED_PROVIDERS` in
  `src/integrations/supabase/providers.ts`, shared by the verifier, the hook and the callback.
- **Idempotency:** the same subject may arrive from a retry, from the first-request path, or
  both. "Ensure account" is idempotent (data-model.md).
- **Time budget:** the hook calls "ensure account" with one attempt and a 2 s lock wait, so the
  worst case (about 2 s) stays inside Supabase's 5 s budget. A lock or deadlock error becomes
  503, and Supabase retries.
- **Alternatives rejected:**
  - A Postgres-function hook: it runs in Supabase's Postgres and cannot reach MySQL.
  - Database Webhooks on `auth.users`: they need a public URL as well, fire *after* insert,
    and cannot deny a sign-up.
  - Custom Access Token hook to carry roles: constitution V forbids roles from the token.

## R13. Supabase redirect targets: callback and confirm (FR-008d)

- **Decision:** two Hono routes, `GET /api/v1/auth/callback` and `GET /api/v1/auth/confirm`,
  built on the `@supabase/ssr` 0.12.7 server client (`@supabase/supabase-js` 2.116.0).
  - Cookie adapter: `getAll` reads the request's `Cookie` header with `parseCookieHeader`, which
    includes the PKCE code verifier set when the UI started the sign-in. `setAll` appends
    `Set-Cookie` headers with `serializeCookieHeader`, and also applies the no-cache headers the
    library passes (`Cache-Control: private, no-store …`, `Expires`, `Pragma`), so a CDN never
    caches a session.
  - Callback: Supabase's Next.js pattern (`exchangeCodeForSession(code)`). An `?error=` from the
    provider is handled.
  - Confirm: Supabase's email-link pattern (`verifyOtp({ type, token_hash })`), with `type` one
    of signup, invite, magiclink, recovery, email_change or email.
  - `next` must be a same-site path. `//host` and full URLs fall back to `/`.
  - The redirect origin uses `x-forwarded-host` in production, as in the Supabase guide.
  - Failures go to `/auth/error?reason=…`. That page is part of the UI feature.
  - The provider rule is kept: after a session exists, a user whose providers include neither
    Google nor email is signed out with `signOut({ scope: 'local' })` (which clears the
    cookies) and refused with `reason=provider_not_allowed`. An accepted user gets the library
    account at once, through `ensureAccount`. If that write
    fails (for example, the database is down), the error is logged and the user is sent to
    `reason=account_unavailable`, not on to `next`. The session cookies stay, so a retry or the
    first API request (FR-008a) still creates the account.
- **Why in the Hono app and not as Next route handlers:** one API surface, the same
  request id and logging, and in-process tests with a stubbed Supabase client
  (`deps.supabaseAuth`), so there are no network calls in tests.
- **Configuration:**
  - Supabase Auth → URL Configuration: add `<origin>/api/v1/auth/callback` to the redirect
    allow list.
  - For email templates (if email flows are ever enabled), link to
    `{{ .SiteURL }}/api/v1/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/`.
  - Env: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (below). It is required by `src/env.ts`, so the
    app does not start without it. The `reason=not_configured` redirect remains for a test or
    embedding that builds the app without `supabaseAuth`.

## R14. Environment validation with `@t3-oss/env-nextjs`

- **Decision:** `src/env.ts` declares the app's environment with `createEnv` (0.13.11, zod 4):
  - `server`: `NODE_ENV`, `DB_HOST`, `DB_PORT` (coerced port), `DB_NAME`, `DB_USER`,
    `DB_PASSWORD`, and optional `AUTH_HOOK_SECRET` (`v1,whsec_…`);
  - `client`: `NEXT_PUBLIC_SUPABASE_URL` (http/https URL) and
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…` or a legacy anon JWT), listed in
    `experimental__runtimeEnv`, because Next inlines only the client values it can see;
  - `emptyStringAsUndefined: true`, so a blank `KEY=` counts as unset.

  `next.config.ts` imports `./src/env`, so `pnpm dev` and `pnpm build` fail at once with a
  readable list of missing or invalid variables. The API reads `env` in `server/api/deps.ts`. A
  server variable read from client code throws.
- **Scope:** app runtime only. The tsx scripts and the Vitest tests keep `src/lib/db/config.ts`,
  which loads `.env.local` itself and also needs the owner-only `MYSQL_ROOT_PASSWORD`. Putting
  owner secrets into the app schema would make the web app require them.
- **Alternatives rejected:** hand-written `process.env` checks, which were spread across
  `deps.ts` and threw late, at the first request.

## R6. Environment variables (spec 001 FR-030, minimal-env rule)

- **Decision:** three new variables. The two Supabase values carry Next's `NEXT_PUBLIC_`
  framework prefix, because the UI's browser client needs the same values (team decision,
  2026-09-25). That prefix is not a project prefix, so FR-030's "no project prefix" still holds.

  | Variable | Required | Why it cannot be derived |
  | --- | --- | --- |
  | `NEXT_PUBLIC_SUPABASE_URL` | yes, for any authenticated route | The project's own URL. The JWKS URL and issuer are derived from it |
  | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | for the auth redirects | The project's publishable key. The Supabase client needs it for `exchangeCodeForSession`/`verifyOtp` (R13) and in the browser. It is public by design |
  | `AUTH_HOOK_SECRET` | no | A secret generated by Supabase when the hook is created. When unset, the hook route returns 404 and only the first-request path provisions accounts |

  The Google OAuth client id and secret stay in
  the Supabase dashboard (`[auth.external.google]` for a local Supabase CLI setup).
- **Consequence:** spec 001 FR-030 and `.env.example` are updated in this feature (task), and
  the memory "minimal env vars" set grows by these two names.
- **Alternatives rejected:**
  - `SUPABASE_JWKS_URL` and `SUPABASE_JWT_ISSUER`: derivable.
  - `SUPABASE_ANON_KEY`: only needed by `getClaims` (R4).

## R7. Linking a signed-in account to a reader profile (Clarification A2)

- **Decision:** `app_users` stores no email (spec 001 FR-019), so the desk links by **account
  id**:
  - `GET /me` returns `accountId`, and the UI shows it (e.g. as "your library id").
  - A librarian calls `PUT /readers/{id}/account {accountId}`.
  - `readers_user_uq` rejects a second link (1062 → `DUPLICATE`).
- **Rationale:** no schema change and no personal data copied from Supabase.
- **Alternative (deferred):** match by the Google email from the token claim (`email`) against
  `readers.email` when the librarian searches. It is possible later without schema change,
  because the email is in the verified token. It is not automatic, because an email match alone
  is not proof of identity at the desk.

- **Update (2026-09-25, FR-008e):** a new account gets its own reader profile automatically.
  It is linked by id (`sub` → `app_users` → `readers.user_id`), never by email.
  - Email matching was tried and dropped. `readers.email` is typed at the desk and never
    verified, so a typo or a shared or reused address would expose another reader's loans and
    fines, and let someone reserve in their name.
  - The desk link above stays the only way to attach an existing profile, after the librarian
    checks identity (typically when issuing the card). The auto-created EXTERNAL profile can
    then be retired.

## R8. Business time and testability (FR-007)

- **Decision:** `createApp({ clock })`. Production uses `() => new Date()`. Every procedure gets
  `p_now = toDbTime(clock())` (UTC `YYYY-MM-DD HH:mm:ss.SSS`). No route accepts a time that is
  passed as `p_now`.
- **Time helpers** (`src/lib/time`): `date-fns` 4 with `UTCDate` (`@date-fns/utc`) formats and
  parses `DATETIME(3)` text in UTC. `TZDate` (`@date-fns/tz`) computes library-local month
  bounds in `Asia/Ho_Chi_Minh`. A test proves the named zone equals the database's fixed
  +07:00 offset for every month from 2000 to 2040 (Vietnam has no DST).
- **Rationale:**
  - Constitution III says procedures never use `NOW()`, so time must come from the caller.
  - Tests need overdue days and due dates to be deterministic, so they inject a fixed or
    advancing clock, as the spec 001 tests do with explicit `p_now`.

## R9. Database access from routes

- **Decision:**
  - State changes use `callProcedure(pool, 'sp_…', [accountId, now, …], {outParams})`,
    unchanged.
  - Reads and catalog/people/account writes use Drizzle (`drizzle-orm` 1.0.0-rc.4, already
    installed) or parameterized SQL on the same app-account pool.
  - Multi-row direct writes run in `db.transaction()` with the same 1213/1205 retry policy. It
    is a small `withRetry` helper extracted from `callProcedure`'s loop, so both paths share it.
  - `createApp({ pool })` takes the pool: production passes `src/lib/db` `pool`, and tests pass
    `testAppPool()` on `${DB_NAME}_test`.
- **Shared helpers moved to `src/lib`:**
  - `localMonthBounds` (now in `scripts/db/report.ts`) → `src/lib/time/local-month.ts`;
  - `findViolations` (now in `scripts/db/check.ts`) → `src/lib/db/invariants.ts`.

  The scripts re-import them, so there is one implementation.
- **Plain reads** (balances, availability counts) serve display only; they never decide a write
  (constitution III).

## R10. Search implementation (FR-015, SC-007)

- **Decision:** `q` uses the existing FULLTEXT index `books_title_ft` (`MATCH … AGAINST (? IN
  BOOLEAN MODE)` with each term suffixed `*`), plus `authors.name LIKE 'q%'` through a join, as a
  `UNION` of book ids. It is then paged. Availability counts come from one grouped query over
  `book_copies(book_id, circulation_status)` for the page's ids.
- **Rationale:** these are the indexes spec 001 already built. An `EXPLAIN` of the search is
  added to `pnpm db:explain` (constitution: key search queries ship with an EXPLAIN).
- **Short terms:** InnoDB's default `innodb_ft_min_token_size` is 3, so terms under 3 characters
  fall back to `title LIKE 'q%'`.

## R11. Testing approach

- **Decision:** Vitest, in a new `tests/api/` folder that runs against the same test schema and
  global setup.
  - Each test builds `createApp({ pool: testAppPool(), clock, verifyToken: localVerifier,
    hookSecret })` and calls `app.request('/api/v1/…')`. No HTTP server and no network.
  - Tokens are signed locally (R4).
  - Hook calls are signed with `standardwebhooks` `sign()` using a test secret.
  - Fixtures are reused from `tests/helpers/fixtures.ts`. The invariants-after-each hook
    already runs.
- **Concurrency over HTTP (SC-004):** 20 parallel `app.request` checkouts of one copy, then
  check that exactly one returned 201. That is enough, because each call goes through
  `callProcedure` on its own pooled connection.
- **Script:** `pnpm test:api` = `vitest run tests/api`.

## R12. Security headers and CORS

- **Decision:**
  - The app and the API share one origin, so no CORS middleware is added (the spec's
    Assumption: no third-party consumers).
  - `hono/secure-headers` sets `X-Content-Type-Options`, `Referrer-Policy` and
    `X-Frame-Options` on API responses.
  - Body size is limited to 64 KB with `hono/body-limit`.
  - Tokens are read only from the `Authorization` header. No cookies are used by the API, so
    CSRF does not apply.
- **Rationale:** the smallest set that closes the obvious gaps without new variables.
