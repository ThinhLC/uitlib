# Research: Core Library Data Model and ERD

**Feature**: `001-library-db-design` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)
(revision 5, after clarification)

This file resolves the technical questions for the plan. Items marked **Verify in S0** are
decided here but MUST be confirmed by the spike (plan Phase A) on the Docker image before the
work that depends on them starts.

Scope reminder (spec Clarifications 2026-09-24): spec 001 delivers the **database only**:
- the ERD at two levels (conceptual Chen + relational crow's-foot) plus a data dictionary;
- migrations for tables, constraints, triggers, functions, procedures, cursors and views;
- seed data and database-level tests.

No API, UI or Supabase integration. Business operations are stored procedures that the later
API will call.

Repository facts (2026-09-24):
- **Installed**: Next.js 16.3.6, `drizzle-orm` / `drizzle-kit` 1.0.0-rc.4 (supports `check()`,
  `.generatedAlwaysAs()`, `.for()`, `generate --custom`), `mysql2` 3.24, `tsx`, Node 24.
- **Drizzle config**: `drizzle.config.ts` points at `src/lib/db/schema.ts` (empty) and outputs
  to `./drizzle`.
- **Not on this machine yet**: Docker and MySQL; the team runs Docker locally.

---

## R1. Database server: MySQL 8.4 in Docker

- **Decision**: Use the official image, pinned to `mysql:8.4` (LTS, D10), started by
  `docker compose up -d db`, with a generic named volume `mysql-data`. Docker Compose prefixes
  the volume with the project name, so clones do not collide.
  - Compose maps the project variables onto the image's built-in ones: `MYSQL_DATABASE:
    ${DB_NAME}`, `MYSQL_USER: ${DB_USER}`, `MYSQL_PASSWORD: ${DB_PASSWORD}`, plus
    `MYSQL_ROOT_PASSWORD`. On the first start of an empty volume, the image itself creates the
    main schema and the app account, so there is no custom init script.
  - A mounted config file sets `default_time_zone = '+00:00'`,
    `log_bin_trust_function_creators = 1`, `event_scheduler = ON`,
    `character-set-server = utf8mb4` and `collation-server = utf8mb4_0900_ai_ci`, and keeps
    the default strict `sql_mode`.
- **Rationale**: This is the team's choice. Everyone runs the same version, which the design
  needs: CHECK is enforced from 8.0.16, `JSON_TABLE` needs 8.0.4, and generated-column unique
  indexes and `FOR SHARE` need 8.0. The trust flag keeps routine creation working if the owner
  is ever a non-SUPER account (for example on a hosted server later).
- **Alternatives rejected**: Homebrew MySQL (versions drift between teammates), managed
  serverless MySQL such as PlanetScale or TiDB Serverless (limited triggers/routines), MariaDB
  (different CHECK/JSON behaviour), a custom init script with separate owner variables (more
  variables to manage for no gain locally).
- **Verify in S0**: server version; the config file is applied; the app account exists; root
  can create a function, a trigger and an event.

### Environment variables (spec FR-030: minimal set)

| Variable | Default in `.env.example` | Used by |
| --- | --- | --- |
| `DB_HOST` | `127.0.0.1` | all scripts, app pool |
| `DB_PORT` | `3306` | compose port mapping, all scripts |
| `DB_NAME` | `library` | main schema; the test schema is always `${DB_NAME}_test` |
| `DB_USER` / `DB_PASSWORD` | `library_app` / `change-me` | app account: pool, seed, tests |
| `MYSQL_ROOT_PASSWORD` | `change-me-root` | owner (root): migrations, grants, test reset, dumps |
| `GOOGLE_BOOKS_API_KEY` | (empty, optional) | one-off fetch script only |

That is five required variables and one optional one. Derived values are never separate
variables: the test schema is `${DB_NAME}_test`, and the scratch schemas are
`${DB_NAME}_spike` and `${DB_NAME}_restore`. The image version is pinned in
`docker-compose.yml`. `src/lib/db/config.ts` builds every connection from these variables and
fails fast with a clear message if a required one is missing. There are no URL constants and no
literal names in code.

## R2. Migrations: Drizzle schema + custom SQL migrations

- **Decision**:
  - Tables, keys, FKs, CHECKs, indexes and generated columns are declared in Drizzle TypeScript
    (`src/lib/db/schema/*.ts`) and generated with `drizzle-kit generate` (constitution II).
  - Triggers, functions, procedures, views and grants go in **custom SQL migrations**
    (`drizzle-kit generate --custom --name=<topic>`). Each routine is one statement separated
    by `--> statement-breakpoint`, with no `DELIMITER` lines.
  - Migrations are applied by a small script that runs Drizzle's `migrate()` as the owner
    account.
- **Rationale**: One ordered migration history reproduces the full DDL for Chapter 3.
  `mysqldump --no-data --routines --triggers` then exports it for the report.
- **Alternatives rejected**: hand-written SQL only (breaks constitution II and drops the typed
  schema the API will use), `drizzle-kit push` (no history).
- **Verify in S0**: rc.4 emits CHECK and `GENERATED ALWAYS AS (…) STORED` correctly; the
  migrator runs a multi-line `CREATE PROCEDURE … BEGIN … END` and `CREATE TRIGGER`; a
  migration containing `GRANT` runs as the owner.

## R3. "Partial unique" rules

- **Decision**: STORED generated column that is NULL when the rule does not apply, plus UNIQUE:
  - `library_cards.active_reader_id` (R-08c)
  - `loan_items.open_copy_id` (R-12a)
  - `reservations.active_flag` in UQ(`reader_id`, `book_id`, `active_flag`) (R-14a)
  - `reservations.ready_copy_id` (R-14d)
- **Rationale**: Enforced for every writer and under concurrency. A named column also reads
  clearly in the data dictionary.
- **Verify in S0**: a duplicate row raises 1062.

## R4. I-1 (copy `on_loan` ⇔ one open loan item) without a pointer column

- **Decision**: R-12a plus two guard triggers (`trg_book_copies_bu`, `trg_loan_items_bi`). The
  procedures write in a fixed order: checkout inserts the loan item before updating the copy,
  and return/lost updates the loan item before the copy. Race safety comes from the copy row lock
  inside the procedure plus R-12a.
- **Alternative rejected**: `book_copies.current_loan_item_id` (circular FK, harder seeds).

## R5. Business operations as stored procedures (spec FR-026)

- **Decision**: One procedure per [Core] operation. Signatures are in
  [contracts/db-routines.md](./contracts/db-routines.md). Every operation procedure follows the
  same template:
  1. Parameters include `p_actor_user_id` and `p_now DATETIME(3)` (injected clock).
  2. Authorization: `IF NOT fn_has_permission(p_actor_user_id, '<code>') THEN SIGNAL …
     'FORBIDDEN'`. `fn_has_permission` also requires the account to be `active`.
  3. `START TRANSACTION`, then locking reads (`SELECT … FOR UPDATE` / `FOR SHARE`) in the spec's
     global lock order, validation, writes, `COMMIT`.
  4. `DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END`. This rolls back the
     whole transaction for every error, including deadlock 1213 and lock timeout 1205, which
     closes the "1205 rolls back only the statement" gap inside the procedure itself.
  5. Business rejections: `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '<KEY>: <detail>'`, with
     the key from the fixed list in the contract.
  6. Multi-row inputs (checkout copies, payment allocations) are JSON arrays expanded with
     `JSON_TABLE`.
  7. Shared steps (queue promotion [Ext], fine assessment) are internal procedures prefixed
     `sp__`. They run inside the caller's transaction and never start their own.
- **Constraint**: `START TRANSACTION` inside a procedure implicitly commits an open transaction.
  Callers (tests, seed, later the API) MUST call with autocommit on and no open transaction.
  The test helper asserts this.
- **Rationale**: The team chose this (Clarification Q1 → A). The database can be demonstrated
  and tested alone. Chapter 4 gets real procedures, and the API later only calls them.
- **Locking rule for decisions (analysis C1)**: every value that decides a write MUST come
  from a locking read (`FOR UPDATE` / `FOR SHARE`) taken after the reader lock. The balance
  functions (`fn_fine_net`, `fn_fine_remaining`, `fn_reader_outstanding`) use plain reads, so
  they serve views and reports only. `sp_checkout` and `sp_record_payment` compute debt and
  balances with explicit `SUM(...) … FOR SHARE` queries over fines, adjustments and
  allocations. Procedures MUST NOT use `START TRANSACTION WITH CONSISTENT SNAPSHOT`.
- **Alternatives rejected**: TypeScript services with application transactions (would need the
  API layer this feature excludes, and rules would be written twice).
- **Verify in S0**: a procedure with `JSON_TABLE`, `FOR UPDATE`, an EXIT HANDLER, and `RESIGNAL`
  whose SQLSTATE 45000 and message reach `mysql2`; a deadlock inside a procedure surfaces
  as 1213 with no rows left behind.

## R6. Accounts and privileges

- **Decision**: Two accounts, both configured only through the variables in R1.
  - **Owner = MySQL `root`** (password `MYSQL_ROOT_PASSWORD`). It runs migrations, the grants
    script, test resets, the spike, dumps and restores, and is the DEFINER of every routine,
    trigger, view and event (`SQL SECURITY DEFINER`). It creates `${DB_NAME}_test` (and the
    scratch schemas) when needed, so no pre-created schemas or owner variables are required.
  - **App account** (`DB_USER` / `DB_PASSWORD`), created by the image. Its privileges come
    only from `scripts/db/grants.ts`, which `pnpm db:migrate` runs right after the migrations,
    using the declarative list in `src/lib/db/grants.ts`. Migration SQL cannot read the
    environment, so it never names an account (constitution II, spec FR-030). For the target
    schema the script does:
    - `REVOKE ALL` first. This also removes the blanket `ALL` the image grants on `DB_NAME`.
    - `SELECT` on all tables and views.
    - `INSERT, UPDATE, DELETE` only on the catalog and people tables that FR-026 allows:
      books, authors, publishers, categories, book_authors, book_categories,
      book_identifiers, book_external_refs, readers, app_users, user_roles.
    - `EXECUTE` on every routine whose name starts with `fn_` or `sp_` but not `sp__`, read
      from `information_schema.ROUTINES`. Internal `sp__*` helpers are never granted.
    - No direct write access to book_copies, library_cards, loan_policies, loans,
      loan_items, loan_renewals, reservations, fines, fine_adjustments, fine_payments or
      fine_payment_allocations (R-26).
  - `--schema` selects `DB_NAME` (default) or `${DB_NAME}_test` (`--test`), or any schema for
    a restore. The script is idempotent.
- Reference data (material types, reader types, roles, permissions, role_permissions) is
  seeded by migrations as the owner.
- **Verify in S0**: the app account's INSERT into `loans` → 1142 after the grants script;
  `CALL` of a DEFINER procedure that writes `loans` succeeds.

## R7. Stored functions (spec FR-027)

| Function | Characteristic | Purpose |
| --- | --- | --- |
| `fn_local_date(ts)` | DETERMINISTIC | `DATE(ts + INTERVAL 7 HOUR)` (Asia/Ho_Chi_Minh, no DST) |
| `fn_due_at(borrowed_at, loan_days)` | DETERMINISTIC | 23:59:59.999 local on local borrow date + loan days, returned in UTC (FR-011) |
| `fn_days_late(due_at, end_at)` | DETERMINISTIC | `GREATEST(0, DATEDIFF(local(end), local(due)))` (FR-015a) |
| `fn_late_fee(days, daily_fee, cap)` | DETERMINISTIC | `days × fee`, capped when cap is not NULL (D2) |
| `fn_fine_net(fine_id)` | READS SQL DATA | assessed + Σ adjustments |
| `fn_fine_remaining(fine_id)` | READS SQL DATA | net − Σ allocations |
| `fn_reader_outstanding(reader_id, as_of)` | READS SQL DATA | cumulative outstanding at `as_of` (FR-018) |
| `fn_has_permission(user_id, code)` | READS SQL DATA | account `active` and holds the permission via roles |

- **Rationale**: Each rule is written once and used by procedures, views and reports. Pure date
  functions can be tested in isolation.
- **Verify in S0**: DETERMINISTIC functions with `INTERVAL` arithmetic give the US2-10 due times
  exactly.

## R8. Cursors (spec FR-028)

- **Decision**:
  - `sp_expire_cards(p_actor, p_now, OUT n)` [Core] declares a cursor over active cards with
    `expires_at <= p_now`, ordered by `reader_id`. For each row it runs a short transaction:
    lock the reader, then the card, re-check, set `expired`. The loop uses
    `DECLARE CONTINUE HANDLER FOR NOT FOUND`.
  - `sp_expire_holds` [Ext] does the same for expired `ready` reservations and runs promotion.
    The public procedure checks the permission, then calls an internal `sp__expire_holds_batch(
    p_now, OUT p_count)`. A MySQL `EVENT` runs that helper every 15 minutes (spec FR-014c), and
    `event_scheduler=ON` is set in the Docker config. `sp_checkout` also expires an overdue hold
    on the scanned copy before checking it.
- **Rationale**: These are justified batch jobs (constitution VII); cursors never drive checkout.
- **Verify in S0**: a cursor loop that commits per row inside one procedure.

## R9. Time and money

- **Decision**: `DATETIME(3)` holding UTC. The server default time zone is `+00:00`, and `mysql2`
  uses `timezone: 'Z'`. Money is `BIGINT` VND (Drizzle `mode: 'number'`). Procedures never read
  `NOW()` for business decisions; they use `p_now`, so seeds and tests can create history and the
  results are reproducible.

## R10. Diagrams (spec FR-024, US6)

- **Decision**:
  - **Conceptual ERD (Chen)**: hand-written in PlantUML's Chen syntax (`@startchen`) at
    `docs/erd/conceptual.puml`, rendered to SVG/PNG with the `plantuml/plantuml` Docker image.
  - **Relational diagram (crow's foot)**: *generated* from `information_schema` of the migrated
    database by `scripts/db/erd.ts` into `docs/erd/relational.mmd` (Mermaid `erDiagram` with
    PK/FK/UK markers). The generated file is committed; a test regenerates it and fails on any
    difference (US6-4, SC-001: 0 differences).
  - **Mapping table**: `docs/erd/mapping.md` (entity/relationship/multi-valued attribute →
    relation), hand-written and checked by a test that every relation name it lists exists.
  - **Data dictionary**: `docs/data-dictionary.md`, generated from `information_schema`
    (columns, types, nullability, keys, CHECKs) plus hand-written predicates (tân từ) kept in a
    small YAML file merged by the generator.
- **Rationale**: The team chose two levels (Q3 → B). Generating the relational side guarantees it
  matches the migrations. The Chen diagram is conceptual, so it is written by hand.
- **Alternatives rejected**: draw.io (binary-ish XML, hard to review), MySQL Workbench
  reverse-engineering (no source in repo, cannot be checked by a test).
- **Verify in S0**: the pinned `plantuml/plantuml` image renders `@startchen`; if not, fall back
  to draw.io for the Chen diagram only.

## R11. Tests

- **Decision**: **Vitest** (new dev dependency), with `mysql2` connections straight to the
  Docker database.
  - `tests/setup`: drop and re-create `${DB_NAME}_test` as owner, run migrations, then connect as
    `$DB_USER`. Test files run sequentially.
  - **Acceptance tests**: one file per user story; test names carry scenario and rule ids
    (e.g. `US3-2 R-12a`).
  - **Bypass tests B-1…B-5**: raw SQL as `$DB_USER`.
  - **Concurrency tests CT-1…CT-8**: a third *gate* session takes `FOR UPDATE` on the first
    contested row. Then the two calls are issued on separate connections, the test waits until
    both appear as lock waiters in `performance_schema.data_lock_waits`, and the gate commits.
    Each CT runs 20 times, followed by the invariant views.
  - **Function tests**: `SELECT fn_…` with fixed inputs (due times, days late, caps).
- **Rationale**: Concurrency needs several real sessions, and the lock-wait check proves both
  calls are really contending (spec: "coordinated so both … queue").
- **Verify in S0**: `performance_schema.data_lock_waits` is readable by the test account (grant
  `SELECT` on it, or run the wait check as owner).

## R12. Invariants and reports

- **Decision**:
  - Views `v_inv_*` (I-1…I-9) return violating rows; `pnpm db:check` fails on any row.
  - Reports are views plus two procedures that return result sets:
    `sp_report_cumulative(p_as_of)` and `sp_report_rollforward(p_from, p_to)` (FR-018).
  - Circulation reports are views: `v_report_overdue`, `v_report_copy_status`,
    `v_report_loans_by_month`, `v_report_popular_books`.
  - Each report query's `EXPLAIN` is saved for the report.

## R13. Seed data (spec FR-025a/b)

- **Decision**:
  - `scripts/seed/fetch-google-books.ts` is run once by hand with an API key. It takes a list of
    ISBNs and queries, fetches `volumes/{id}`, and writes `data/seed/books.google.json`,
    keeping provider, volume id, `fetched_at` and the raw snapshot.
  - The team reviews it and commits it together with `data/seed/books.manual.json` (hand-entered
    books, including some without ISBN or cover).
  - `scripts/seed/seed.ts`, running as `$DB_USER`:
    1. inserts catalog records and readers directly;
    2. calls procedures in time order with explicit `p_now` values to build copies, cards,
       policy versions, loans, returns, renewals, lost items, fines and payments;
    3. finishes with `pnpm db:check`.
- **Seed values (D1, accepted by the team 2026-09-24)**:

| Reader type | Max items | Loan days | Max renewals | Fee/day | Debt block | Card validity |
| --- | --- | --- | --- | --- | --- | --- |
| STUDENT | 5 | 14 | 2 | 2,000 | 50,000 | 1 year |
| LECTURER | 10 | 30 | 3 | 1,000 | 100,000 | 2 years |
| EXTERNAL | 3 | 7 | 1 | 5,000 | 0 (any debt blocks) | 6 months |

  A second STUDENT version from 2026-10-01 00:00 local (7 days, 5,000/day) reproduces US2-10.

## Carried decisions

- D2–D9, D13 as written in the spec.
- D1: accepted as in R13.
- D10: resolved; the lecturer has no version requirement, so MySQL 8.4 LTS (R1) is final.
- D11: resolved (procedure path).
- D12: the only Ext item is reservations and holds. Adjustments are Core (spec Clarifications,
  analysis U1). The import refresh and preview are [API] and leave spec 001.

## S0 results (2026-09-24)

`pnpm db:spike` on Docker `mysql:8.4` (server 8.4.11): **11/11 PASS**.
- **Server**: UTC time zone, trust flag and event scheduler all set.
- **Constraints**: CHECK rejects a bad row (3819); a UNIQUE on a STORED generated column
  rejects a duplicate (1062).
- **Trigger**: a trigger `SIGNAL` reaches mysql2 as 45000 with its message.
- **Procedures**:
  - a procedure with `JSON_TABLE`, `FOR UPDATE` and `EXIT HANDLER … ROLLBACK; RESIGNAL`
    leaves no rows after an error;
  - a deadlock inside a procedure surfaces as 1213 and leaves no rows;
  - a cursor loop commits once per row.
- **Functions**: DETERMINISTIC `fn_due_at` gives the US2-10 values.
- **Privileges**: the app account gets 1142 on INSERT, while `CALL` of a granted DEFINER
  procedure succeeds.
- **Lock waits**: waiters are visible in `performance_schema.data_lock_waits`.
- **Drizzle rc.4**:
  - it emits CHECK and `GENERATED ALWAYS AS (…) STORED`;
  - `migrate()` runs a multi-line `CREATE PROCEDURE` and `CREATE TRIGGER` from a custom
    migration (folder format `drizzle/<timestamp>_<name>/migration.sql`);
  - statements are separated by `--> statement-breakpoint`.
- **PlantUML**: the `plantuml/plantuml` image renders `@startchen`.

Conventions adopted from the spike (no fallback needed):
- **Drizzle CHECK expressions** are written with raw column names (``sql`amount >= 0` ``), not
  interpolated columns, because interpolation emits `` `table`.`column` ``.
- **Generated columns** must not reference an `AUTO_INCREMENT` column (MySQL rule). None of the
  design's derived keys does.
- **Procedures** use `SELECT … INTO … FOR UPDATE` (or `DO (SELECT …)`) for locking reads, so
  that no stray result sets are returned to the caller. Only the documented result sets are
  returned.
- **Compose** reads `.env` for `${…}` substitution by default, so every compose command passes
  `--env-file .env.local`.
- **Docker path**: on machines where the `docker` CLI is not on `PATH` (Docker Desktop not
  linked), add `/Applications/Docker.app/Contents/Resources/bin` to `PATH`.

### Drizzle-kit findings during implementation (2026-09-24)

1. **Changed CHECK expressions were not detected (MySQL).**
   - **Symptom**: after changing a `check()` expression under the same name, `drizzle-kit
     generate` printed "No schema changes".
   - **Root cause** (verified in `drizzle-kit@1.0.0-rc.4` `bin.cjs`): the MySQL diff builds
     SQL only for checks that were created or dropped *by name*. Checks whose value changed are
     computed in `alters` but never turned into statements. The Postgres and MSSQL paths handle
     them. The preview build `1.0.0-rc.5-ab785fc` has the same gap.
   - **Fix**: a committed pnpm patch, `patches/drizzle-kit@1.0.0-rc.4.patch` (registered under
     `patchedDependencies` in `pnpm-workspace.yaml`). In the MySQL diff it drops and re-creates
     every altered CHECK, because MySQL cannot alter a CHECK in place. With the patch,
     `drizzle-kit generate` produced `drizzle/*_null_safe_check_fixes` by itself.
   - **Upgrade note**: when upgrading drizzle-kit, re-check this path, and drop the patch once
     upstream handles it. Related upstream reports:
     [#4602](https://github.com/drizzle-team/drizzle-orm/issues/4602) and
     [#5730](https://github.com/drizzle-team/drizzle-orm/issues/5730).
2. **"PK conflict" with a schema folder.**
   - **Background**: `schema` accepts a file, a folder or a glob (drizzle config docs).
     drizzle-kit loads every module in the folder.
   - **Root cause**: a barrel `schema/index.ts` that re-exported the tables made every table load
     twice, so composite primary keys were registered twice.
   - **Fix**: the config points at the folder `./src/lib/db/schema`, which contains table modules
     only. The barrel for application code lives at `src/lib/db/tables.ts`.
3. **NULL-safe CHECKs.** A CHECK that evaluates to NULL counts as satisfied. Every CHECK on a
   nullable column tests `IS NOT NULL` explicitly. `reservations_ready_ck` and `fines_reason_ck`
   were fixed this way, after test RS-1 found the gap.
