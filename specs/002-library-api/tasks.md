---

description: "Task list for spec 002: Library API contract and server routes"
---

# Tasks: Library API Contract and Server Routes

**Input**: Design documents from `specs/002-library-api/`: plan.md, spec.md, research.md,
data-model.md, contracts/ (http-api.md, errors.md, signup-hook.md), quickstart.md.

**Prerequisites**: spec 001 is migrated and seeded (`pnpm db:up && pnpm db:migrate`), and the
test schema is reset (`pnpm db:reset-test`).

**Tests**: REQUIRED. Constitution quality gates, spec SC-001–SC-010 and quickstart.md all ask
for automated tests. In each story, write the tests first and see them fail, then implement.

**Organization**: tasks are grouped by the user stories of spec.md (US1–US7). Work stays on
branch `001-library-db-design`; the team switches to a 002 branch once, at the end.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: US1–US7 from spec.md.

## Conventions every task follows

- **Business time:** it comes only from `c.var.now` (the injected clock, research R8). It is
  passed as `p_now` in `YYYY-MM-DD HH:mm:ss.SSS` UTC. No input schema accepts `now`,
  `actorUserId` or similar, because every input is `z.strictObject` (FR-007).
- **State changes:** every change to circulation, card, policy, reservation or money goes
  through `callProcedure` (`src/lib/db/call-procedure.ts`) with `[caller.accountId, now, …]`
  (FR-023). Never write those tables directly.
- **Wire formats** (data-model.md "Conventions"):
  - ids are integers;
  - instants are ISO 8601 UTC with ms and a `Z` suffix;
  - money is whole-đồng integers, and field names end in `Vnd`;
  - enums use spec 001's lowercase codes.
- **Routes:** each route is registered with `route(app, endpoints.<name>, handler)`, and each
  handler returns the endpoint's `Out` type (research R2).
- **Errors:** every error goes through `mapError` to the body in contracts/errors.md.
- **Tests:**
  - they live in `tests/api/*.test.ts`;
  - they build the app with `createTestApp()` from `tests/api/helpers/app.ts` and call
    `app.request('/api/v1/…')`;
  - they seed data with `tests/helpers/fixtures.ts`;
  - the existing invariants-after-each hook applies.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencies, scripts, env vars, and the helpers shared with spec 001's scripts.

- [X] T001 Add pinned runtime dependencies to `package.json` with `pnpm add`, then run `pnpm install` and commit the updated `pnpm-lock.yaml`:
  - `hono@4.13.8`
  - ~~`@hono/zod-validator@0.9.1`~~ (installed, then removed: `route()` parses inputs with the zod schemas directly, so the error mapping stays in one place)
  - `zod@4.6.5`
  - `jose@6.2.12`
  - `standardwebhooks@1.1.1`
- [X] T002 Add the script `"test:api": "vitest run tests/api"` to `package.json`.
- [X] T003 [P] Add the two new environment variables:
  - In `.env.example`, add a commented block explaining that `NEXT_PUBLIC_SUPABASE_URL` is required for authenticated routes (the JWKS URL and the issuer are derived from it), and that `AUTH_HOOK_SECRET` is optional (format `v1,whsec_…`; when unset the sign-up hook route returns 404). Use generic placeholder values.
  - In `specs/001-library-db-design/spec.md` FR-030, add both variables with these reasons (research R6), and add a line that `NEXT_PUBLIC_SUPABASE_URL` is required by spec 002.
- [X] T004 [P] Move `localMonthBounds(month: string): [string, string]` from `scripts/db/report.ts` to `src/lib/time/local-month.ts` without changing behaviour. `scripts/db/report.ts` then imports it from there.
- [X] T005 [P] Move `findViolations(conn)` and its `Violation` type from `scripts/db/check.ts` to `src/lib/db/invariants.ts`. Widen the parameter to accept a `Pool` or a `Connection` (both have `.query`). `scripts/db/check.ts` then imports it.
- [X] T006 [P] Create `src/lib/time/db-time.ts` with two functions, and unit-test them in `tests/api/db-time.test.ts`:
  - `toDbTime(d: Date): string` → `'YYYY-MM-DD HH:mm:ss.SSS'` UTC;
  - `fromDbTime(s: string | null): string | null` → ISO `…Z`.
- [X] T007 Extract the deadlock/lock-wait retry loop from `callProcedure` into `src/lib/db/with-retry.ts`, as `withRetry<T>(fn: () => Promise<T>, attempts = 3)`:
  - retry only errno 1213 and 1205;
  - wait 50–200 ms at random between attempts.

  Refactor `src/lib/db/call-procedure.ts` to use it, with no behaviour change. `pnpm test:db` must still pass.
- [X] T008 [P] Add an ESLint `no-restricted-imports` override in `eslint.config.mjs` so files under `src/lib/api/**` cannot import any of:
  - `mysql2`, `drizzle-orm`, `jose`, `standardwebhooks`;
  - `@/lib/db/**`, `@/server/**`, `@/integrations/**`, and any relative path into those folders.

  This keeps the contract importable by the UI (plan "Structure Decision").

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract skeleton, the app factory, request context, errors, auth and access.
Every story depends on this phase.

**⚠️ CRITICAL**: no story work can begin until this phase is complete.

- [X] T009 Create `src/lib/api/contract/common.ts`. It imports only `zod`, and exports:
  - `Id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)`;
  - `IdParam`;
  - `Instant = z.iso.datetime({ offset: false, precision: 3 })`, plus an input variant that accepts any ISO datetime;
  - `LocalMonth = /^\d{4}-(0[1-9]|1[0-2])$/`;
  - `Money = z.number().int().min(0)` and `SignedMoney` (non-zero int);
  - `PageQuery` (`page` ≥ 1, default 1; `pageSize` 1–100, default 20; FR-016);
  - `interface Page<T> { items: T[]; page: number; pageSize: number; total: number }`.
- [X] T010 Create `src/lib/api/contract/errors.ts` with:
  - `ERROR_KEYS`, an `as const` array holding every key in contracts/errors.md: the spec 001 keys plus `UNAUTHENTICATED`, `ACCOUNT_INACTIVE`, `ROUTE_NOT_FOUND`, `BUSY`, `AUTH_UNAVAILABLE`, `INTERNAL`;
  - `type ErrorKey`;
  - `type ErrorCategory` = `'unauthenticated' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'busy' | 'unavailable' | 'internal'`;
  - `ERROR_CATEGORY: Record<ErrorKey, ErrorCategory>`;
  - `CATEGORY_STATUS` (401/403/404/400/409/503/503/500);
  - `ERROR_MESSAGES`, with one sentence per key, per-detail messages for `RENEWAL_REJECTED`, and the per-index `DUPLICATE` messages from contracts/errors.md "Messages";
  - `interface ApiErrorBody { error: { key: ErrorKey | string; category: ErrorCategory; message: string; detail: string; fields?: {path: string; message: string}[]; requestId: string } }`.
- [X] T011 Create `src/lib/api/contract/endpoint.ts` with:
  - `type Access = { kind: 'public' } | { kind: 'token' } | { kind: 'signed-in' } | { kind: 'perm'; any: Permission[] } | { kind: 'self-or'; any: Permission[]; readerParam: string } | { kind: 'procedure' } | { kind: 'webhook' }`. Here `'token'` means verified but inactive accounts are allowed (only `GET /me`), and `'procedure'` means signed-in with the DB deciding permission;
  - `type Permission`, the 12 codes of spec 001 FR-020;
  - `defineEndpoint<Out>()({ method, path, params?, query?, body?, access, procedure?, errors })`. It returns a frozen object that carries phantom `In`/`Out` types, and `path` uses Hono `:param` syntax relative to `/api/v1`;
  - the helper types `InputOf<E>` and `OutputOf<E>`.
- [X] T012 Create `src/lib/api/contract/me.ts` and `src/lib/api/contract/index.ts`:
  - In `me.ts`, add `interface Me { accountId; status: 'active' | 'inactive'; roles: string[]; permissions: string[]; reader: { id; fullName; readerType; status } | null }` and the endpoints `health` (`GET /health`, public, `Out {status: 'ok'}`) and `me` (`GET /me`, access `token`).
  - In `index.ts`, re-export everything and export `endpoints`, an object that merges each area's endpoints. Areas are added by later tasks.
- [X] T013 Create `src/server/api/context.ts` with:
  - `type Caller = { accountId: number; subject: string; status: 'active' | 'inactive'; roles: string[]; permissions: Set<string>; readerId: number | null }`;
  - `type AppEnv = { Variables: { requestId: string; now: Date; dbNow: string; caller?: Caller } }`;
  - `interface ApiDeps { pool: Pool; clock: () => Date; verifyToken: (token: string) => Promise<{ sub: string }>; hookSecret?: string; logger?: Pick<Console, 'error' | 'info'> }`.
- [X] T014 Create `src/server/api/errors/api-error.ts` (`class ApiError extends Error { key; category; detail; fields? }`, plus helpers `notFound(detail)`, `forbidden(perm)`, `validation(fields)`) and `src/server/api/errors/map-error.ts` (`mapError(err, requestId, logger): { status, body: ApiErrorBody, headers }`), following the contracts/errors.md "Sources and mapping" table exactly:
  - `ApiError` passes through;
  - `DbRuleError` → its key and detail; an unknown key → category `conflict`;
  - `ZodError` → `VALIDATION` with `fields` (dotted `path`);
  - a JSON parse error or 415 from the validator → `VALIDATION`;
  - errno 1213/1205 → `BUSY` with `Retry-After: 1`;
  - errno 1452 → `NOT_FOUND`;
  - anything else (including 3819, 1142, 1370 and connection errors) → `INTERNAL` with an empty `detail`. Log the full error with `requestId`, and never return the SQL message (FR-022).
- [X] T015 Create `src/integrations/supabase/verify-token.ts` with `createSupabaseVerifier(supabaseUrl: string)`, which returns a `verifyToken` function:
  - Hold one module-scope `createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`))` per URL.
  - Call `jwtVerify` with issuer `${url}/auth/v1`, audience `'authenticated'` and algorithms `['ES256', 'RS256']`.
  - Afterwards require that `sub` is a UUID, `role === 'authenticated'`, and `is_anonymous !== true`.
  - Also require that `app_metadata.providers` (or `app_metadata.provider` when the list is absent) includes `'google'`; if not, throw `ApiError('UNAUTHENTICATED')` with detail `provider` (FR-008).
  - Throw `ApiError('UNAUTHENTICATED')` on any verification failure, and `ApiError('AUTH_UNAVAILABLE')` when the JWKS fetch fails (jose `JWKSTimeout`, or an `ERR_JWKS_*` error caused by a network failure).
  - Also export `createLocalVerifier(jwks: JSONWebKeySet, issuer: string)` for tests (research R4).
- [X] T016 Create `src/server/api/services/accounts.ts` with two functions:
  - **`ensureAccount(pool, subject, dbNow, { attempts = 3, lockWaitSeconds }?): Promise<{ accountId: number; created: boolean }>`**, exactly as in data-model.md "Account provisioning". `lockWaitSeconds` (when given) sets `SET SESSION innodb_lock_wait_timeout = ?` on the connection first. In one transaction, wrapped in `withRetry(fn, attempts)`:
    - run `INSERT INTO app_users (supabase_user_id, status, created_at) VALUES (?, 'active', ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`;
    - when `affectedRows === 1`, run `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'reader'`;
    - an existing account is never changed (FR-008).
  - **`resolveCaller(pool, subject): Promise<Caller | null>`**: one read-only query by `app_users.supabase_user_id` returning id, status, roles, de-duplicated permissions, and `readers.id WHERE user_id = app_users.id`. It returns `null` when there is no account. It never writes (data-model.md "Request path").
- [X] T017 Create `src/server/api/middleware/request-id.ts`. It:
  - accepts an incoming `X-Request-Id` that matches `/^[A-Za-z0-9._-]{8,64}$/`, or generates `crypto.randomUUID()`;
  - sets `c.var.requestId`, `c.var.now = deps.clock()` and `c.var.dbNow = toDbTime(now)`;
  - echoes `X-Request-Id` on the response.
- [X] T018 Create `src/server/api/middleware/auth.ts` with `authenticate(deps, mode: 'optional' | 'required' | 'allow-inactive')`:
  - read only `Authorization: Bearer <token>`; a missing or malformed header in the required modes → `UNAUTHENTICATED`;
  - call `deps.verifyToken`, then `resolveCaller(sub)`. Only when it returns `null`, call `ensureAccount` and then `resolveCaller` again (FR-008a). A known subject never writes. Set `c.var.caller`;
  - an `inactive` caller in mode `required` → `ACCOUNT_INACTIVE` (FR-011).
- [X] T019 Create `src/server/api/middleware/access.ts` with `enforceAccess(access: Access)`, run after `authenticate`:
  - `perm`: the caller holds at least one of `any`, else `FORBIDDEN` with detail = the first code;
  - `self-or`: allowed if `caller.readerId === Number(param(readerParam))` or the caller holds one of `any`; otherwise throw `NOT_FOUND` with detail `reader` (the same body as a missing id, FR-010);
  - `procedure` and `signed-in`: no check beyond authentication.
- [X] T020 Create `src/server/api/define-route.ts` with `route<E>(app, endpoint: E, handler: (c, input: InputOf<E>) => Promise<{ status: 200 | 201 | 204; body?: OutputOf<E> }>)`. It:
  - registers `app.on(endpoint.method, endpoint.path, …)`;
  - picks the auth mode from `endpoint.access` (`public` → optional, `token` → allow-inactive, `webhook` → none, otherwise required);
  - adds `zValidator('param' | 'query' | 'json', schema, hook)` for each declared schema, where the hook throws the `ZodError` so `mapError` formats it;
  - runs `enforceAccess`, then the handler, and returns `c.json(body, status)` (or `c.body(null, 204)`);
  - records the endpoint in a module-level `mounted` set, which the coverage test reads.
- [X] T021 Create `src/server/api/app.ts` with `createApp(deps: ApiDeps)`. It builds `new Hono<AppEnv>().basePath('/api/v1')` and:
  - uses `hono/secure-headers` and `hono/body-limit` (64 KB → `VALIDATION`), then the request-id middleware;
  - mounts every route module (each exports `register(app, deps)`);
  - sets `app.onError` to `mapError` and `app.notFound` to `ROUTE_NOT_FOUND`;
  - has no import-time side effects.
- [X] T022 Create `src/server/api/deps.ts` with `productionDeps()`:
  - `pool` from `src/lib/db/index.ts`;
  - `clock: () => new Date()`;
  - `verifyToken` from `createSupabaseVerifier(process.env.NEXT_PUBLIC_SUPABASE_URL)`. When `NEXT_PUBLIC_SUPABASE_URL` is unset, return a verifier that throws `AUTH_UNAVAILABLE` (quickstart "Expected failure modes");
  - `hookSecret: process.env.AUTH_HOOK_SECRET || undefined`.
- [X] T023 Create `src/app/api/[[...route]]/route.ts`:
  - `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`;
  - create the app once with `createApp(productionDeps())`;
  - `export const GET = handle(app)` from `hono/vercel`, and the same for POST, PUT, PATCH and DELETE (research R1).
- [X] T024 Create `src/lib/api/client.ts` with `apiFetch<E>(endpoint: E, input: InputOf<E>, opts: { token?: string; baseUrl?: string; fetch?: typeof fetch }): Promise<OutputOf<E>>`. It:
  - fills the `:params` into the path;
  - serializes the query and the JSON body;
  - adds `Authorization` when a token is given;
  - on a non-2xx response throws `class ApiClientError extends Error { status; body: ApiErrorBody }`.

  It uses only `fetch` and the contract module.
- [X] T025 Create the test helpers:
  - **`tests/api/helpers/tokens.ts`:**
    - one ES256 key pair made once with jose `generateKeyPair`;
    - exported `TEST_ISSUER = 'https://test.supabase.local/auth/v1'`;
    - `signToken({ sub, expiresIn = '5m', ...claims })`, with `aud: 'authenticated'`, `role: 'authenticated'` and `app_metadata: { provider: 'google', providers: ['google'] }` as defaults;
    - `localVerifier`.
  - **`tests/api/helpers/app.ts`:**
    - `createTestApp({ clock?, hookSecret? })`, which uses `testAppPool()` from `tests/helpers/db.ts`, a settable fixed clock, and `localVerifier`;
    - `createTestApp` also mounts two test-only probe endpoints through `route()`, defined in `tests/api/helpers/probe.ts`, never in `src/`:
      - `POST /__probe/echo`: access `signed-in`, body `z.strictObject({ note: z.string().max(10) })`, returns `{ accountId }`;
      - `GET /__probe/admin`: access `perm` `['role.manage']`, returns `{ ok: true }`.

      US1 tests use them, so they do not depend on routes from later stories;
    - `req(app, method, path, { token?, body?, query? })`, which returns `{ status, body, headers }`;
    - `asAccount(roles)`, which creates an account with `fixtures.account()` and returns `{ accountId, token }`, where the token's `sub` is that account's `supabase_user_id` (read it back with `ownerConn`).
  - **`tests/api/helpers/hook.ts`:** `signHook(secret, payload, { timestamp? })`, which uses `standardwebhooks` `Webhook.sign`.

**Checkpoint**: `pnpm typecheck` passes, and `GET /api/v1/health` works under `pnpm dev`.

---

## Phase 3: User Story 1 - Verified identity and a shared typed contract (Priority: P1) 🎯 MVP

**Goal**: every request is tied to one verified account. The contract module and coverage
check exist. Accounts are provisioned on the first request and by the sign-up hook.

**Independent Test**: spec US1 "Independent Test", using `GET /me` plus one privileged route
from a later story (a stub `GET /admin/health` is enough), with every token variant.

### Tests for User Story 1

- [X] T026 [P] [US1] Write `tests/api/identity.test.ts` (FR-006–FR-011, SC-003, US1-1…5). Cases:
  - no header, `Bearer` with garbage, an expired token, the wrong issuer, the wrong audience, `is_anonymous: true`, and a token signed by a different key → 401 `UNAUTHENTICATED` with `WWW-Authenticate: Bearer`, and no `app_users` row created;
  - `POST /__probe/echo` with `{note, actorUserId}` → 400 `VALIDATION` with `fields[0].path = 'actorUserId'`; with `{note}` and a spoofed `?actorUserId=` query → 200, and `accountId` is the token's account (US1-2);
  - an inactive account → 403 `ACCOUNT_INACTIVE` on a normal route, but 200 on `/me`;
  - a token with `user_metadata.role: 'admin'` for a reader account → 403 `FORBIDDEN` on `GET /__probe/admin`, and 200 for an admin account;
  - a verified token with `app_metadata.provider: 'email'` → 401, detail `provider`, and no `app_users` row;
  - `X-Request-Id` is present on every response.
- [X] T027 [P] [US1] Write `tests/api/provisioning.test.ts` (FR-008, FR-008a, SC-010, US1-4):
  - the first `GET /me` for a new `sub` → 200, `roles: ['reader']`, `permissions: []`, `reader: null`;
  - 20 parallel first requests for one `sub` → exactly 1 `app_users` row and 1 `user_roles` row;
  - an existing inactive account keeps its status, and an existing librarian keeps its roles.
- [X] T028 [P] [US1] Write `tests/api/signup-hook.test.ts`, covering the 5 cases in contracts/signup-hook.md "Tests":
  - a valid Google payload → 200 `{}` and an account; a repeat delivery → still one account;
  - the hook and a first `/me` for the same subject in parallel → one account;
  - a wrong secret, a tampered body, or a timestamp 6 minutes old → 401 and nothing written;
  - provider `email` → 403 with `{"error": {"http_code": 403, …}}`;
  - no `hookSecret` → 404.
- [X] T029 [P] [US1] Write `tests/api/errors.test.ts`:
  - a unit test of `mapError` for every row of contracts/errors.md "Sources and mapping". Use a synthetic `DbRuleError`, a mysql error with errno 1213, 1205, 1452, 3819 or 1142, a `ZodError`, and a plain `Error`;
  - assert the status, key, category and `Retry-After`, and that `detail` is empty for `INTERNAL`.
- [X] T030 [P] [US1] Write `tests/api/coverage.test.ts` (FR-002, SC-001), with three checks:
  - every value of `endpoints` is in the `mounted` set after `createTestApp()`;
  - every public procedure (from `information_schema.ROUTINES` where `ROUTINE_TYPE='PROCEDURE' AND ROUTINE_NAME LIKE 'sp\_%' AND ROUTINE_NAME NOT LIKE 'sp\_\_%'`) is the `procedure` of some endpoint;
  - every key that appears in a `SIGNAL` message in `drizzle/*/migration.sql` is in `ERROR_KEYS`. Scan each `SET MESSAGE_TEXT = …;` statement, including `CONCAT(…)` forms, for the regex `'([A-Z][A-Z_]+):` anywhere in it.

  Mark the procedure-coverage check `todo` until Phase 9, then remove the marker.

### Implementation for User Story 1

- [X] T031 [US1] Create `src/server/api/routes/meta.ts` with `GET /health` (it does not touch the DB) and `GET /me`. `/me` returns `Me` from `c.var.caller`, plus the reader summary (`readers.full_name`, reader type code, status) when `readerId` is set.
- [X] T032 [US1] Create `src/integrations/supabase/signup-hook.ts`. It:
  - verifies with `standardwebhooks`: `new Webhook(secret.replace(/^v1,whsec_/, '')).verify(rawBody, headersObject)`;
  - exports the zod `HookPayload` (`metadata.name === 'before-user-created'`, `user.id` a UUID, `user.app_metadata.provider`, `user.is_anonymous?`, passthrough for other fields).
- [X] T033 [US1] Create `src/server/api/routes/signup-hook.ts` with `POST /auth/hooks/before-user-created` (access `webhook`), and the endpoint `signupHook` in `src/lib/api/contract/me.ts`. Its behaviour follows contracts/signup-hook.md "Processing" and "Responses":
  - read the raw text before any parsing;
  - when `deps.hookSecret` is unset → 404 `ROUTE_NOT_FOUND`;
  - an invalid signature → 401, an invalid payload → 400, a provider other than `google` or an anonymous user → 403, each with body `{"error": {"http_code", "message"}}`;
  - otherwise call `ensureAccount(pool, user.id, dbNow, { attempts: 1, lockWaitSeconds: 2 })`, so the worst case is about 2 s, inside Supabase's 5 s budget;
  - a busy or connection error → 503 with `Retry-After: 1`;
  - log `{requestId, webhookId, subject, created}` and never the email.
- [X] T034 [US1] Register the meta and signup-hook modules in `src/server/api/app.ts`, then run T026–T030. Only the coverage procedure check stays `todo`.

**Checkpoint**: the MVP is done. Identity, provisioning (both paths), error mapping and the
contract skeleton all work and are tested.

---

## Phase 4: User Story 2 - Circulation desk (Priority: P1)

**Goal**: checkout, return, declare lost and renew, with desk scans by card number and by barcode.

**Independent Test**: spec US2. Replay the spec 001 desk scenarios over HTTP with an injected
clock, using fixtures to seed the books, copies, readers, cards and policies.

### Tests for User Story 2

- [X] T035 [P] [US2] Write `tests/api/circulation.test.ts` (US2-1…6, US2-9, SC-008). Cases:
  - checkout of 2 copies → 201 with 2 items and their `dueAt`;
  - checkout of 3 copies where one is on loan → 409 `COPY_NOT_AVAILABLE`, and nothing written;
  - `CARD_INVALID`, `DEBT_BLOCKED`, `OVERDUE_BLOCKED` and `LIMIT_REACHED`, each as a 409 with its key;
  - an overdue return (clock moved forward 3 days) → 200 with the late fine;
  - a damaged return with a fine and reason → 200 with the damage fine, and the copy is `in_repair` according to `GET /copies/by-barcode`;
  - lost → 200 with the late and lost fines;
  - renew → 200 `newDueAt`, and the four `RENEWAL_REJECTED` details (`not_on_loan`, `overdue`, `limit`, `reserved`);
  - an account without `loan.checkout` → 403 `FORBIDDEN`;
  - `copyIds: []` → 400 with `fields[0].path = 'copyIds'`.
- [X] T036 [P] [US2] Write `tests/api/concurrency.test.ts` (SC-004, US2-7, US2-8):
  - 20 parallel `POST /loans` for the same copy by 20 eligible readers → exactly one 201 and 19 409 `COPY_NOT_AVAILABLE`;
  - `findViolations` returns nothing;
  - `BUSY` is covered by mapping a forced 1205. Use a pool whose `getConnection` returns a connection that throws errno 1205 on `CALL`, and expect 503 `BUSY` with `Retry-After`.

### Implementation for User Story 2

- [X] T037 [P] [US2] Create `src/lib/api/contract/circulation.ts` with:
  - `CheckoutInput = z.strictObject({ readerId: Id, copyIds: z.array(Id).min(1).max(20) })`, with a refine that rejects duplicate ids;
  - `CheckoutResult { loanId; items: { loanItemId; copyId; dueAt }[] }`;
  - `ReturnInput = z.strictObject({ condition: z.enum(['good', 'worn', 'damaged']), damagedFineVnd: Money.optional(), reason: z.string().trim().max(255).optional() })`;
  - `LostInput = z.strictObject({ lostFineVnd: Money.optional(), reason: z.string().trim().max(255).optional() })`;
  - `FinesResult { fines: { id; type: 'late' | 'damaged' | 'lost'; amountVnd }[] }` and `RenewResult { loanItemId; newDueAt }`;
  - `LoanItem`, with the exact fields from data-model.md "Circulation";
  - `LoanItemsQuery = PageQuery.extend({ status: z.enum(['on_loan', 'returned', 'lost']).optional(), overdue: z.stringbool().optional() })`;
  - the endpoints `checkout`, `returnItem`, `declareLost`, `renew`, `readerLoanItems` (self-or `loan.checkout` / `loan.return`, readerParam `readerId`), `copyByBarcode` and `cardByNumber`, each with access, procedure and errors as in contracts/http-api.md "Circulation".
  - Each endpoint entry has a JSDoc comment stating its access rule and error keys (FR-003).
- [X] T038 [P] [US2] Create `src/server/api/services/procedures.ts` with typed wrappers over `callProcedure`, taking `(pool, accountId, dbNow, …)`:
  - `checkout(readerId, copyIds)` passes `JSON.stringify(copyIds)` and maps the first result set to `CheckoutResult`;
  - `returnItem(loanItemId, condition, damagedFineVnd ?? null, reason ?? null)` maps the fines result set;
  - `declareLost(loanItemId, lostFineVnd ?? null, reason ?? null)`;
  - `renew(loanItemId)` uses `outParams: ['p_new_due_at']`.

  Convert times with `fromDbTime`. Later stories append more wrappers to this file.
- [X] T039 [P] [US2] Create `src/server/api/queries/loans.ts` with:
  - `listReaderLoanItems(pool, readerId, now, { status, overdue, page, pageSize })`, joining `loan_items`, `loans`, `book_copies` and `books`, plus the fines per item. It is ordered by `borrowed_at DESC, id DESC`, returns `total`, and computes `overdue = status = 'on_loan' AND due_at < now`;
  - `copyByBarcode(pool, barcode)`, which returns a Copy plus `openLoanItemId` and `heldFor`;
  - `cardByNumber(pool, cardNumber)`, which returns the Card plus the Reader summary.
- [X] T040 [US2] Create `src/server/api/routes/loans.ts` with the routes `POST /loans`, `POST /loan-items/:loanItemId/return`, `POST /loan-items/:loanItemId/lost`, `POST /loan-items/:loanItemId/renew`, `GET /readers/:readerId/loan-items`, `GET /copies/by-barcode/:barcode` and `GET /cards/by-number/:cardNumber`:
  - the reader's own view omits `copy.barcode` (data-model.md "LoanItem");
  - register the module in `app.ts`;
  - add the endpoints to `endpoints` in `src/lib/api/contract/index.ts`.

**Checkpoint**: the desk flow works over HTTP, and T035–T036 pass.

---

## Phase 5: User Story 3 - Catalog and copies (Priority: P1)

**Goal**: public search and detail (view and search only), catalog management, copy
registration and copy status changes.

**Independent Test**: spec US3.

### Tests for User Story 3

- [X] T041 [P] [US3] Write `tests/api/public-catalog.test.ts` (US3-1, Clarification A1):
  - search without a token by a title word and by an author prefix returns pages with `copies.available` and `copies.total`;
  - the JSON contains no `barcode`, `shelfCode`, `replacementCostVnd` or reader data;
  - a retired book → 404;
  - `categoryId` includes child categories;
  - an exact identifier match works;
  - a 2-letter `q` falls back to the prefix search;
  - `pageSize: 101` → 400.
- [X] T042 [P] [US3] Write `tests/api/catalog.test.ts` (US3-2…6):
  - create a book with no ISBN, 2 ordered authors and 2 categories → 201, and the relations are returned in order;
  - PATCH with `authorIds` replaces the set;
  - an unknown `publisherId` → 404 with detail `publisherId`;
  - a duplicate barcode → 409 `DUPLICATE` with detail `book_copies_barcode_uq`;
  - sending a copy that is on loan to repair → 409 `INVALID_TRANSITION`;
  - registering a good copy of a book with a waiting reservation → the Copy is `on_hold` with `heldFor` set;
  - a reader account → 403 on `POST /books`.

### Implementation for User Story 3

- [X] T043 [P] [US3] Create `src/lib/api/contract/catalog.ts` with the schemas and types from data-model.md "Public catalog" and "Catalog management", quoting the constraints exactly:
  - `BookInput`:
    - `title` "required, 1–500 chars, trimmed";
    - `coverUrl` "must be `https:`";
    - `publishedYear` "optional integer 0–9999";
    - `languageCode` "≤ 16 chars";
    - `materialType` required code;
    - `replacementCostVnd` "optional integer ≥ 0";
    - `authorIds` "ordered array of existing author ids, 1–20, distinct";
    - `categoryIds` "0–20, distinct";
    - `identifiers` "`{type: ISBN_10 | ISBN_13 | OTHER, value}`, 0–10, distinct per book".
  - `BookUpdateInput`: the same object with every field optional, plus `status: 'active' | 'retired'`.
  - `AuthorInput` and `PublisherInput` (`name` 1–200), and `CategoryInput` (`name` 1–200, `parentId?`).
  - `RegisterCopyInput`: `barcode` 1–64, `shelfCode?`, `acquiredAt?` as `YYYY-MM-DD`, `condition` good/worn/damaged.
  - `ChangeCopyStatusInput`: `targetStatus` available/in_repair/retired, and `condition`.
  - `CatalogSearchQuery`: `q?`, `categoryId?`, `identifier?`, `materialType?`, plus paging.
  - The interfaces `BookSummary`, `BookDetail`, `BookAdmin`, `Author`, `Publisher`, `Category` and `Copy`.
  - The endpoints from contracts/http-api.md "Public catalog" and "Catalog management".
  - Each endpoint entry has a JSDoc comment stating its access rule and error keys (FR-003).
- [X] T044 [P] [US3] Create `src/server/api/queries/catalog-search.ts` (research R10). It:
  - collects the ids of `status='active'` books that match:
    - `MATCH(title, subtitle) AGAINST (? IN BOOLEAN MODE)`, with each term of 3+ chars sanitized of `+-<>()~*"@` and suffixed with `*`;
    - `UNION` `authors.name LIKE CONCAT(?, '%')`;
    - a fallback `title LIKE CONCAT(?, '%')` when every term is shorter than 3;
  - filters by `categoryId`, including its direct children, by exact `book_identifiers.identifier_value`, and by `material_types.code`;
  - orders by title, id and paginates, with a `total` count;
  - loads the authors (by `author_order`), categories and grouped copy counts for the page's ids in 3 queries. `copies.total` excludes `retired` and `lost`.

  Also export `getPublicBook(pool, id)`.
- [X] T045 [P] [US3] Create `src/server/api/queries/catalog-admin.ts` with:
  - `createBook(pool, input)` and `updateBook(pool, id, input)`. Each runs one `withRetry` transaction that writes `books` (`created_at`/`updated_at = dbNow`), then replaces `book_authors` (`author_order` = array index + 1), `book_categories` and `book_identifiers`. They first verify that `materialType`, `publisherId`, `authorIds` and `categoryIds` exist, and throw `NOT_FOUND` with the field name;
  - `getBookAdmin`;
  - list and create functions for authors, publishers and categories (a `LIKE` prefix search for `q`);
  - `listCopies(pool, bookId)`.
- [X] T046 [US3] Add `registerCopy` (`outParams: ['p_copy_id']`) and `changeCopyStatus` to `src/server/api/services/procedures.ts`.
- [X] T047 [US3] Create `src/server/api/routes/public-catalog.ts` (`GET /catalog/books`, `GET /catalog/books/:bookId`, `GET /catalog/categories`, all public), `src/server/api/routes/catalog.ts` (books, authors, publishers, categories) and `src/server/api/routes/copies.ts` (`GET`/`POST /books/:bookId/copies`, `POST /copies/:copyId/status`, which returns the re-read Copy). Register them in `app.ts` and in `endpoints`.
- [X] T048 [US3] Add the catalog search query from T044, with a representative `q`, to the `EXPLAIN` list in `scripts/db/explain.ts`, following the constitution rule "key report and search queries MUST be accompanied by an EXPLAIN analysis".

**Checkpoint**: the catalog is visible without a token, librarians can manage it, and T041–T042 pass.

---

## Phase 6: User Story 4 - Readers, cards and loan policies (Priority: P2)

**Goal**: reader management, linking an account to a reader, cards, policy versions and card
expiry.

**Independent Test**: spec US4.

### Tests for User Story 4

- [X] T049 [P] [US4] Write `tests/api/people.test.ts` (US4-1…5):
  - create and patch a reader;
  - link an account → the account's `/me` shows the reader;
  - a second link of the same account → 409 `DUPLICATE` with detail `readers_user_uq`, and re-linking an already linked reader → 400 `VALIDATION`;
  - issue a card; a second active card → 409 `DUPLICATE` `library_cards_active_reader_uq`;
  - `POST /cards/:id/status {status: 'active'}` → 400 `VALIDATION` (not an allowed target), and `{status: 'lost'}` on a card that is already lost → 409 `INVALID_TRANSITION`;
  - an overlapping policy → 409 `POLICY_OVERLAP`;
  - a librarian creating a policy → 403;
  - close then create works;
  - `POST /jobs/expire-cards` returns a `count`.

### Implementation for User Story 4

- [X] T050 [P] [US4] Create `src/lib/api/contract/people.ts` with:
  - `ReaderInput`: `fullName` 1–200, `email?` "≤ 320 and email-shaped", `phone?` "≤ 20", `readerType` code, `status?` active/suspended/inactive;
  - `ReaderUpdateInput` (every field optional) and `LinkAccountInput { accountId: Id }`;
  - `IssueCardInput`: `cardNumber` 1–32, `expiresAt` an instant;
  - `SetCardStatusInput`: `status` expired/lost/revoked;
  - `CreatePolicyInput`: every numeric field a non-negative int, `loanDays ≥ 1`, `validFrom` an instant, and `readerType`/`materialType` codes;
  - `ClosePolicyInput { validTo }`;
  - `ReadersQuery` and `PoliciesQuery`;
  - the interfaces `Reader`, `Card` (with `validNow`) and `PolicyVersion`;
  - the endpoints from contracts/http-api.md "Readers, accounts links, cards, policies", plus `expireCards`.
  - Each endpoint entry has a JSDoc comment stating its access rule and error keys (FR-003).
- [X] T051 [P] [US4] Create `src/server/api/queries/people.ts` with:
  - `listReaders`, which searches `q` over `full_name`, `email` and `phone` with a `LIKE` prefix and filters by `status` and `readerType`;
  - `getReader`, `createReader` and `updateReader` (direct writes; the type code resolves to an id, else `NOT_FOUND`);
  - `linkAccount(pool, readerId, accountId)`:
    - the account must exist and be `active`, else `NOT_FOUND` or `VALIDATION`;
    - the reader must have `user_id IS NULL`, else `VALIDATION`;
    - `readers_user_uq` maps to `DUPLICATE` through `mapError`;
  - `unlinkAccount`, `listCards` and `listPolicies`;
  - `readerTypes()` and `materialTypes()`.
- [X] T052 [US4] Add the wrappers `issueCard` (`p_card_id`), `setCardStatus`, `createPolicyVersion` (`p_policy_id`; resolve the type codes to ids first), `closePolicyVersion` and `expireCards` (`p_count`) to `src/server/api/services/procedures.ts`.
- [X] T053 [US4] Create `src/server/api/routes/readers.ts` (readers, account link, reader cards, reference lists), `src/server/api/routes/cards.ts` (`POST /cards/:cardId/status`), `src/server/api/routes/policies.ts` and `src/server/api/routes/jobs.ts` (`POST /jobs/expire-cards`; `expire-holds` is added in US6). Register them in `app.ts` and in `endpoints`.

**Checkpoint**: new readers can be registered, linked and given cards. T049 passes.

---

## Phase 7: User Story 5 - Fines, payments and adjustments (Priority: P2)

**Goal**: fine lists, the balance, idempotent payments and adjustments.

**Independent Test**: spec US5.

### Tests for User Story 5

- [X] T054 [P] [US5] Write `tests/api/money.test.ts` (US5-1…5, SC-005):
  - fines of 30,000 and 20,000 plus a payment of 40,000 split 30,000 + 10,000 → balance 10,000;
  - the same `requestKey` sent 20 times sequentially and 5 in parallel → exactly 1 payment. The first response is 201; replays are 200 with `replayed: true`;
  - the same key with a different amount → 409 `IDEMPOTENCY_CONFLICT`;
  - allocations that do not add up → 409 `ALLOCATION_MISMATCH`;
  - an adjustment below the paid amount → 409 `FINE_RULE`;
  - `amountVnd: 1.5` → 400;
  - a fine of another reader in the allocations → 409 `ALLOCATION_MISMATCH`.

### Implementation for User Story 5

- [X] T055 [P] [US5] Create `src/lib/api/contract/money.ts` with:
  - `PaymentInput`:
    - `readerId`;
    - `amountVnd` "> 0";
    - `method` cash/bank_transfer;
    - `referenceNo?` "≤ 64";
    - `requestKey` a UUID;
    - `allocations` "1–50, distinct fines, each > 0";
  - `AdjustmentInput`: `amountVnd` "non-zero integer", `reason` 1–255;
  - `FinesQuery` (`open?`, paging);
  - the interfaces `Fine`, `Balance`, `Payment`, `PaymentResult { paymentId; replayed }` and `AdjustmentResult`;
  - the endpoints from contracts/http-api.md "Money".
  - Each endpoint entry has a JSDoc comment stating its access rule and error keys (FR-003).
- [X] T056 [P] [US5] Create `src/server/api/queries/money.ts`:
  - `listReaderFines(pool, readerId, { open, page, pageSize })` uses one grouped query (fines, joined through loan items and copies to books, with left-joined sums of adjustments and allocations) and computes `netVnd`, `allocatedVnd` and `remainingVnd`;
  - `readerBalance(pool, readerId, now)` is the Σ remaining;
  - `listReaderPayments` returns payments with their allocations.

  These are plain reads for display only.
- [X] T057 [US5] Add the wrappers to `src/server/api/services/procedures.ts`:
  - `recordPayment`, which passes `JSON.stringify(allocations.map(a => ({ fine_id: a.fineId, amount_vnd: a.amountVnd })))` with `outParams: ['p_payment_id', 'p_replayed']` and converts `p_replayed` to a boolean;
  - `adjustFine`, with `p_adjustment_id`.
- [X] T058 [US5] Create `src/server/api/routes/money.ts` with `GET /readers/:readerId/fines`, `GET /readers/:readerId/balance`, `GET /readers/:readerId/payments` (each self-or, as in http-api.md), `POST /payments` (201 when new, 200 when `replayed`; FR-017) and `POST /fines/:fineId/adjustments` (201). Register it in `app.ts` and in `endpoints`.

**Checkpoint**: money flows over HTTP, and T054 passes.

---

## Phase 8: User Story 6 - Reader self-service and reservations (Priority: P2)

**Goal**: readers see only their own records, and can reserve and cancel. Staff manage the hold
shelf and run hold expiry.

**Independent Test**: spec US6.

### Tests for User Story 6

- [X] T059 [P] [US6] Write `tests/api/isolation.test.ts` (FR-010, SC-006, US6-1, US6-2, US6-6):
  - reader A calling B's `loan-items`, `fines`, `balance`, `payments`, `reservations`, `cards` and `GET /readers/:id` → each returns 404 with the same body as a non-existent id (compare `key`, `category` and `message`);
  - A's own calls → 200;
  - an account with no linked reader asking for a reader id → 404;
  - `/me` shows `reader: null` for that account.
- [X] T060 [P] [US6] Write `tests/api/reservations.test.ts` (US6-3…5):
  - reserving a book that has an available copy → 400 `VALIDATION` (category `validation`, per contracts/errors.md);
  - a second reserve → 409 `DUPLICATE` `reservations_active_uq`;
  - the reader cancels their own `ready` hold → 200, and the next reader's reservation becomes `ready` (via `GET /readers/:id/reservations`);
  - cancelling another reader's reservation → 403 `FORBIDDEN`;
  - staff cancel without a reason → 400;
  - `GET /reservations?status=ready` for staff;
  - `POST /jobs/expire-holds` with the clock 4 days later → `count` ≥ 1.

### Implementation for User Story 6

- [X] T061 [P] [US6] Create `src/lib/api/contract/reservations.ts` with:
  - `ReserveInput { readerId: Id; bookId: Id }`;
  - `CancelInput { reason?: string ≤ 255 }`;
  - `ReservationsQuery` (`status?` of waiting/ready/fulfilled/cancelled/expired, `bookId?`, paging);
  - the interface `Reservation`, with the fields from data-model.md, including `queuePosition`;
  - the endpoints `reserve` (access `procedure`), `cancelReservation` (access `procedure`), `readerReservations` (self-or `reservation.manage`), `listReservations` (`reservation.manage`) and `expireHolds`.
  - Each endpoint entry has a JSDoc comment stating its access rule and error keys (FR-003).
- [X] T062 [P] [US6] Create `src/server/api/queries/reservations.ts` with:
  - `listReaderReservations` and `listReservations`, where `queuePosition` is computed as `ROW_NUMBER() OVER (PARTITION BY book_id ORDER BY requested_at, id)` among the `waiting` rows;
  - `getReservation`.
- [X] T063 [US6] Add the wrappers `reserve` (`p_reservation_id`), `cancelReservation` and `expireHolds` (`p_count`) to `src/server/api/services/procedures.ts`.
- [X] T064 [US6] Create `src/server/api/routes/reservations.ts` and add `POST /jobs/expire-holds` to `src/server/api/routes/jobs.ts`. Register them in `endpoints`. Check that `readerCards` from T053 and every `self-or` route use `readerParam: 'readerId'`.

**Checkpoint**: self-service and reservations work, and T059–T060 pass.

---

## Phase 9: User Story 7 - Reports, health and administration (Priority: P3)

**Goal**: debt and circulation reports, the invariant health check, and account and role
administration.

**Independent Test**: spec US7.

### Tests for User Story 7

- [X] T065 [P] [US7] Write `tests/api/reports.test.ts` (US7-1…3):
  - the roll-forward for `2026-10`, with fixtures matching spec 001 US4-14: every row satisfies `closing = opening + assessed + adjusted − collected`, and the response carries `from`/`to` from `localMonthBounds`;
  - the cumulative report satisfies `net_assessed = collected + outstanding`;
  - in copy-status, `available + on_loan + on_hold + in_repair + lost + retired = total`;
  - a librarian without `report.read` gets 403. Give the librarian a custom role without `report.read`, or use a reader account;
  - `GET /admin/health` → `violations: []`.
- [X] T066 [P] [US7] Write `tests/api/accounts.test.ts` (US7-4, US7-5):
  - removing `librarian` makes the next checkout 403;
  - `PUT` of an existing role → 204 (idempotent);
  - deactivating an account → its next call is 403 `ACCOUNT_INACTIVE`, and its processed loans still reference it;
  - an admin removing their own `admin` role or deactivating themself → 400 `VALIDATION`.

### Implementation for User Story 7

- [X] T067 [P] [US7] Create `src/lib/api/contract/reports.ts` with:
  - `CumulativeQuery` (`asOf?` an instant, `readerId?`);
  - `RollforwardQuery` (`month` LocalMonth, required; `readerId?`);
  - `LoansByMonthQuery` (`fromMonth?`, `toMonth?`) and `PopularQuery` (`limit` 1–100, default 10);
  - interfaces with camelCase columns from spec 001 reports-and-invariants.md: `CumulativeRow`, `RollforwardRow`, `OverdueRow`, `LoansByMonthRow` (`monthLocal`, `readerType`, `loans`, `items`), `PopularBookRow` (`bookId`, `title`, `loanItems`), `CopyStatusRow` and `Health { views: string[]; violations: { view: string; rows: Record<string, unknown>[] }[] }`;
  - the endpoints from contracts/http-api.md "Reports and health".
  - Each endpoint entry has a JSDoc comment stating its access rule and error keys (FR-003).
- [X] T068 [P] [US7] Create `src/lib/api/contract/accounts.ts` with:
  - `AccountsQuery` (`status?`, `role?`) and `SetAccountStatusInput` (`status` active/inactive);
  - the interface `Account` (`id`, `status`, `createdAt`, `roles`, `readerId`, `subject`);
  - the endpoints from contracts/http-api.md "Administration".
  - Each endpoint entry has a JSDoc comment stating its access rule and error keys (FR-003).
- [X] T069 [US7] Add `reportCumulative` and `reportRollforward` to `src/server/api/services/procedures.ts`, mapping the result set columns to camelCase. Create `src/server/api/queries/reports.ts` for the four `v_report_*` views, and a health function that uses `findViolations` from `src/lib/db/invariants.ts`.
- [X] T070 [US7] Create `src/server/api/queries/accounts.ts` with `listAccounts`, `getAccount`, `assignRole` (`INSERT IGNORE`, 204), `removeRole`, and `setStatus`. The last three have the self-lockout guard. `setStatus` is the FR-011a deactivation path, and `listAccounts` includes `subject`, so an admin can find a user who was deleted in Supabase.
- [X] T071 [US7] Create `src/server/api/routes/reports.ts` (including `GET /admin/health`) and `src/server/api/routes/accounts.ts`, and register them. Remove the `todo` marker from the procedure-coverage check in `tests/api/coverage.test.ts`: every public `sp_*` must now have an endpoint.

**Checkpoint**: all stories are complete. `pnpm test:api` is fully green, including coverage.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T072 [P] Update `ARCHITECTURE.md`:
  - the §1 overview: "Next.js app (planned)" becomes the built API, with a Hono box and Supabase JWKS;
  - every "Next.js API (planned)" participant in the flow diagrams becomes "API (Hono)";
  - add a new section "API layer" with:
    - the request pipeline (request id → auth → access → validate → handler → mapError);
    - a Mermaid sequence of the first-request provisioning;
    - a Mermaid sequence of the sign-up hook;
    - a table of the error category mapping, linking to specs/002-library-api/contracts/errors.md.
- [X] T073 [P] Update `README.md` with an API section:
  - the `NEXT_PUBLIC_SUPABASE_URL` and `AUTH_HOOK_SECRET` setup;
  - `pnpm dev` and `pnpm test:api`;
  - where the contract lives (`src/lib/api/contract`) and how the UI calls `apiFetch`.
- [X] T074 [P] Performance check (SC-007). Add `tests/api/perf.test.ts`:
  - build the fixture volume in `beforeAll`: 50 books (each with 2 authors and 1 category), 100 copies, 30 readers with cards, and one policy per reader type;
  - run 50 catalog searches, 20 checkouts of up to 5 copies with returns, and 20 payments through `app.request`;
  - assert p95 < 1000 ms per operation kind. This measures in-process, excluding Next.js and network overhead; note that in the test.

  Follow the pattern of `tests/concurrency/perf.test.ts`.
- [X] T075 Write `tests/api/error-matrix.test.ts` (SC-002):
  - for every key in `ERROR_KEYS`, a table row holds the request that produces it over HTTP, with its expected status and category;
  - reuse the fixtures and cover at least: `NO_POLICY` (reader type without a policy), `READER_NOT_ACTIVE` (suspended reader), `POLICY_CLOSE_REJECTED` (a `validTo` before `now`), `PAYMENT_EXCEEDS_DEBT`, `NOT_FOUND` from a procedure (unknown `loanItemId`), `AUTH_UNAVAILABLE` (a verifier that throws a JWKS fetch error), `ROUTE_NOT_FOUND` and `BUSY`;
  - some keys cannot be produced through any route: `POLICY_IMMUTABLE`, `SNAPSHOT_IMMUTABLE`, `APPEND_ONLY`, `COPY_STATE` and `INTERNAL`. List each of them with a one-line reason, and assert that `mapError` maps it;
  - fail when a key is neither produced nor listed.
- [X] T076 Run the full gate: `pnpm lint`, `pnpm typecheck`, `pnpm db:reset-test`, `pnpm test:db`, `pnpm test:concurrency`, `pnpm test:api`. Then run through the manual steps of `specs/002-library-api/quickstart.md` 1–6 against `pnpm dev` with the seeded database. For SC-009, a team member who has not read `src/server/` does a checkout, a return and a payment using only `src/lib/api/contract` and `contracts/http-api.md` (with `apiFetch` or `curl`); record the result in the PR.
- [X] T077 Mark the tasks done in this file, and add a spec 002 entry to the report evidence list (Ch.4: verified identity, RBAC in server and DB, API over procedures) in `docs/report/`, if that folder lists evidence per spec.

---

## Phase 11: Supabase auth redirects (added 2026-09-25, FR-008d)

**Goal**: the API receives the two redirects Supabase sends the browser to (the OAuth callback
and email-link confirmation), verifies them and stores the session. There are no sign-in or
sign-out endpoints.

- [X] T078 Install `@supabase/ssr@0.12.7` and `@supabase/supabase-js@2.116.0`. Add `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `.env.example`, spec 001 FR-030, spec 002 FR-026 and research R6.
- [X] T079 [P] Add `src/lib/api/contract/auth.ts` with:
  - the endpoints `authCallback` and `authConfirm`;
  - the schemas `AuthCallbackQuery`, `AuthConfirmQuery` and `NextPath` (same-site path only);
  - `EMAIL_OTP_TYPES`, `AUTH_ERROR_PATH` and the reason codes.
- [X] T080 [P] Add `src/integrations/supabase/server-client.ts`:
  - `honoCookies(c)`: `getAll` uses `parseCookieHeader`; `setAll` appends `Set-Cookie` and applies the no-cache headers;
  - `createSupabaseAuthFactory(url, key)`;
  - `ApiDeps.supabaseAuth`, wired in `deps.ts`.
- [X] T081 Add `src/server/api/routes/auth-redirects.ts` with the callback (`exchangeCodeForSession`, and Supabase's `?error=`) and the confirm (`verifyOtp`). Both use `safeNext` and `publicOrigin` (`x-forwarded-host` in production). After success they call `ensureAccount` for a Google user; any other session is `signOut({ scope: 'local' })` and redirected with `reason=provider_not_allowed`.
- [X] T082 Write `tests/api/auth-redirects.test.ts` with a stubbed Supabase client:
  - cookies are read (the PKCE verifier) and written, with the no-cache headers;
  - a Google user's account is created;
  - `next` is never off-site;
  - the reasons `provider_error`, `missing_code`, `exchange_failed`, `not_configured`, `invalid_link`, `verify_failed` and `provider_not_allowed`.

---

## Phase 12: Environment validation (added 2026-09-25, research R14)

- [X] T083 Rename the Supabase variables to `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.example`, the specs, README and the memory note.
- [X] T084 Install `@t3-oss/env-nextjs@0.13.11`. Add `src/env.ts` (`createEnv` with the server and client zod schemas, `experimental__runtimeEnv`, `emptyStringAsUndefined`) and import it from `next.config.ts`.
- [X] T085 `server/api/deps.ts` reads `env` instead of `process.env`. The hand-written "`SUPABASE_URL` is not set" fallback is removed, because validation now fails at startup.
- [X] T086 Write `tests/api/env.test.ts`: valid values pass, a bad URL or key and a malformed hook secret are rejected, and a blank optional value counts as unset.

---

## Phase 13: Dev sign-in page for real Supabase testing (added 2026-09-25)

- [X] T087 Add `src/lib/supabase/browser.ts` (`createBrowserClient` with the `NEXT_PUBLIC_*` values from `src/env.ts`).
- [X] T088 Add the dev-only page `src/app/dev/auth/page.tsx` (`notFound()` in production) with the client panel `dev-auth-panel.tsx`. The panel offers Google sign-in through `signInWithOAuth`, with `redirectTo` set to `/api/v1/auth/callback?next=/dev/auth`. It shows the session and the access token (with a copy button), calls `GET /api/v1/me` through `apiFetch`, and signs out on the client.
- [X] T089 Add `src/app/auth/error/page.tsx`, the landing page of failed redirects, with one message per `AuthErrorReason`.
- [X] T093 Add `src/app/dev/auth/api-explorer.tsx`, a dev-only explorer of every contract endpoint the caller may use:
  - visibility follows `access`: `perm`, `self-or` (own reader), and `procedure` through a permission hint map;
  - endpoints are grouped by area;
  - each endpoint has a generated form: `:params` prefilled with the caller's reader and account ids, a query string, and a JSON body template;
  - the response is shown with its status and time.

---

## Phase 14: Reader profile at sign-in, linked by id (added 2026-09-25, FR-008e)

- [X] T090 `services/accounts.ts`: `ensureAccount(pool, subject, dbNow, profile, opts)` calls `ensureReaderProfile`, which runs `INSERT IGNORE` of an EXTERNAL `active` reader with `user_id = app_users.id`. The insert is a no-op when a reader exists (`readers_user_uq`). It runs for new and existing accounts on the callback and hook paths. There is no email matching.
- [X] T091 Pass the Google name and email (prefill only) from all three paths: the callback session, the hook payload, and the token claims (`VerifiedToken.email` and `fullName`).
- [X] T092 Tests: a new account gets an EXTERNAL reader; a desk reader with the same email is never linked; 20 parallel requests give one reader; a known account's ordinary requests do not write; a sign-in backfills an existing account's reader, and only once.
---

## Phase 15: Email/password sign-in and seeded test accounts (added 2026-09-25)

- [X] T094 `src/integrations/supabase/providers.ts`: `DEFAULT_ALLOWED_PROVIDERS = ['google', 'email']`, `providersOf` and `usesAllowedProvider`, used by the verifier, the hook and the callback in place of the hard-coded `'google'`. The redirect reason `google_only` is renamed `provider_not_allowed`.
- [X] T095 `/dev/auth`: add an email/password form (`signInWithPassword`) with the seeded test emails suggested.
- [X] T096 `data/seed/people.json`: the placeholder accounts `admin`, `librarian1`, `acc-S01`, `acc-L01` and `acc-E01` now carry the real Supabase user ids of `account+admin|librarian|student|lecturer|external@gmail.com`. Readers S01, L01 and E01 carry those emails.
- [X] T097 Tests: email users are accepted (verifier, hook, callback), and GitHub is refused.
- [X] T098 Reduce the seed to the real test users:
  - `people.json` keeps 5 accounts keyed by role (admin, librarian, student, lecturer, external, each with its Supabase `email` for reference) and 3 readers (S01, L01, E01);
  - `seed.ts` scenarios are rewritten around those readers, and all actor steps use the librarian;
  - the expired-card and ineligible-queue-head cases are dropped, and the deviation is recorded in plan.md Complexity Tracking and docs/report/acceptance.md §6.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T007 must finish before T016 and T045 (they use `withRetry`).
- **Foundational (Phase 2)**: depends on Setup and blocks every story.
  - Order inside it: T009–T012 (contract) → T013–T014 → T015–T016 → T017–T020 → T021–T023; T024 and T025 last.
- **US1 (Phase 3)**: depends on Foundational. It is the MVP.
- **US2–US7 (Phases 4–9)**: each depends only on Foundational. Their tests seed data with fixtures, not through other stories' routes, so the stories can run in any order or in parallel. Suggested order: priority, then phase number.
- **Polish (Phase 10)**: after every story.

### Shared files (serialize edits)

- `src/server/api/services/procedures.ts` (T038, T046, T052, T057, T063, T069),
  `src/lib/api/contract/index.ts` and `src/server/api/app.ts` (the registration steps). Each
  story appends to them. When stories run in parallel, merge these edits one at a time.

### Within each story

- Tests first (they fail) → contract file → queries and procedure wrappers → route module and registration → tests pass.

## Parallel Examples

```text
# Phase 1, after T001–T002:
T003, T004, T005, T006, T008 in parallel; T007 alone (it touches call-procedure.ts)

# US1 tests together:
T026, T027, T028, T029, T030

# US2 after the tests:
T037 (contract), T038 (procedures.ts), T039 (queries/loans.ts) in parallel → T040

# US3:
T043, T044, T045 in parallel → T046 → T047 → T048

# Across stories (after Phase 2), with several developers:
Dev A: US2 · Dev B: US3 · Dev C: US4 + US5 · Dev D: US6 + US7
```

## Implementation Strategy

### MVP first

1. Phase 1 → Phase 2 → Phase 3 (US1).
2. **Stop and validate:**
   - `pnpm test:api` covers identity, provisioning, the hook, errors and coverage (the procedure check is still `todo`);
   - `GET /me` works with a real Supabase Google token.
3. Demo: sign in with Google, the account is created with the `reader` role, and `/me` answers.

### Incremental delivery

- US2 (desk circulation) + US3 (catalog) make the first useful release for librarians.
- US4 + US5 complete the desk (new readers, money).
- US6 opens self-service to readers. US7 adds reports and administration, and completes the operation coverage.
- Each story is independently testable and leaves `pnpm test:api` green.

## Implementation notes (2026-09-25)

- **Per-area procedure wrappers.** They live in `src/server/api/services/procedures/<area>.ts`
  and call the shared `callAsCaller` (`services/call.ts`), instead of one `procedures.ts`. This
  lets the stories be built in parallel without editing a shared file.
- **Job routes.** `POST /jobs/expire-cards` is in `routes/cards.ts` and
  `POST /jobs/expire-holds` is in `routes/reservations.ts`. There is no `routes/jobs.ts`; the
  paths are unchanged.
- **Input limits follow the database columns and CHECKs where data-model.md was wider.**
  data-model.md is updated:
  - `publishedYear` 1000–2100;
  - `languageCode` ≤ 8;
  - category `name` ≤ 150;
  - `barcode` ≤ 32;
  - cancel `reason` ≤ 64;
  - `maxActiveItems` ≥ 1.
- **`route()` parses inputs itself.** `@hono/zod-validator` was dropped. The time helpers use
  `date-fns`, `@date-fns/utc` and `@date-fns/tz`.
- **Renamed contract exports.** `InvariantHealth` (instead of `Health`, which `/health` already
  uses) and `CancelReservationInput`.
- **`mapError` handles errno 1062 from direct writes.** It maps them to `DUPLICATE <index>`.
- **Imports use the `@/` alias, which points at `src/`** (tsconfig `paths`, and `resolve.alias`
  in vitest). `tests/helpers` sits outside `src`, so it stays relative.
- **Null/undefined handling goes through `src/lib/utils.ts`**, on top of `lodash-es`:
  - `isNil` and `isUndefined`;
  - `mapNullable`;
  - `toNumberOrNull`;
  - `omitNil`;
  - `omitUndefined`.

## Notes

- After T003, update the auto-memory "minimal env vars" with the two new variable names.
- Commit after each phase checkpoint on branch `001-library-db-design`.
- Never add a route that writes a procedure-only table directly. The app DB account would
  reject it (errno 1142 → `INTERNAL`), and the constitution forbids it.
