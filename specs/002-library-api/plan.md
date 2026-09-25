# Implementation Plan: Library API Contract and Server Routes

**Branch**: `001-library-db-design` (work stays here; the team switches to a 002 branch once,
after spec 002 is implemented) | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-library-api/spec.md`

## Summary

Expose the spec 001 database through one versioned HTTP API, `/api/v1`, built with Hono and
mounted in the Next.js 16 App Router through a single catch-all Route Handler.

- **Contract:** a shared module, `src/lib/api/contract/`, holds zod input schemas, TypeScript
  response interfaces, error key types and an `endpoints` table. The server validates and
  types its handlers with it, so drift fails `pnpm typecheck`. The UI imports it directly.
  There is no OpenAPI document in the MVP (team decision, research R2).
- **Identity:** a Supabase access token (Google sign-in) is verified locally with `jose` against
  the project's JWKS. The acting account always comes from the token's `sub`. An idempotent
  "ensure account" step creates `app_users` with the `reader` role. The Supabase Before User
  Created HTTP hook runs it at sign-up, and the first verified request runs it too.
- **State changes:** every change calls the existing stored procedures through
  `callProcedure`, with the server's clock as `p_now`.
- **Reads and direct writes:** reads and the catalog, people and account writes use the
  restricted app account.
- **Errors:** database error keys map to one error shape and a fixed set of HTTP categories.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js (Next.js 16.3.6 `nodejs` runtime)

**Primary Dependencies**:
- Existing: `next` 16.3.6, `drizzle-orm` 1.0.0-rc.4, `mysql2` 3.
- New, pinned (research R1, R2, R4, R5, R8): `hono` 4.13.8, `zod` 4.6.5, `date-fns` 4.4.0 with
  `@date-fns/tz` 1.5.0 and `@date-fns/utc` 2.1.1 (time helpers in `src/lib/time`),
  `lodash-es` 4.18.1 (null/undefined helpers in `src/lib/utils.ts`),, `jose` 6.2.12, `standardwebhooks` 1.1.1.

**Storage**: MySQL 8.4 (Docker), spec 001 schema. No schema change in this feature.

**Testing**: Vitest.
- New suite `tests/api` (`pnpm test:api`) drives `app.request()` against `${DB_NAME}_test`,
  using locally signed tokens and an injected clock.
- The existing `tests/db` and `tests/concurrency` suites must still pass.

**Target Platform**: Node.js server (local `next dev` / `next start`). No edge runtime.

**Project Type**: web service inside an existing Next.js web app (single project, `src/`).

**Performance Goals**: 95% of catalog searches and desk operations under 1 s at seed volume
(SC-007). 20 concurrent checkouts of one copy are handled correctly (SC-004).

**Constraints**:
- No direct writes to procedure-only tables.
- No client-supplied actor or time.
- 2 new environment variables at most (research R6).
- Hook answers within 5 s.
- Request bodies ≤ 64 KB.

**Scale/Scope**:
- About 60 operations in 15 route modules (contracts/http-api.md).
- Seed volume: 30–50 books, tens of readers.
- Course demo load: a handful of concurrent users.

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1 design.*

| Principle | Check | Status |
| --- | --- | --- |
| I. MySQL is the single source of truth | The API keeps no business state. Supabase holds identity only, and roles and permissions come from MySQL. Google Books is out of scope (spec 003) | PASS |
| II. Schema-first | No table, trigger or routine is added. Any index added for a search `EXPLAIN` goes through a Drizzle migration | PASS |
| III. Transactional circulation integrity | Every circulation, card, policy, reservation and money change calls its `sp_*` through `callProcedure`, with a fresh connection and no open transaction. Only 1213/1205 are retried, 3 attempts at most. `p_now` comes from the server clock (R8) | PASS |
| IV. Immutable history and derived money | The API exposes no update or delete for money or loan history. Balances are derived reads. Payments carry a request key (FR-017) | PASS |
| V. Server-verified identity and RBAC | JWT verified with signature, `iss`, `aud` and `exp` (R4). The actor comes from `sub` only. Permissions come from MySQL. Privileged reads are checked in the server. `reader_type` is never used as a role. Inactive accounts are refused | PASS |
| VI. Curated external metadata | Not touched (import deferred to spec 003). Provider keys stay server-side | PASS |
| VII. Academic traceability | The spec states Ch.4 evidence. Scope is bounded (A1–A3 recorded). The search `EXPLAIN` is added to `db:explain` | PASS |
| Tech constraints: env vars | Adds `NEXT_PUBLIC_SUPABASE_URL` (required) and `AUTH_HOOK_SECRET` (optional), both unprefixed and non-derivable. Spec 001 FR-030 and `.env.example` are updated in the same change (R6) | PASS (justified in R6) |
| Tech constraints: Next.js docs | The Route Handler, catch-all and runtime docs were read in `node_modules/next/dist/docs` (R1) | PASS |
| Quality gates | `pnpm lint`, `pnpm typecheck`, `pnpm test:db`, `pnpm test:concurrency` and the new `pnpm test:api` must pass. Invariants are checked after each test | PASS |

**Post-design re-check (after Phase 1)**: still PASS.
- data-model.md adds no stored entity.
- The contracts route every procedure-only change through a procedure.
- The hook writes only `app_users` and `user_roles`, which the app account may write
  (FR-026 of spec 001).
- No complexity violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-library-api/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R12
├── data-model.md        # API resources → tables and routines
├── quickstart.md
├── contracts/
│   ├── http-api.md      # endpoint catalogue
│   ├── errors.md        # error body, categories, key mapping
│   └── signup-hook.md   # Supabase Before User Created hook
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── app/api/[[...route]]/route.ts   # handle(app) for GET/POST/PUT/PATCH/DELETE; runtime nodejs
├── server/api/
│   ├── app.ts                      # createApp(deps): Hono basePath('/api/v1'), mounts route modules
│   ├── define-route.ts             # route(app, endpoint, handler): method/path/validator from the endpoint, typed Out
│   ├── deps.ts                     # production deps: pool, clock, verifyToken (remote JWKS), hookSecret
│   ├── context.ts                  # typed Hono Variables: requestId, now, caller
│   ├── middleware/
│   │   ├── request-id.ts
│   │   ├── auth.ts                 # bearer → verifyToken → resolveCaller (ensureAccount only if unknown); optional/required modes
│   │   └── access.ts               # requirePermission(any of…), requireSelfOr(perm…)
│   ├── errors/
│   │   ├── api-error.ts            # ApiError(key, category, detail, fields)
│   │   └── map-error.ts            # DbRuleError / errno / zod → ApiError (contracts/errors.md)
│   ├── routes/                     # one module per area; handlers registered with route(...)
│   │   ├── meta.ts  me.ts  public-catalog.ts  catalog.ts  copies.ts
│   │   ├── readers.ts  cards.ts  policies.ts  loans.ts  money.ts
│   │   ├── reservations.ts  jobs.ts  reports.ts  accounts.ts  signup-hook.ts
│   ├── queries/                    # read models (Drizzle / SQL): catalog-search, readers, loans, fines, reservations, accounts
│   └── services/
│       ├── procedures.ts           # typed wrappers: checkout(), returnItem(), … over callProcedure
│       └── accounts.ts             # resolveCaller() (read-only), ensureAccount() (first sight, hook)
├── integrations/supabase/
│   ├── verify-token.ts             # jose JWKS verifier from NEXT_PUBLIC_SUPABASE_URL (R4)
│   └── signup-hook.ts              # standardwebhooks verification + payload schema (R5)
└── lib/
    ├── api/                        # shared with the UI: no server imports
    │   ├── contract/               # common.ts (Id, Instant, Money, Page), errors.ts (ErrorKey, ApiErrorBody, ERROR_CATEGORY, ERROR_MESSAGES), catalog.ts, people.ts,
    │   │                           # circulation.ts, money.ts, reservations.ts, reports.ts, accounts.ts, me.ts, endpoints.ts, index.ts
    │   └── client.ts               # apiFetch(endpoint, {params, query, body}, {token}) → Out, throws ApiError
    ├── db/ (existing) + with-retry.ts (extracted from callProcedure) + invariants.ts (findViolations moved)
    └── time/ db-time.ts (toDbTime/fromDbTime ISO), local-month.ts (localMonthBounds moved)

tests/api/
├── helpers/ app.ts (createTestApp, fixed clock) tokens.ts (local ES256 keys, signToken) hook.ts
├── coverage.test.ts  identity.test.ts  provisioning.test.ts  signup-hook.test.ts  errors.test.ts
├── public-catalog.test.ts  catalog.test.ts  people.test.ts  circulation.test.ts  concurrency.test.ts
├── money.test.ts  reservations.test.ts  reports.test.ts  accounts.test.ts  isolation.test.ts
```

**Structure Decision**: single project. The API lives in `src/server/api`, and Next is only a
thin mount in `src/app/api/[[...route]]/route.ts`. The contract lives in `src/lib/api`, where
the UI can import it: it has no server imports, and an ESLint `no-restricted-imports` rule
enforces that.
- `createApp(deps)` has no import-time side effects, so tests build the app against the test
  schema.
- Supabase-specific code sits in `src/integrations/supabase` (the folder exists already).
- Helpers shared with the spec 001 scripts move to `src/lib` (research R9), and the scripts
  import them from there.

## Implementation phases (input for /speckit-tasks)

1. **Setup**:
   - Add the pinned deps.
   - Add the `test:api` script.
   - Add the env vars to `.env.example` and spec 001 FR-030.
   - Move `localMonthBounds` and `findViolations`, and extract `withRetry`.
2. **Foundation (US1)**:
   - `createApp`, request id, error mapping, auth middleware, `resolveCaller`, `ensureAccount`.
   - The contract module skeleton (`common.ts`, `endpoints.ts`, `define-route.ts`, `client.ts`).
   - `GET /me`, `/health`.
   - The coverage test.
   - Identity and provisioning tests.
3. **US2 circulation**: loans, loan items, desk scans (`/cards/by-number`,
   `/copies/by-barcode`), circulation, error and concurrency tests.
4. **US3 catalog**: public catalog search and detail (with `EXPLAIN`), catalog management, copies.
5. **US4 people**: readers, account link, cards, policies, expire-cards job.
6. **US5 money**: fines, balance, payments (idempotent), adjustments.
7. **US6 self-service and reservations**: self-or-staff access, reservations, expire-holds
   job, isolation tests.
8. **US7 reports and admin**: debt and circulation reports, health, accounts and roles.
9. **Signup hook**: delivered inside US1 (tasks T028, T032, T033). The manual quickstart step comes at the end.
10. **Polish**:
    - Update ARCHITECTURE.md: the "Next.js API (planned)" participants become the built API,
      and an API section with auth and hook sequence diagrams is added.
    - Update README usage; regenerate the contract; run the full gate.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Constitution "Sample data" and spec 001 FR-025: the seed no longer covers an expired card or a queue head becoming ineligible, and has little everyday circulation volume (2026-09-25) | The team keeps only readers linked to real Supabase test users (`account+student|lecturer|external`), so every seeded record can be seen live through the API | Keeping extra readers without accounts adds data that cannot be signed into. The dropped cases stay covered by `tests/db`, `tests/concurrency` and `tests/api` (docs/report/acceptance.md §6) |

The new environment variables are justified in research R6.
