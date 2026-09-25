# Acceptance: Library API (spec 002)

Run on 2026-09-25 on branch `001-library-db-design`, against the local Docker MySQL 8.4.
Report chapter: **Ch.4**. Evidence: verified identity, RBAC enforced by both the server and the
database, and the API reaching the operation procedures only.

## Gate (tasks T076)

| Command | Result |
| --- | --- |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test:db` | 16 files, 98 tests passed (spec 001 unchanged after the `callProcedure` refactor) |
| `pnpm test:concurrency` | 9 files, 15 tests passed |
| `pnpm test:api` | 22 files, 152 tests passed (rerun 2026-09-25 after the auth redirects, env validation, email sign-in and seed changes) |

## Success criteria

| SC | Evidence |
| --- | --- |
| SC-001 every public procedure reachable and declared | `tests/api/coverage.test.ts`: every `endpoints` entry is mounted, every public `sp_*` has an endpoint, every migration error key is in `ERROR_KEYS` |
| SC-002 error keys produced over HTTP | `tests/api/error-matrix.test.ts`: 24 keys are produced by real requests. 5 keys no route can reach (trigger guards, `COPY_STATE`, `INTERNAL`) are listed with a reason and checked through `mapError` |
| SC-003 no data access without a verified identity | `tests/api/identity.test.ts`: 9 bad-token variants, a provider other than Google or email, a spoofed actor, an inactive account and a forged role. `tests/api/signup-hook.test.ts`: bad, tampered and stale signatures |
| SC-004 one winner among 20 concurrent checkouts | `tests/api/concurrency.test.ts`: 1 × 201 and 19 × 409 `COPY_NOT_AVAILABLE`, with the invariants clean |
| SC-005 idempotent payments | `tests/api/money.test.ts`: the same request key 20 times sequentially and 5 in parallel gives 1 payment |
| SC-006 reader isolation | `tests/api/isolation.test.ts`: 7 reader-scoped routes return 404 bodies identical to a missing id |
| SC-007 p95 < 1 s | `tests/api/perf.test.ts`, measured in-process: catalog search, checkout (1–5 copies), return and payment |
| SC-008 FR-025 scenarios over HTTP | `tests/api/circulation.test.ts`, `money.test.ts`, `reservations.test.ts` |
| SC-009 usable from the contract alone | Pending: a team member runs the quickstart with a real Supabase token |
| SC-010 one account per new Google user | `tests/api/provisioning.test.ts` (20 parallel first requests) and `signup-hook.test.ts` (hook plus first request at the same time) |

## Manual smoke test (`pnpm dev`, seeded database)

- `GET /api/v1/health` returns 200 `{"status":"ok"}`, with `X-Request-Id` and `X-Content-Type-Options: nosniff`.
- `GET /api/v1/catalog/books?q=data` (no token) returns seeded books with `copies.available/total`, and no barcodes.
- `GET /api/v1/me` without a token returns 401 `UNAUTHENTICATED`. With a token while the JWKS
  cannot be fetched, it returns 503 `AUTH_UNAVAILABLE` with `Retry-After: 5`.
  - This was first observed before env validation existed, with `SUPABASE_URL` unset.
  - Since `src/env.ts`, the app does not start without the Supabase variables.
  - The fetch failure is covered by `tests/api/error-matrix.test.ts`.
- An unknown route returns 404 `ROUTE_NOT_FOUND`.

The quickstart steps that need a real Supabase project (Google sign-in token, the hook over a
tunnel) were not run here: `.env.local` has no `NEXT_PUBLIC_SUPABASE_URL` yet.

## Defect found by the smoke test

`src/lib/db/index.ts` built its Drizzle instance with `drizzle({ client: pool })`. In
drizzle-orm 1.0.0-rc.4 that throws at import time for a mysql2 promise pool. The module had
never been imported before spec 002: the scripts and tests use `dbConfig` directly. It now
passes the underlying callback pool (`pool.pool`). `tests/api/db-module.test.ts` guards the
import and the production app factory.
