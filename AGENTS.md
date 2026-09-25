<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# NexusLib: agent guide

A university library system for the UIT database course (CSDL): catalog, readers and cards,
loans and renewals, reservations and holds, fines and payments. **The database is the product.**
Business rules live in MySQL (constraints, triggers, stored procedures). The TypeScript code
calls them and never re-implements them.

- Spec 001: MySQL 8.4 schema, routines, ERD, seed data and tests.
- Spec 002: the `/api/v1` HTTP API (Hono inside Next.js, Supabase Google sign-in).
- Not built yet: the web UI and the Google Books import (spec 003).

Read these before larger changes:

| File | What it holds |
| --- | --- |
| `.specify/memory/constitution.md` | Binding rules. If a spec, plan or this file disagrees, the constitution wins. |
| `ARCHITECTURE.md` | Code layout, migration order, ERDs, lifecycles, flows, API pipeline |
| `README.md` | Setup, env variables, every `pnpm` script |
| `specs/00x-*/` | spec, plan, research, data model, contracts and tasks for each feature |
| `specs/001-library-db-design/contracts/db-routines.md` | Procedure signatures and calling rules |
| `specs/002-library-api/contracts/http-api.md`, `errors.md` | Endpoint list and error keys |

## Stack

Next.js 16 (App Router, `src/`), React 19, TypeScript, **pnpm**. MySQL 8.4 in Docker, `mysql2`,
Drizzle ORM / drizzle-kit `1.0.0-rc.4` (patched: `patches/`). Hono 4, zod 4, `@t3-oss/env-nextjs`,
Supabase Auth with `jose` JWKS verification, date-fns with `@date-fns/utc`, lodash-es, Vitest,
Tailwind 4. Import alias: `@/` = `src/`.

## Commands

```sh
pnpm db:up && pnpm db:migrate && pnpm db:seed   # local DB (needs .env.local)
pnpm lint && pnpm typecheck                      # always run before you finish
pnpm test:db | test:concurrency | test:api       # needs the MySQL container running
pnpm dev                                         # API at http://localhost:3000/api/v1
```

Tests use the derived schema `${DB_NAME}_test` and reset it themselves. Files run one at a time
(one shared schema). Run a single file with `pnpm exec vitest run tests/api/circulation.test.ts`.

## Layout

```text
src/lib/db/            config (env → owner/app connection), pool, callProcedure, grants list
src/lib/db/schema/     Drizzle table definitions (27 tables); tables.ts re-exports them
drizzle/               migrations: generated DDL + custom SQL (triggers, functions, procedures, views)
src/lib/api/contract/  zod inputs, response types, error keys, `endpoints` (shared with the UI)
src/lib/api/client.ts  apiFetch + ApiClientError for UI code
src/server/api/        Hono app: app.ts, define-route.ts, middleware/, routes/, queries/, services/, errors/
src/integrations/      Supabase token verifier, server client, sign-up hook
src/lib/time/          DB time ⇄ ISO conversion, library time zone (Asia/Ho_Chi_Minh)
scripts/db, erd, seed  tooling behind the pnpm scripts
tests/db, concurrency, api   Vitest suites; shared helpers in tests/helpers
```

## Hard rules (from the constitution)

1. **MySQL is the single source of truth.** Supabase only identifies the user. Google Books data
   never counts as inventory.
2. **State changes to circulation, card, policy and money go through stored procedures** (`sp_*`).
   The app account (`DB_USER`) has no INSERT/UPDATE/DELETE on `PROCEDURE_ONLY_TABLES`
   (`src/lib/db/grants.ts`). Do not add a direct write to those tables, and do not widen grants
   to make one work. Direct writes are allowed only on `APP_WRITABLE_TABLES` (catalog, readers,
   accounts), inside `transaction()` from `src/server/api/queries/sql.ts`.
3. **Put invariants in the database** where MySQL can express them: CHECK, UNIQUE,
   generated-column unique keys, triggers. A rule that needs locking belongs in a procedure that
   uses `SELECT … FOR UPDATE`. Every new rule needs a test, and a concurrency test if it can race.
4. **Retry only deadlocks (1213) and lock wait timeouts (1205).** Business rejections are never
   retried. `callProcedure` and `withRetry` already do this, so do not add your own retry loops.
5. **No hard-coded names or secrets.** Schema, account, host, port and passwords come from env.
   Keep the env set minimal and unprefixed. Derive values like the test schema name; do not add
   a variable for them. A new variable must be declared in `src/env.ts`, documented in
   `.env.example` and README, and justified in the spec.
6. **All DB access is server-side.** Client code never gets credentials or server-only keys.

## Changing the schema

1. Tables: edit `src/lib/db/schema/*.ts`, then `pnpm exec drizzle-kit generate --name=<change>`.
2. Triggers, functions, procedures, views: `pnpm exec drizzle-kit generate --custom --name=<change>`
   and write the SQL there. To change a routine, add a new migration that drops and re-creates it.
   Never edit a migration that is already on `main`.
3. Migrations never name an account or a schema. Grants live in `src/lib/db/grants.ts` and
   `scripts/db/grants.ts`.
4. Procedures reject with `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'KEY: detail'`. `KEY` must be
   one of `DB_ERROR_KEYS` (`src/lib/api/contract/errors.ts`). A new key needs a matching entry
   there and in `specs/002-library-api/contracts/errors.md`.
5. Then run `pnpm db:migrate`, `pnpm erd:relational`, `pnpm db:dictionary` and `pnpm test:db`.
   The ERD-sync test fails if `docs/erd/relational.mmd` or the ERD in `ARCHITECTURE.md` is stale.
   Update the conceptual ERD (`docs/erd/`) and its mapping when entities or relationships change.

## Adding or changing an API endpoint

1. Declare it in `src/lib/api/contract/<area>.ts` and add it to `endpoints`. Give it a method,
   a path relative to `/api/v1`, zod `params`/`query`/`body`, `access`, `procedure` if any,
   its specific `errors`, and a JSDoc comment stating the access rule.
2. The contract may import only zod and other contract files. ESLint rejects server, DB, Hono
   or jose imports under `src/lib/api/`.
3. Register it in `src/server/api/routes/<area>.ts` with
   `route(app, deps, endpoints.x, handler)`. `route()` runs authenticate → params → access →
   query → body → handler. Do not parse input or check auth by hand. A new route module goes
   into `routeModules` (`routes/index.ts`).
4. For procedure calls, add a typed wrapper in `services/procedures/<area>.ts` built on
   `callAsCaller`. It passes the caller's account id and `c.var.dbNow` as `p_actor_user_id` and
   `p_now`. For reads, add a function in `queries/<area>.ts` built on `rows` / `one` / `paged`.
5. Throw `ApiError` / `notFound(...)`. `mapError` builds every error response. Clients branch on
   `key`, never on `message`.
6. Update `contracts/http-api.md` and add tests in `tests/api/`. `coverage.test.ts` fails if
   an endpoint is not mounted.

## Conventions

- **Time.** Always use `c.var.now` / `c.var.dbNow` in the API, which come from the injected
  `deps.clock`. Never call `new Date()` for business time: tests move the clock with
  `TestClock`. The DB stores UTC `DATETIME(3)`. Convert with `toDbTime` / `fromDbTime`
  (`src/lib/time/db-time.ts`). Local dates use `LIBRARY_TIME_ZONE`.
- **Row mapping.** Rows are snake_case. The contract is camelCase. BIGINT ids and sums can
  arrive as strings, so convert with `Number(...)`, `toNumberOrNull` and `mapNullable`.
- **Helpers.** Use the helpers in `src/lib/utils.ts` (`isNil`, `isUndefined`, `isBoolean`,
  `omitNil`, `omitUndefined`, …, re-exported from lodash-es) instead of inline
  `=== null || === undefined` checks.
- **Money** is integer VND (`*_vnd` columns and `…Vnd` fields). There are no decimals.
- **Access.** A reader who asks for another reader's data gets `NOT_FOUND`, not `FORBIDDEN`
  (`self-or` access). Use `isStaffFor` to tell the two cases apart in a handler.
- **No import-time side effects.** `createApp(deps)` takes every dependency (pool, clock,
  verifier, logger), so tests build it against the test schema.
- **Comments and docs.** Comment the reason, and cite spec IDs where they apply (`FR-0xx`,
  research `R8`, …). Code, comments, specs and docs are written in plain English.
  `docs/report/` holds generated course-report artifacts; regenerate them with their scripts
  instead of editing by hand.

## Tests

- `tests/db`: acceptance and bypass tests per user story. `tests/concurrency`: CT-* cases, each
  run many times. `tests/api`: runs in-process through `createTestApp()` (`tests/api/helpers/app.ts`)
  with locally signed tokens (`helpers/tokens.ts`), without Supabase.
- After every test, `invariants-after-each.ts` checks that all `v_inv_*` views are empty. A
  test that inserts deliberately invalid rows as the owner must call `rawFixture()`.
- New behavior needs tests for success, for each rejection key, and for concurrency when two
  requests can race.

## Workflow

- Features follow Spec Kit: `/speckit-specify` → `clarify` → `plan` → `tasks` → `implement`,
  with one `NNN-feature-name` branch per feature and a PR into `main`.
- Commits use Conventional Commits with a scope, e.g. `feat(api): …`, `fix(db): …`, `docs: …`.
- Before upgrading drizzle-kit, check whether the CHECK-diff patch is still needed
  (see ARCHITECTURE.md §2).
