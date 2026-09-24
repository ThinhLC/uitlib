# Quickstart: Validate the Library Database

**Feature**: `001-library-db-design` | **Plan**: [plan.md](./plan.md)

This guide shows how to run and check the database once the plan is implemented, proving the
design works end to end. The `pnpm` script names below are the ones the plan adds to
`package.json`. The details of each check are in [data-model.md](./data-model.md) and
[contracts/](./contracts/).

## 1. Prerequisites

- Docker Desktop (or Docker Engine + Compose v2).
- Node 24 and pnpm (already used by the repo).
- Only for refreshing sample book data: a Google Books API key. Normal seeding does not need it.

## 2. Configure

Copy `.env.example` to `.env.local` (never committed). There are only five required
variables, and every value is yours to change. Nothing in Docker, the migrations or the scripts
is tied to a fixed name (spec FR-030).

```sh
DB_HOST=127.0.0.1
DB_PORT=3306                   # change if 3306 is already used on your machine
DB_NAME=library                # the test schema is always ${DB_NAME}_test
DB_USER=library_app            # app account (restricted privileges)
DB_PASSWORD=change-me
MYSQL_ROOT_PASSWORD=change-me-root   # owner: migrations, grants, test reset, dumps
# GOOGLE_BOOKS_API_KEY=        # optional, only for scripts/seed/fetch-google-books.ts
```

The MySQL image reads these values the **first** time the container starts with an empty
volume. If you change `DB_NAME`, `DB_USER` or a password later, run `docker compose down -v`
and start again.

## 3. Start MySQL

```sh
pnpm db:up             # = docker compose --env-file .env.local up -d --wait db
docker compose --env-file .env.local exec db mysql -uroot -p -e "SELECT VERSION(), @@time_zone, @@log_bin_trust_function_creators"
```

Expected: `8.4.x`, `+00:00`, `1`. The first start creates the `$DB_NAME` schema and the
`$DB_USER` account. The `${DB_NAME}_test` schema is created later by `pnpm db:reset-test`, run
as root (research R1, R6).

To start over: `docker compose --env-file .env.local down -v` (removes the data volume).

Compose reads `.env` for `${...}` substitution by default, so every compose command passes
`--env-file .env.local`; the `pnpm db:*` scripts already do.

## 4. Spike first (plan Phase A)

```sh
pnpm db:spike
```

Expected: every line prints `PASS`. The spike checks each "Verify in S0" item in research.md:

- **Server settings**: version, config applied.
- **Table features**: CHECK rejects a bad row; generated-column UNIQUE raises 1062.
- **Triggers**: a trigger `SIGNAL` reaches `mysql2` as 45000.
- **Procedures and cursors**:
  - a procedure with `JSON_TABLE` + `FOR UPDATE` + an EXIT HANDLER rolls back and re-raises;
  - a deadlock inside a procedure surfaces as 1213 and leaves no rows;
  - a cursor loop commits once per row.
- **Functions**: `fn_due_at` gives the US2-10 values.
- **Privileges**: `$DB_USER` INSERT into a protected table gives 1142, while `CALL` works.
- **Drizzle**: rc.4 emits CHECK and generated columns; the migrator runs `CREATE PROCEDURE` and
  `CREATE TRIGGER`.
- **Tooling**: `performance_schema.data_lock_waits` is readable; PlantUML renders `@startchen`.

If a line fails, record the fallback in research.md before continuing.

## 5. Migrate and check

```sh
pnpm db:migrate        # as root: tables → triggers → functions → procedures → views,
                       # then scripts/db/grants.ts grants $DB_USER (name from .env.local)
pnpm db:check          # every v_inv_* view returns 0 rows
pnpm db:objects        # counts tables, triggers, functions, procedures, views (FR-029)
```

Expected: migrations apply cleanly to an empty schema. `db:objects` lists the 27 tables and every
routine named in [contracts/db-routines.md](./contracts/db-routines.md), plus the 17 triggers and
the views.

## 6. Seed and report

```sh
pnpm db:seed           # as $DB_USER: catalog from data/seed/*.json, history via procedures
pnpm db:check
pnpm db:report -- --month 2026-09 --month 2026-10
```

Expected:

- **Seed size**: at least 30 books, 60 copies, 20 readers across 3 reader types, and every
  [Core] case in spec FR-025.
- **Copy counts**: for each book, the copies by status add up to the total.
- **Debt report**: for every reader, cumulative net assessed = collected + outstanding, and each
  month's roll-forward matches.
- **US4-14 reader**: September shows 0 / 30,000 / 0 / 0 / 30,000; October shows
  30,000 / 0 / 0 / 30,000 / 0.

## 7. Run the tests

```sh
pnpm test:db                    # functions, acceptance [Core], RS-1, bypass B-1…B-5, ERD sync
pnpm test:concurrency           # CT-1…CT-13, 20 runs each, invariant views after each run
pnpm test:bypass                # B-1…B-5, 20 runs (SC-003)
```

Expected: all green. Test names carry the scenario and rule ids (e.g. `US3-2 R-12a`), so every
[Core] row of the spec's Rule Enforcement Matrix can be traced to a passing test (SC-002, SC-003).

## 8. ERD and report artifacts

```sh
pnpm erd:relational    # regenerate docs/erd/relational.mmd from information_schema
pnpm erd:render        # render docs/erd/conceptual.puml (Chen) and relational diagram to docs/report/
pnpm db:dictionary     # docs/data-dictionary.md from information_schema + predicates
pnpm db:ddl            # docs/report/ddl.sql via mysqldump --no-data --routines --triggers
pnpm db:explain        # docs/report/explain/*.txt for each report view
```

Expected: `git diff docs/erd/relational.mmd` is empty after `erd:relational`; the ERD sync test
also checks this. Both diagrams exist as images.

## 9. Demo by hand (for the presentation)

- **Row locking (CT-1)**: in two `docker compose exec db mysql -u$DB_USER -p $DB_NAME`
  sessions, `CALL sp_checkout(...)` for the same copy while a third session holds
  `SELECT … FROM book_copies WHERE id = ? FOR UPDATE`. Release the third session: one call
  returns a loan and the other fails with `COPY_NOT_AVAILABLE`.
- **Permissions (B-2)**: `INSERT INTO loans …` as `$DB_USER` fails with
  `ERROR 1142 … INSERT command denied`.
- **Immutable policies (B-3)**: `UPDATE loan_policies SET daily_late_fee_vnd = 9999` fails with
  `ERROR 1142` as `$DB_USER`, and with `POLICY_IMMUTABLE` as `root`.
- **Cursor**: `CALL sp_expire_cards(<admin>, '2027-01-01 00:00:00.000', @n); SELECT @n;`
- **Backup and restore**: `pnpm db:backup` then `pnpm db:restore -- --into ${DB_NAME}_restore`,
  then `pnpm db:check` on the restored schema.
