# NexusLib

Database for a university library: catalog, readers and cards, loans, renewals, fines and
payments. It is built for the UIT database course (CSDL). Spec 001 delivers the **database
design and the ERD**: MySQL 8.4 migrations with tables, constraints, triggers, functions,
procedures, a cursor, views, sample data, and the tests that prove the rules hold, including
under concurrency.

Spec 002 adds the **API**: `/api/v1`, a Hono app inside Next.js. It uses Supabase Google
sign-in and calls the same stored procedures. Its typed contract (`src/lib/api/contract`) is
shared with the UI.

- Architecture, ERD and flow diagrams: [ARCHITECTURE.md](ARCHITECTURE.md)
- Spec, plan and tasks: [specs/001-library-db-design/](specs/001-library-db-design/),
  [specs/002-library-api/](specs/002-library-api/)
- Data dictionary: [docs/data-dictionary.md](docs/data-dictionary.md)
- Acceptance report: [docs/report/acceptance.md](docs/report/acceptance.md); API: [docs/report/api-acceptance.md](docs/report/api-acceptance.md)

## Tech stack

| Area | Choice |
| --- | --- |
| Database | MySQL 8.4 LTS (Docker `mysql:8.4`), InnoDB, UTC storage |
| Schema and migrations | Drizzle ORM / drizzle-kit 1.0.0-rc.4 (patched, see ARCHITECTURE.md) |
| Business operations | Stored procedures (`sp_*`), SQL SECURITY DEFINER |
| Scripts and tests | TypeScript, `tsx`, Vitest, `mysql2` |
| API | Next.js 16 Route Handler + Hono 4, zod 4 contract, Supabase Auth (Google), `jose` |

## Prerequisites

- Docker Desktop (Compose v2)
- Node.js 20+ and pnpm

## Setup

```sh
pnpm install
cp .env.example .env.local      # then edit the values
pnpm db:up                      # start MySQL (waits until healthy)
pnpm db:migrate                 # apply migrations as root, then grant the app account
pnpm db:seed                    # sample catalog, readers and loan history
pnpm db:check                   # invariant suite: every v_inv_* view must be empty
```

`.env.local` holds only these variables. No name is fixed, so change any value you like:

| Variable | Meaning |
| --- | --- |
| `DB_HOST`, `DB_PORT` | MySQL host and port (e.g. `127.0.0.1`, `3306`) |
| `DB_NAME` | Main schema; the test schema is always `${DB_NAME}_test` |
| `DB_USER`, `DB_PASSWORD` | Restricted application account |
| `MYSQL_ROOT_PASSWORD` | Owner (root): migrations, grants, test reset, dumps |
| `GOOGLE_BOOKS_API_KEY` | Optional; only for the one-off Google Books fetch |

MySQL reads these values only when the volume is empty. After changing a name or password, run
`docker compose --env-file .env.local down -v` and start again.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm db:up` / `pnpm db:down` | Start / stop the MySQL container |
| `pnpm db:spike` | Check the server features the design relies on |
| `pnpm db:migrate` | Apply `drizzle/` migrations as root, then apply grants |
| `pnpm db:reset-test` | Recreate `${DB_NAME}_test` (the tests do this themselves) |
| `pnpm db:seed [--reset]` | Load sample data; refuses a non-empty schema unless `--reset` |
| `pnpm db:check` | Run the invariant views (`v_inv_*`) |
| `pnpm db:objects` | List tables, views, triggers, functions, procedures, events |
| `pnpm db:report -- --month 2026-09` | Monthly fine roll-forward and cumulative check |
| `pnpm db:ddl` / `pnpm db:explain` | Export DDL and query plans to `docs/report/` |
| `pnpm db:backup` / `pnpm db:restore` | Dump to `backups/`, restore into `${DB_NAME}_restore` |
| `pnpm db:dictionary` | Regenerate `docs/data-dictionary.md` |
| `pnpm erd:relational` | Regenerate the relational ERD (Mermaid) from the migrated schema |
| `pnpm test:db` | Acceptance, bypass, function and ERD-sync tests |
| `pnpm test:concurrency` | Concurrency tests CT-1…CT-13 (each case 20 runs) |
| `pnpm test:api` | API tests: identity, provisioning, sign-up hook, every route, errors |
| `pnpm dev` | Next.js dev server; the API is at `http://localhost:3000/api/v1` |
| `pnpm test:bypass` | Bypass tests B-1…B-5, 20 runs |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |

## API

1. In `.env.local`, set `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co`.
   - The Supabase project must use JWT Signing Keys (asymmetric).
   - Enable only the Google provider.
   Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and add `<origin>/api/v1/auth/callback` to Supabase's
   redirect URLs. The API receives the Google sign-in callback (and email-link confirmations at
   `/api/v1/auth/confirm`), stores the session cookies and creates the library account.
2. Optional: set `AUTH_HOOK_SECRET` to enable the Before User Created hook, but only where
   Supabase can reach the app. See `specs/002-library-api/contracts/signup-hook.md`.
3. Run `pnpm dev`, then `curl localhost:3000/api/v1/health`.

The contract is `src/lib/api/contract`:
- zod input schemas, response types and error keys;
- `endpoints`, one entry per route, with a JSDoc comment giving its access rule and errors.

The endpoint list is `specs/002-library-api/contracts/http-api.md`. From UI code:

```ts
import { endpoints } from '@/lib/api/contract';
import { apiFetch, ApiClientError } from '@/lib/api/client';

const result = await apiFetch(endpoints.checkout, { body: { readerId, copyIds } }, { token });
// Throws ApiClientError: e.key is 'COPY_NOT_AVAILABLE', 'LIMIT_REACHED', …
```

The first signed-in request creates the library account with the `reader` role. An admin
assigns staff roles with `PUT /api/v1/accounts/{id}/roles/{role}`.

## Changing the schema

1. Edit the tables in `src/lib/db/schema/*.ts`.
2. `pnpm exec drizzle-kit generate --name=<change>` writes a folder under `drizzle/`.
3. For triggers, procedures, functions and views, write SQL in a custom migration:
   `pnpm exec drizzle-kit generate --custom --name=<change>`.
4. `pnpm db:migrate`, then `pnpm erd:relational`, `pnpm db:dictionary` and `pnpm test:db`.
   The ERD-sync test fails if `docs/erd/relational.mmd` or the ERD in ARCHITECTURE.md is out
   of date.

Migrations never name an account or a schema. Grants are applied by `scripts/db/grants.ts`.

## Repository layout

```text
src/app/api/           Next.js catch-all route that mounts the API
src/server/api/        Hono app: routes, auth, access, error mapping, queries
src/lib/api/           API contract (shared with the UI) and apiFetch client
src/integrations/      Supabase token verifier and sign-up hook
src/lib/db/            connection config, pool, callProcedure, grants list
src/lib/db/schema/     Drizzle table definitions (27 tables)
drizzle/               migrations: generated DDL + custom SQL (triggers, routines, views)
scripts/db/            migrate, grants, check, report, backup/restore, dictionary, …
scripts/erd/           relational ERD generator, Chen view splitter, renderer
scripts/seed/          seed.ts (deterministic sample data), fetch-google-books.ts
data/seed/             books.manual.json, people.json, isbn-list.txt
docs/erd/              conceptual ERD (PlantUML Chen), relational.mmd, mapping, predicates
docs/report/           DDL, EXPLAIN plans, performance, backup/restore, acceptance
tests/db/              acceptance and bypass tests per user story
tests/concurrency/     CT-1…CT-8, CT-13 and performance
tests/api/             API tests (in-process, local signed tokens, injected clock)
specs/                 Spec Kit feature specs
```

## Status

Core (spec 001) is done and has passed the demo gate (see the acceptance report). The only
extension, reservations and holds (queue promotion, hold expiry every 15 minutes), is built too.
Still open:

- fetch Google Books metadata (needs an API key), then have the team review it;
- the web UI (a later spec) and the Google Books import (spec 003).
