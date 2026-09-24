---

description: "Task list for 001-library-db-design (library database, routines and ERD)"
---

# Tasks: Core Library Data Model and ERD

**Input**: Design documents from `specs/001-library-db-design/`

**Prerequisites**: plan.md, spec.md (revision 5), research.md, data-model.md,
contracts/db-routines.md, contracts/reports-and-invariants.md, contracts/seed-data-format.md,
quickstart.md

**Tests**: Required. The spec's Rule Enforcement Matrix, SC-002/SC-003, the concurrency tests
CT-1…CT-13 and the bypass tests B-1…B-5 all demand automated tests. Within each story, write the
test file first, run it, and see it fail before implementing.

**Organization**: Tasks are grouped by user story. The whole 27-table schema is foundational (the
schema *is* the product and every story uses it); each story then adds its triggers, stored
routines and tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1…US6 from spec.md
- **Custom migration `<name>`** means: run `pnpm drizzle-kit generate --custom --name=<name>`
  and write the SQL into the generated `migration.sql` under `drizzle/`. Separate statements
  with `--> statement-breakpoint`; do not use `DELIMITER`. Every routine is created with
  `SQL SECURITY DEFINER` and follows the calling rules and error keys in
  `contracts/db-routines.md`.
- Migrations never name an account, schema or other environment value (spec FR-030). The app
  account's grants, including `EXECUTE` on every public `fn_*` / `sp_*` routine, are applied
  by `scripts/db/grants.ts` after migrations (research R6). Internal `sp__*` helpers are never
  granted.
- Every name, credential and port comes from `.env.local` through `src/lib/db/config.ts`; no
  task may hard-code `library`, `db_app` or any other value.
- Test names MUST start with the scenario and rule ids they prove, e.g.
  `it('US3-2 R-12a B-1: second open loan item for a copy is rejected', …)`.

## Path Conventions

The repository root is the Next.js project. Database code lives in `src/lib/db/`,
`drizzle/`, `scripts/`, `docker/`, `data/seed/`, `tests/` and `docs/` (plan.md "Source Code").

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Docker MySQL, tooling and project wiring

- [X] T001 Create `docker-compose.yml` with one service `db` and no `container_name` (so several
  clones can run side by side):
  - image pinned to `mysql:8.4` (D10); port `${DB_PORT}:3306`; generic named volume
    `mysql-data` at `/var/lib/mysql` (Compose prefixes it with the project name);
  - `env_file: .env.local`; `environment:` maps the project variables onto the image's own:
    `MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}`, `MYSQL_DATABASE: ${DB_NAME}`,
    `MYSQL_USER: ${DB_USER}`, `MYSQL_PASSWORD: ${DB_PASSWORD}`. The image creates the main
    schema and the app account on first start, so there is no init script (research R1);
  - mount `./docker/mysql/conf.d` at `/etc/mysql/conf.d`;
  - a healthcheck using `mysqladmin ping`.
- [X] T002 [P] Create `docker/mysql/conf.d/mysql.cnf` with a `[mysqld]` section:
  `default_time_zone='+00:00'`, `log_bin_trust_function_creators=1`,
  `character-set-server=utf8mb4`, `collation-server=utf8mb4_0900_ai_ci`,
  `performance_schema=ON`, `event_scheduler=ON` (for the [Ext] hold-expiry event). Keep the
  default strict `sql_mode` (research R1). No schema or account names in this file.
- [X] T003 [P] Create `.env.example` with exactly the variables in research.md "Environment
  variables": `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME=library`, `DB_USER=library_app`,
  `DB_PASSWORD=change-me`, `MYSQL_ROOT_PASSWORD=change-me-root`, and a commented optional
  `# GOOGLE_BOOKS_API_KEY=`. Add a one-line comment per variable, and note that:
  - the test schema is always `${DB_NAME}_test`;
  - changing `DB_NAME`, `DB_USER` or the passwords after the first start needs
    `docker compose down -v`.

  Do not add any other variable. Confirm `.gitignore` ignores `.env.local` and `.env*.local`.
- [X] T004 [P] Create `src/lib/db/config.ts`:
  - load `.env.local` (dotenv), then export `dbConfig(role: 'owner' | 'app', opts?: { test?:
    boolean; schema?: string })`;
  - it returns `{ host, port, user, password, database }` from `DB_HOST`, `DB_PORT`, and:
    - for `owner`: user `root` with `MYSQL_ROOT_PASSWORD`;
    - for `app`: `DB_USER` with `DB_PASSWORD`;
    - database `DB_NAME`, or `${DB_NAME}_test` when `test`, or `opts.schema`;
  - export `testSchemaName()` = `${DB_NAME}_test` so no other file builds that name;
  - it throws `Missing env var <NAME>` for any missing required value, with no fallbacks to
    literal names (FR-030).
- [X] T005 Add the `vitest` dev dependency. If pnpm's `minimumReleaseAge` in
  `pnpm-workspace.yaml` blocks it, pin an older version or add an exclude entry. Add these
  scripts to `package.json`: `db:up` (`docker compose up -d db`), `db:spike`, `db:migrate`,
  `db:reset-test`, `db:check`, `db:objects`, `db:seed`, `db:report`, `db:ddl`, `db:explain`,
  `db:backup`, `db:restore`, `db:dictionary`, `db:grants`, `erd:relational`, `erd:render`,
  `test:db`,
  `test:concurrency`, `typecheck` (`tsc --noEmit`). Each script runs the matching file under
  `scripts/` with `tsx`, or runs vitest on `tests/db` / `tests/concurrency`.
- [X] T006 Move the empty `src/lib/db/schema.ts` out; table modules live in `src/lib/db/schema/` and the barrel in `src/lib/db/tables.ts` (a barrel inside the folder makes drizzle-kit load each table twice). Update
  `drizzle.config.ts`:
  - `schema: './src/lib/db/schema'`, `out: './drizzle'`, `dialect: 'mysql'`;
  - `dbCredentials` from `dbConfig('owner')` (host, port, user, password, database), with no
    URL literal.
- [X] T007 [P] Create `vitest.config.ts`:
  - `test.include` covers `tests/**/*.test.ts`, with `fileParallelism: false` and
    `sequence.concurrent: false`;
  - `testTimeout: 60000`;
  - `globalSetup: 'tests/helpers/global-setup.ts'`;
  - load `.env.local`.
- [X] T008 Update `src/lib/db/index.ts` to create a `mysql2` pool from `dbConfig('app')` with
  `timezone: 'Z'`, `supportBigNumbers: true` and `bigNumberStrings: false`. On each new
  connection run `SET SESSION innodb_lock_wait_timeout = 5`. Export `db` (drizzle) and `pool`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Spike, full schema, reference data, functions, table grants, invariant views and
test harness. Every user story depends on this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Spike S0 (plan Phase A: blocking gate)

- [X] T009 Create `scripts/db/spike.ts`. It connects as owner and app to a scratch schema
  `${DB_NAME}_spike` (create it, then drop it at the end) and prints `PASS`/`FAIL` for each check:
  - **Server**: `VERSION()` starts with `8.4`; `@@time_zone`/`@@global.time_zone = '+00:00'`;
    `@@log_bin_trust_function_creators = 1`.
  - **Constraints**: CHECK rejects a bad row (errno 3819); inserting a duplicate into a UNIQUE
    STORED generated column `IF(status='x', id, NULL)` gives errno 1062.
  - **Trigger**: a BEFORE INSERT trigger `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='KEY: x'`
    reaches mysql2 with `sqlState '45000'` and that message.
  - **Procedure**: a DEFINER procedure using `JSON_TABLE`, `SELECT … FOR UPDATE`, and
    `EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END` leaves no rows after a forced
    error.
  - **Deadlock**: provoked between two procedure calls, it surfaces as errno 1213 with no rows
    left behind.
  - **Cursor**: a loop commits once per row.
  - **Functions**: a DETERMINISTIC function computing
    `fn_due_at('2026-09-30 16:59:59.900', 14)` gives `'2026-10-14 16:59:59.999'`.
  - **Privileges**: after `GRANT SELECT` only, `$DB_USER` INSERT gives errno 1142, while `CALL`
    of a granted DEFINER procedure that inserts succeeds.
  - **Lock waits**: `performance_schema.data_lock_waits` shows a waiting session.
  - **Drizzle**: `drizzle-kit generate` output for a sample table includes `CHECK` and
    `GENERATED ALWAYS AS (...) STORED`; Drizzle `migrate()` executes a multi-line
    `CREATE PROCEDURE … BEGIN … END` from a custom migration.
  - **Events**: `@@event_scheduler = 'ON'`.
  - **PlantUML**: `docker run --rm plantuml/plantuml` renders a two-entity `@startchen` file to
    SVG.
- [X] T010 Run `pnpm db:up && pnpm db:spike`. Record the outcome and any fallback in a new
  section "S0 results (date)" at the end of
  `specs/001-library-db-design/research.md`. Examples: CHECK moved to a trigger, a DDL clause
  moved to a custom migration, or draw.io used for the Chen diagram. **Stop if a FAIL has no
  fallback.**

### Migration tooling and test harness

- [X] T011 Create `scripts/db/migrate.ts`. It runs Drizzle `migrate(db, { migrationsFolder:
  './drizzle' })` on a single `mysql2` connection (with `multipleStatements: false`) opened
  with `dbConfig('owner')`, or `dbConfig('owner', { test: true })` when `--test` is passed. It
  then runs `scripts/db/grants.ts` for the same schema and prints the applied migrations.
- [X] T012 [P] Create `src/lib/db/call-procedure.ts` exporting `callProcedure(pool, name,
  args, { retries = 3, outParams = [] })`. It:
  - acquires a fresh connection from the `mysql2` pool for every attempt and releases it
    afterwards, so it can never run inside a caller's open transaction;
  - executes `CALL name(?, …)` and reads OUT parameters via a follow-up `SELECT @p_…`;
  - retries only errno 1213/1205, with a random 50–200 ms back-off;
  - maps `sqlState '45000'` messages `'<KEY>: <detail>'` to a thrown `DbRuleError { key,
    detail }`.

  This is used by the seed, the tests and later the API (FR-026, contracts/db-routines.md
  "Calling rules").
- [X] T013 [P] Create `scripts/db/reset-test.ts`. As the owner (`dbConfig('owner', { test:
  true })`), it runs `DROP DATABASE IF EXISTS` / `CREATE DATABASE` on the `${DB_NAME}_test`
  schema, then runs `migrate.ts --test`, which re-applies the grants.
- [X] T014 [P] Create `tests/helpers/db.ts` exporting:
  - `appConn()` and `ownerConn()` (new `mysql2` connections from `dbConfig(…, { test: true })`,
    `timezone: 'Z'`);
  - `call(name, args, opts)`, wrapping `callProcedure` on an app-account pool;
  - `expectRule(promise, key)`, which asserts `DbRuleError.key`;
  - `expectErrno(promise, errno)` for 1062 / 1142 / 3819.
- [X] T015 [P] Create `tests/helpers/time.ts` exporting `vn(local: string): string`. It
  converts `'YYYY-MM-DD HH:MM:SS.mmm'` in Asia/Ho_Chi_Minh (UTC+07:00) to the UTC
  `DATETIME(3)` string. Example: `vn('2026-09-30 23:59:59.900')` →
  `'2026-09-30 16:59:59.900'`.
- [X] T016 [P] Create `tests/helpers/fixtures.ts` exporting builders that insert through
  `ownerConn()`:
  - `account(roles[])` → app_users + user_roles;
  - `reader(typeCode, opts)`;
  - `book(opts)` with authors/categories;
  - later-phase helpers that call procedures: `policy(...)`, `card(...)`, `copy(...)`.

  Also a `truncateAll()` that, as owner, runs `SET FOREIGN_KEY_CHECKS=0`, then `TRUNCATE
  TABLE` on every non-reference table, then `SET FOREIGN_KEY_CHECKS=1`. `TRUNCATE` does not
  fire DELETE triggers, so the append-only triggers need no escape hatch.
- [X] T017 [P] Create `tests/helpers/concurrency.ts` exporting:
  - `gate(table, id)`: an owner connection that runs `BEGIN; SELECT … FOR UPDATE` on the first
    contested row;
  - `waitForWaiters(n, timeoutMs)`: polls `performance_schema.data_lock_waits` until `n`
    sessions wait;
  - `race(callA, callB)`: starts the gate, fires both calls on separate app connections, waits
    for 2 waiters, commits the gate, and returns both settled results;
  - `repeat20(fn)`: runs a CT body 20 times with `truncateAll()` and fresh fixtures, then runs
    the invariant views after each run (research R11).
- [X] T018 [P] Create `tests/helpers/global-setup.ts`, which runs `scripts/db/reset-test.ts`
  once before all tests.

### Full schema (27 tables, data-model.md)

- [X] T019 [P] Create `src/lib/db/schema/catalog.ts` with Drizzle `mysqlTable` definitions,
  exactly as in data-model.md "Catalog":
  - **material_types**: `code` VARCHAR(32) UQ, `name` VARCHAR(100).
  - **publishers**, **authors**: `name` VARCHAR(255) + IX(`name`).
  - **categories**: `name` VARCHAR(150), `parent_id` FK→categories NULL,
    UQ(`parent_id`, `name`).
  - **books**:
    - text columns: `title` VARCHAR(500), `subtitle` VARCHAR(500) NULL, `description` TEXT
      NULL, `language_code` VARCHAR(8) NULL, `cover_url` VARCHAR(1000) NULL,
      `classification_code` VARCHAR(50) NULL;
    - `publisher_id` FK NULL, `material_type_id` FK;
    - `published_date_text` VARCHAR(10) NULL, `published_year` SMALLINT NULL
      "CK 1000–2100";
    - `replacement_cost_vnd` BIGINT NULL "CK ≥ 0";
    - `status` ENUM('active','retired');
    - `created_at`, `updated_at` DATETIME(3);
    - IX(`title`), IX(`published_year`), FULLTEXT(`title`, `subtitle`) (raw SQL in a custom
      migration if Drizzle cannot express FULLTEXT).
  - **book_authors**: PK(`book_id`, `author_id`), `author_order` TINYINT UNSIGNED "CK ≥ 1",
    UQ(`book_id`, `author_order`), IX(`author_id`).
  - **book_categories**: PK(`book_id`, `category_id`), IX(`category_id`).
  - **book_identifiers**: `identifier_type` ENUM('ISBN_10','ISBN_13','OTHER'),
    `identifier_value` VARCHAR(64), UQ(`book_id`, `identifier_type`, `identifier_value`),
    IX(`identifier_type`, `identifier_value`).
  - **book_external_refs**:
    - `provider` ENUM('GOOGLE_BOOKS'), `external_id` VARCHAR(64);
    - `source_url` VARCHAR(1000) NULL, `web_reader_link` VARCHAR(1000) NULL;
    - `viewability` ENUM('PARTIAL','ALL_PAGES','NO_PAGES','UNKNOWN') NULL, `embeddable` BOOLEAN
      NULL, `access_country` CHAR(2) NULL;
    - `raw_snapshot` JSON, `fetched_at` DATETIME(3);
    - UQ(`provider`, `external_id`), IX(`book_id`).
  - **book_copies**:
    - `barcode` VARCHAR(32) UQ, `shelf_code` VARCHAR(50) NULL, `acquired_at` DATE NULL;
    - `physical_condition` ENUM('good','worn','damaged') (`CONDITION` is reserved in MySQL);
    - `circulation_status` ENUM('available','on_loan','on_hold','in_repair','lost','retired');
    - `created_at`, `updated_at`;
    - UQ(`id`, `book_id`);
    - CK `NOT (physical_condition = 'damaged' AND circulation_status IN ('available','on_hold','on_loan'))`;
    - IX(`book_id`, `circulation_status`).

  All FKs `onDelete: 'restrict', onUpdate: 'restrict'`. All `id` columns are
  `bigint('id', { mode: 'number' }).autoincrement().primaryKey()`.
- [X] T020 [P] Create `src/lib/db/schema/people.ts`:
  - **app_users**: `supabase_user_id` CHAR(36) UQ, `status` ENUM('active','inactive'),
    `created_at`.
  - **roles**: `code` VARCHAR(64) UQ, `name`.
  - **permissions**: `code` VARCHAR(64) UQ, `description`.
  - **user_roles**: PK(`user_id`, `role_id`), IX(`role_id`).
  - **role_permissions**: PK(`role_id`, `permission_id`), IX(`permission_id`).
  - **reader_types**: `code` VARCHAR(32) UQ, `name`.
  - **readers**: `user_id` FK→app_users NULL UQ, `reader_type_id` FK, `full_name`
    VARCHAR(200), `email` VARCHAR(320) NULL, `phone` VARCHAR(20) NULL, `status`
    ENUM('active','suspended','inactive'), `created_at`.
  - **library_cards**:
    - `reader_id` FK, `card_number` VARCHAR(32) UQ;
    - `issued_at`, `expires_at` DATETIME(3), `status`
      ENUM('active','expired','lost','revoked'), `created_at`;
    - GEN STORED `active_reader_id` = `IF(status='active', reader_id, NULL)` UQ;
    - CK `expires_at > issued_at`.
- [X] T021 [P] Create `src/lib/db/schema/policies.ts` with **loan_policies**:
  - `reader_type_id`, `material_type_id` FKs;
  - `max_active_items` SMALLINT "CK > 0", `loan_days` SMALLINT "CK > 0", `max_renewals`
    SMALLINT "CK ≥ 0";
  - `daily_late_fee_vnd` BIGINT "CK ≥ 0", `debt_block_threshold_vnd` BIGINT "CK ≥ 0";
  - `valid_from` DATETIME(3), `valid_to` DATETIME(3) NULL
    "CK `valid_to IS NULL OR valid_to > valid_from`";
  - `created_by_user_id` FK→app_users, `created_at`;
  - IX(`reader_type_id`, `material_type_id`, `valid_from`).
- [X] T022 [P] Create `src/lib/db/schema/circulation.ts`:
  - **loans**: `reader_id` FK, `processed_by_user_id` FK→app_users, `borrowed_at`, `status`
    ENUM('open','closed'), `created_at`, IX(`reader_id`, `status`),
    IX(`reader_id`, `borrowed_at`).
  - **loan_items**:
    - `loan_id`, `copy_id`, `policy_id` FKs; `borrowed_at`;
    - `due_at` "CK `due_at > borrowed_at`";
    - `returned_at` NULL "CK `returned_at IS NULL OR returned_at >= borrowed_at`";
    - `return_condition` ENUM('good','worn','damaged') NULL;
    - `lost_declared_at` NULL
      "CK `lost_declared_at IS NULL OR lost_declared_at >= borrowed_at`";
    - `status` ENUM('on_loan','returned','lost');
    - `renewal_count` SMALLINT "CK `0 ≤ renewal_count ≤ applied_max_renewals`";
    - snapshot columns: `applied_loan_days` SMALLINT "CK > 0", `applied_max_renewals`
      SMALLINT "CK ≥ 0", `applied_daily_fee_vnd` BIGINT "CK ≥ 0";
    - GEN STORED `open_copy_id` = `IF(status='on_loan', copy_id, NULL)` UQ;
    - the status-consistency CK copied verbatim from data-model.md;
    - IX(`copy_id`, `status`), IX(`status`, `due_at`), IX(`loan_id`),
      IX(`policy_id`, `borrowed_at`).
  - **loan_renewals**: `loan_item_id` FK, `old_due_at`, `new_due_at`, `renewed_at`,
    `performed_by_user_id` FK, CK `new_due_at > old_due_at`, IX(`loan_item_id`).
  - **reservations**:
    - columns as in data-model.md;
    - composite FK (`assigned_copy_id`, `book_id`) → book_copies(`id`, `book_id`);
    - `fulfilled_loan_item_id` FK UQ NULL;
    - GEN STORED `active_flag` = `IF(status IN ('waiting','ready'), 1, NULL)` with
      UQ(`reader_id`, `book_id`, `active_flag`);
    - GEN STORED `ready_copy_id` = `IF(status='ready', assigned_copy_id, NULL)` UQ;
    - the three CKs from data-model.md;
    - IX(`book_id`, `status`, `requested_at`, `id`).
- [X] T023 [P] Create `src/lib/db/schema/fines.ts`:
  - **fines**:
    - `loan_item_id` FK, `fine_type` ENUM('late','damaged','lost'),
      UQ(`loan_item_id`, `fine_type`);
    - `default_amount_vnd` BIGINT "CK ≥ 0", `assessed_amount_vnd` BIGINT "CK ≥ 0";
    - `reason` VARCHAR(500) NULL with CK
      `assessed_amount_vnd = default_amount_vnd OR CHAR_LENGTH(TRIM(reason)) > 0`;
    - `assessed_at`, `assessed_by_user_id` FK, IX(`assessed_at`).
  - **fine_adjustments**: `fine_id` FK, `amount_vnd` BIGINT "CK ≠ 0", `reason` VARCHAR(500)
    "CK non-blank", `adjusted_by_user_id` FK, `adjusted_at`, IX(`fine_id`).
  - **fine_payments**:
    - `reader_id` FK, `received_by_user_id` FK;
    - `amount_vnd` BIGINT "CK > 0", `paid_at`, `method` ENUM('cash','bank_transfer'),
      `reference_no` VARCHAR(64) NULL;
    - `request_key` VARCHAR(64) UQ, `created_at`;
    - IX(`reader_id`, `paid_at`), IX(`paid_at`).
  - **fine_payment_allocations**: PK(`payment_id`, `fine_id`), FKs, `amount_vnd` BIGINT
    "CK > 0", IX(`fine_id`).
- [X] T024 Export all tables from `src/lib/db/tables.ts` (drizzle-kit reads the `schema/` folder directly). Run
  `pnpm drizzle-kit generate --name=core_tables`. Review the generated SQL: every CHECK,
  `GENERATED ALWAYS AS (…) STORED` column, composite FK and `ON DELETE RESTRICT` must be present.
  Apply the S0 fallbacks from T010 by hand-editing or adding a follow-up custom migration
  `core_tables_fixups` (FULLTEXT index etc.).
- [X] T025 Custom migration `reference_data`, inserting:
  - material_types `BOOK_PRINT`;
  - reader_types `STUDENT`, `LECTURER`, `EXTERNAL`;
  - permissions `catalog.write`, `catalog.import`, `card.manage`, `loan.checkout`,
    `loan.return`, `loan.renew`, `fine.collect`, `policy.manage`, `role.manage`,
    `report.read`, `reservation.manage`, `fine.adjust`;
  - roles `admin`, `librarian`, `reader`;
  - role_permissions: `admin` → all; `librarian` → all except `policy.manage`, `role.manage`;
    `reader` → none (data-model.md).
- [X] T026 Custom migration `functions`: create the 8 functions exactly as specified in
  contracts/db-routines.md "Functions":
  - DETERMINISTIC: `fn_local_date`, `fn_due_at`, `fn_days_late`, `fn_late_fee`;
  - READS SQL DATA: `fn_fine_net`, `fn_fine_remaining`, `fn_reader_outstanding`,
    `fn_has_permission`.

  `fn_has_permission` returns TRUE only if `app_users.status='active'` and a
  `user_roles → role_permissions → permissions.code = p_code` path exists.
- [X] T027 Custom migration `invariant_views`: create `v_inv_copy_on_loan`,
  `v_inv_copy_on_hold`, `v_inv_queue_available`, `v_inv_loan_status`, `v_inv_fine_balance`,
  `v_inv_payment_allocation`, `v_inv_damaged_lendable`, `v_inv_cards_policies` and
  `v_inv_borrow_in_policy`. Each returns one row per violation with ids and a `problem` column,
  as defined in contracts/reports-and-invariants.md "Invariant views".
- [X] T028 Create `src/lib/db/grants.ts` (declarative list) and `scripts/db/grants.ts`
  (research R6, R-26). The script connects as the owner with `--schema <name>` (default
  `DB_NAME`; `--test` uses `${DB_NAME}_test`) and, for the account in `DB_USER`:
  1. `REVOKE ALL PRIVILEGES` on that schema (ignore "no such grant");
  2. `GRANT SELECT` on every table and view of the schema (read from `information_schema`);
  3. `GRANT INSERT, UPDATE, DELETE` **only** on `books`, `authors`, `publishers`,
     `categories`, `book_authors`, `book_categories`, `book_identifiers`,
     `book_external_refs`, `readers`, `app_users`, `user_roles`;
  4. `GRANT EXECUTE` on every routine in `information_schema.ROUTINES` whose name matches
     `fn_%` or `sp_%` but not `sp\_\_%`.

  All identifiers come from env or `information_schema` and are backtick-quoted. The script is
  idempotent and prints what it granted. Add `pnpm db:grants`.
- [X] T029 [P] Create `scripts/db/check.ts`: query every `v_inv_*` view as `$DB_USER`, print
  counts, and exit 1 if any view returns rows. Support `--test` and `--schema <name>`.
- [X] T030 [P] Create `scripts/db/objects.ts`: print counts and names from
  `information_schema.TABLES`, `TRIGGERS`, `ROUTINES` (split FUNCTION/PROCEDURE) and `VIEWS`
  for the target schema. Exit 1 if any of the 27 tables in data-model.md is missing (FR-029).
- [X] T031 [P] Create `tests/db/foundation.test.ts`. After a fresh migrate it asserts:
  - all 27 tables exist;
  - reference data rows exist;
  - the app account (from `DB_USER`) gets errno 1142 on INSERT into `loans` (R-26 part), and
    has `EXECUTE` on `fn_due_at`;
  - FR-030: no migration hard-codes an environment value. The test scans every
    `drizzle/*/migration.sql` and fails on a schema-qualified reference to `DB_NAME` or
    `${DB_NAME}_test` (whole identifier followed by a dot), an account literal `'<DB_USER>'@`, or
    any `DEFINER=` clause. It then checks that `information_schema` reports `root@%` as DEFINER of
    every routine, view, trigger and event. Plain substrings are **not** checked, because table
    names such as `library_cards` may contain the value of `DB_NAME`. `SHOW CREATE VIEW` is not
    used either, because MySQL schema-qualifies stored view bodies itself;
  - every `v_inv_*` returns 0 rows on the empty schema (FR-029).
- [X] T032 [P] Create `tests/db/functions.test.ts` with the expected values from
  contracts/db-routines.md:
  - `fn_due_at(vn('2026-09-30 23:59:59.900'), 14)` = `vn('2026-10-14 23:59:59.999')`;
  - `fn_due_at(vn('2026-10-01 00:00:00.000'), 7)` = `vn('2026-10-08 23:59:59.999')`;
  - `fn_days_late` for due 2026-10-10 local vs 2026-10-13 local = 3, and on-time = 0;
  - `fn_late_fee(10, 2000, 150000)` = 20000; `fn_late_fee(100, 2000, 150000)` = 150000;
    `fn_late_fee(3, 2000, NULL)` = 6000;
  - `fn_has_permission` is false for an inactive account and for a missing permission.

**Checkpoint**: `pnpm db:migrate`, `pnpm db:check`, `pnpm db:objects` and `pnpm test:db` (the
foundation and function tests) pass on an empty container.

---

## Phase 3: User Story 1 — Catalog books and physical copies (Priority: P1) 🎯 MVP

**Goal**: Books, authors, categories, identifiers, external references and copies, with the
copy lifecycle enforced by the database.

**Independent Test**: As `$DB_USER`:
- insert several books directly (one without ISBN, one with several authors and categories, two
  editions with the same title);
- register copies with `sp_register_copy`;
- confirm that duplicate barcodes, orphan copies, duplicate external refs, damaged-and-available
  copies and illegal status transitions are rejected.

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [X] T033 [P] [US1] Create `tests/db/us1-catalog.test.ts` covering:
  - US1-1 (two ordered authors + three categories retrievable);
  - US1-2 (three copies via `sp_register_copy`);
  - US1-3 R-01 (duplicate barcode → errno 1062 re-raised);
  - US1-4 (two editions, same title);
  - US1-5 (no ISBN, cover or description accepted);
  - US1-6 R-03 (second `book_external_refs` row with the same `('GOOGLE_BOOKS','V1')` → 1062);
  - US1-9 R-06a (damaged + available → errno 3819, or `INVALID_TRANSITION` via procedure);
  - FR-021 R-02 (deleting a book with copies → FK errno 1451).
- [X] T034 [P] [US1] Create `tests/db/us1-copy-lifecycle.test.ts` covering:
  - every allowed pair in data-model.md "State transitions" through `sp_change_copy_status`;
  - B-5 R-06b: illegal transitions (`lost→on_loan`, `retired→available`,
    `available→lost`) rejected with `INVALID_TRANSITION`, both via the procedure and as a
    direct owner `UPDATE`;
  - `FORBIDDEN` for an account without `catalog.write`.

### Implementation for User Story 1

- [X] T035 [US1] Custom migration `us1_copy_triggers`: `trg_book_copies_bu` (BEFORE UPDATE on
  `book_copies`) that:
  - (a) allows only the (old, new) `circulation_status` pairs in data-model.md "State
    transitions" (same status allowed only for `on_hold→on_hold`, and for unchanged status
    with other columns changing), else `SIGNAL '45000' 'INVALID_TRANSITION: …'`;
  - (b) when NEW is `on_loan` and OLD is not, requires
    `EXISTS(SELECT 1 FROM loan_items WHERE copy_id=NEW.id AND status='on_loan')`, else
    `'COPY_STATE: …'`;
  - (c) when OLD is `on_loan` and NEW is not, requires that no such row exists, else
    `'COPY_STATE: …'` (R-12c, research R4).
- [X] T036 [US1] Custom migration `us1_copy_procedures`, following contracts/db-routines.md.
  **`sp_register_copy(p_actor_user_id, p_now, p_book_id, p_barcode, p_shelf_code,
  p_acquired_at, p_condition, OUT p_copy_id)`**:
  - require permission `catalog.write`;
  - `START TRANSACTION`; lock the `books` row `FOR UPDATE` (`NOT_FOUND` if missing);
  - insert with `circulation_status = IF(p_condition='damaged','in_repair','available')`;
  - leave a marked extension point (a comment `-- [Ext] sp__promote_queue`) where queue
    promotion will be called;
  - `COMMIT`.

  **`sp_change_copy_status(p_actor_user_id, p_now, p_copy_id, p_target_status,
  p_condition)`**:
  - require permission `catalog.write`;
  - lock book → copy;
  - reject targets `on_loan`/`on_hold` (only circulation procedures set those) with
    `INVALID_TRANSITION`;
  - update condition first, then status (the trigger enforces the pair);
  - `COMMIT`.

  Both use `EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END`.
- [X] T037 [US1] Run `pnpm db:reset-test && pnpm test:db -- us1` until T033–T034 pass. Fix the
  migrations, not the tests.

**Checkpoint**: Catalog and copy lifecycle work and are proven on their own.

---

## Phase 4: User Story 2 — Readers, library cards and loan policy versions (Priority: P1)

**Goal**: Readers, one active card per reader, and immutable, non-overlapping policy versions
that govern checkout time only.

**Independent Test**: Insert readers; issue, revoke and re-issue cards with procedures (also
concurrently); create, close and replace policy versions; attempt overlaps, in-place edits,
retroactive closes and deletes of referenced versions; run the card-expiry cursor.

### Tests for User Story 2 ⚠️

- [X] T038 [P] [US2] Create `tests/db/us2-cards.test.ts` covering:
  - US2-1 (reader without account, later linked; a second reader with the same `user_id` →
    1062);
  - US2-2 R-08c (second active card rejected; after `revoked`, a new active card accepted);
  - US2-7 R-08b (expiry ≤ issue → 3819);
  - US2-9 R-08a (duplicate card number → 1062);
  - FR-028: `sp_expire_cards(admin, vn('2027-01-01 00:00:00.000'))` sets exactly the expired
    active cards to `expired` and returns the count.
- [X] T039 [P] [US2] Create `tests/db/us2-policies.test.ts` covering:
  - US2-4 R-09a/b (overlap rejected with `POLICY_OVERLAP`; close + create at the same instant
    accepted);
  - US2-5 R-09c B-3 (owner `UPDATE` of `daily_late_fee_vnd` → `POLICY_IMMUTABLE`; `$DB_USER`
    UPDATE → 1142);
  - US2-6 R-09d (delete of a referenced version → 1451; unreferenced version deletable by the
    owner);
  - US2-8 R-09e (with `p_now = vn('2026-10-02 …')`: closing at 2026-09-30, extending or
    clearing `valid_to` → `POLICY_CLOSE_REJECTED`);
  - `FORBIDDEN` without `policy.manage`.

  US2-10 is tested in T050 (it needs checkout).
- [X] T040 [P] [US2] Create `tests/concurrency/ct-08-cards-policies.test.ts` (CT-8, US2-3,
  R-08c, R-09a), using
  `repeat20`:
  - two `sp_issue_card` calls for the same reader: exactly one succeeds, the other gets 1062;
  - two overlapping `sp_create_policy_version` calls for the same pair: exactly one succeeds,
    the other gets `POLICY_OVERLAP`.

  The gate row is the `readers` row / the `reader_types` row respectively. Assert `v_inv_*`
  views are empty after each run.

### Implementation for User Story 2

- [X] T041 [US2] Custom migration `us2_policy_triggers`:
  - `trg_loan_policies_bi` raises `POLICY_OVERLAP` if a row for the same
    (`reader_type_id`, `material_type_id`) has `valid_from < COALESCE(NEW.valid_to, '9999-12-31')`
    AND `COALESCE(valid_to, '9999-12-31') > NEW.valid_from`.
  - `trg_loan_policies_bu` raises `POLICY_IMMUTABLE` if any column other than `valid_to`
    changes. It also raises `POLICY_IMMUTABLE` unless `valid_to` goes from NULL to a value or
    moves earlier (R-09c).
- [X] T042 [US2] Custom migration `us2_policy_procedures`:
  - **`sp_create_policy_version(p_actor_user_id, p_now, p_reader_type_id,
    p_material_type_id, p_max_active_items, p_loan_days, p_max_renewals,
    p_daily_late_fee_vnd, p_debt_block_threshold_vnd, p_valid_from, OUT p_policy_id)`**:
    - require permission `policy.manage`;
    - lock the `reader_types` row `FOR UPDATE`, then the versions of the pair `FOR UPDATE`;
    - `POLICY_OVERLAP` if any version for the pair overlaps `[p_valid_from, ∞)` or is still
      open;
    - insert.
  - **`sp_close_policy_version(p_actor_user_id, p_now, p_policy_id, p_valid_to)`**:
    - require permission `policy.manage`;
    - lock reader type → version;
    - reject with `POLICY_CLOSE_REJECTED` if `p_valid_to < p_now`, or
      `p_valid_to <= valid_from`, or (`valid_to` is not NULL and `p_valid_to >= valid_to`), or
      `p_valid_to <= (SELECT MAX(borrowed_at) FROM loan_items WHERE policy_id = … FOR SHARE)`
      (a locking read, per the research R5 rule; it uses index `(policy_id, borrowed_at)`);
    - update `valid_to` (FR-009c).

  Both use the standard EXIT HANDLER.
- [X] T043 [US2] Custom migration `us2_card_procedures`:
  - **`sp_issue_card(p_actor_user_id, p_now, p_reader_id, p_card_number, p_expires_at,
    OUT p_card_id)`**: require `card.manage`; lock the reader (`NOT_FOUND`), then the reader's
    cards `FOR UPDATE`; `VALIDATION` if `p_expires_at <= p_now`; insert with
    `issued_at = p_now` and `status='active'` (the UQ on `active_reader_id` raises 1062).
  - **`sp_set_card_status(p_actor_user_id, p_now, p_card_id, p_status)`**: require
    `card.manage`; lock reader → card; allow `active→expired|lost|revoked` and
    `expired|lost|revoked→` nothing (`INVALID_TRANSITION`).
  - **`sp_expire_cards(p_actor_user_id, p_now, OUT p_count)`**:
    - require `card.manage`;
    - `DECLARE cur CURSOR FOR SELECT id, reader_id FROM library_cards WHERE status='active' AND
      expires_at <= p_now ORDER BY reader_id, id`;
    - `CONTINUE HANDLER FOR NOT FOUND`;
    - per row: `START TRANSACTION`, lock reader → card `FOR UPDATE`, re-check, set
      `expired`, `COMMIT`, increment `p_count` (FR-028, research R8).

- [X] T044 [US2] Run `pnpm test:db -- us2` and `pnpm test:concurrency -- ct-08` until green.

**Checkpoint**: US1 and US2 pass independently.

---

## Phase 5: User Story 3 — Circulation: loans, renewals, lost items and copy lifecycle (Priority: P2)

**Goal**: `sp_checkout`, `sp_return_item`, `sp_declare_lost` and `sp_renew` enforce every
circulation rule under concurrency; return and lost assess fines atomically.

**Independent Test**: With seeded readers, cards, a policy version and copies, run the US3
scenarios and CT-1…CT-6. After each run, the invariant views return 0 rows.

### Tests for User Story 3 ⚠️

- [X] T045 [P] [US3] Create `tests/db/us3-checkout.test.ts` covering:
  - US3-1 (single-session happy path: loan + item + copy `on_loan`, due from `fn_due_at`);
  - US3-2 R-12a B-1 (owner direct INSERT of a second `on_loan` item → 1062);
  - US3-10 R-12c (owner `UPDATE book_copies SET circulation_status='available'` on a loaned
    copy → `COPY_STATE`);
  - US3-11 R-11b (owner INSERT with `due_at <= borrowed_at` → 3819);
  - US3-12 (expired card → `CARD_INVALID`; debt > threshold → `DEBT_BLOCKED`, with debt
    created via a lost fine; an overdue item → `OVERDUE_BLOCKED`; a `suspended` reader →
    `READER_NOT_ACTIVE`; at limit → `LIMIT_REACHED`; no version → `NO_POLICY`); in every case
    no rows are written;
  - US3-16 (two copies, one not available → `COPY_NOT_AVAILABLE`, nothing written);
  - `FORBIDDEN` without `loan.checkout`.
- [X] T046 [P] [US3] Create `tests/db/us3-return-renew.test.ts` covering:
  - US3-4 R-11a (after closing P1 and creating P2, the item keeps its `applied_*` values;
    owner UPDATE of `applied_daily_fee_vnd` → `SNAPSHOT_IMMUTABLE`);
  - US3-5 R-13a (renew due 2026-10-10 → 2026-10-24, count 1, renewal row with old/new due and
    actor);
  - US3-6 (overdue / at limit → `RENEWAL_REJECTED`, nothing changes);
  - US3-13 R-10a R-11c (loan `open` after the first return, `closed` after the second;
    `returned→on_loan` → `SNAPSHOT_IMMUTABLE`/`INVALID_TRANSITION`);
  - return with condition `damaged` → copy `in_repair`.
- [X] T047 [P] [US3] Create the concurrency tests, each with `repeat20`, `race` and
  invariant-view checks:
  - `tests/concurrency/ct-01-same-copy.test.ts` (CT-1, US3-1, R-12b, gate = copy row);
  - `tests/concurrency/ct-02-reader-limit.test.ts` (CT-2, US3-3, R-12b, gate = reader row,
    limit − 1);
  - `tests/concurrency/ct-03-multi-copy-order.test.ts` (CT-3, `copy_ids` `[A,B]` vs `[B,A]`,
    both complete without 1213 surfacing after retries, all-or-nothing).
- [X] T048 [P] [US3] Create more concurrency tests, each with `repeat20`, `race` and
  invariant-view checks:
  - `tests/concurrency/ct-04-return-vs-checkout.test.ts` (CT-4: the reader has one overdue item
    whose late fine pushes debt over the threshold; the result equals one serial order);
  - `tests/concurrency/ct-05-return-vs-lost.test.ts` (CT-5: exactly one terminal state; the
    fines match it);
  - `tests/concurrency/ct-06-checkout-vs-policy-close.test.ts` (CT-6, R-09f: the item's
    `policy_id`
    period contains `borrowed_at`; `v_inv_borrow_in_policy` is empty).
- [X] T049 [P] [US3] Create `tests/db/us3-reservation-schema.test.ts` (RS-1, R-14a/b/c/d,
  Core schema without reservation workflows). As the owner, insert reservations directly and
  assert that each of these is rejected:
  - a second `waiting` row for the same reader and book → 1062;
  - a `ready` row with NULL `assigned_copy_id` or NULL `hold_expires_at` → 3819;
  - a `ready` row whose `assigned_copy_id` belongs to another book → FK errno 1452;
  - two `ready` rows for the same copy → 1062.

  Also assert that `cancelled` / `expired` duplicates are allowed.
- [X] T050 [P] [US3] Add US2-10 R-09f to `tests/db/us3-checkout.test.ts`:
  - P1 = `[vn('2026-09-01 00:00'), vn('2026-10-01 00:00'))` with 14 days and 2,000 VND/day;
    P2 = `[vn('2026-10-01 00:00'), ∞)` with 7 days and 5,000 VND/day;
  - checkout at `vn('2026-09-30 23:59:59.900')` → P1, due `vn('2026-10-14 23:59:59.999')`;
  - checkout at `vn('2026-10-01 00:00:00.000')` → P2, due `vn('2026-10-08 23:59:59.999')`.

### Implementation for User Story 3

- [X] T051 [US3] Custom migration `us3_loan_item_triggers`:
  - `trg_loan_items_bi`: NEW.status must be `on_loan`, and the copy's status must be
    `available` or `on_hold`, else `COPY_STATE`.
  - `trg_loan_items_bu`:
    - `loan_id`, `copy_id`, `policy_id`, `borrowed_at` and `applied_*` unchanged, else
      `SNAPSHOT_IMMUTABLE`;
    - status only `on_loan→returned|lost` or unchanged, else `INVALID_TRANSITION`;
    - `due_at` may change only while OLD.status=`on_loan` and only to a larger value, else
      `SNAPSHOT_IMMUTABLE`.
- [X] T052 [US3] Custom migration `us3_fine_triggers`:
  - `trg_fines_bi` raises `FINE_RULE` if the loan item already has a `damaged` fine and NEW is
    `lost`, or vice versa.
  - `trg_fines_bu` and `trg_fines_bd` raise `APPEND_ONLY` unconditionally (test cleanup uses
    `TRUNCATE`, see T016).
- [X] T053 [US3] Custom migration `us3_checkout`: **`sp_checkout(p_actor_user_id, p_now,
  p_reader_id, p_copy_ids JSON)`** returns a result set
  (`loan_id, loan_item_id, copy_id, due_at`):
  1. Require `loan.checkout`. Validate that `p_copy_ids` is a non-empty JSON array of distinct
     ids (`VALIDATION`).
  2. `START TRANSACTION`. Lock the reader `FOR UPDATE` (`NOT_FOUND`); `READER_NOT_ACTIVE` unless
     `active`. This locking read MUST be the first read after `START TRANSACTION`; no plain
     SELECT on circulation or money tables may come before it (research R5 locking rule).
  3. `CARD_INVALID` unless an `active` card with `expires_at > p_now` exists, read from the
     reader's `library_cards` `FOR SHARE` (lock order reader → card).
  4. Lock the copies' books in ascending id `FOR UPDATE`, then the copies in ascending id
     `FOR UPDATE` (`NOT_FOUND` if any is missing).
  5. For the material type of each book, find the version with
     `valid_from <= p_now AND (valid_to IS NULL OR valid_to > p_now)` using `FOR SHARE`
     (`NO_POLICY`).
  6. `DEBT_BLOCKED` if the reader's outstanding debt > `debt_block_threshold_vnd`. Compute the
     debt with locking reads, **not** `fn_reader_outstanding`: Σ `fines.assessed_amount_vnd` +
     Σ `fine_adjustments.amount_vnd` − Σ `fine_payment_allocations.amount_vnd` over the
     reader's fines (joined through `loan_items → loans`), each `SUM` query ending in
     `FOR SHARE`.
  7. `OVERDUE_BLOCKED` if any of the reader's `on_loan` items has `due_at < p_now` (read
     `FOR SHARE`).
  8. `LIMIT_REACHED` if open items of that material type + the requested count >
     `max_active_items`.
  9. `COPY_NOT_AVAILABLE` unless every copy is `available`. [Ext] extension point: first expire
     an overdue `ready` hold on the copy (FR-014c on demand), then accept `on_hold` for this
     reader's `ready` reservation.
  10. Insert the `loans` row (`status='open'`, `borrowed_at=p_now`), then one `loan_items` row
      per copy with the `applied_*` snapshot and `due_at = fn_due_at(p_now, loan_days)`.
  11. Update each copy to `on_loan`.
  12. `COMMIT`; `SELECT` the result set.

  Standard EXIT HANDLER.
- [X] T054 [US3] Custom migration `us3_return_lost`:
  - **`sp__assess_fines(p_loan_item_id, p_actor_user_id, p_now, p_end_kind ENUM-like
    VARCHAR, p_damaged_vnd, p_lost_vnd, p_reason)`** runs inside the caller's transaction and
    is not granted:
    - late fine when `fn_days_late(due_at, p_now) > 0`: amount
      `fn_late_fee(days, applied_daily_fee_vnd, books.replacement_cost_vnd)`, default = same;
    - damaged fine when `p_end_kind='returned_damaged'`: `FINE_RULE` if `p_damaged_vnd` is NULL,
      negative, or > replacement cost, or if `p_reason` is blank; default_amount_vnd = 0,
      assessed = `p_damaged_vnd`;
    - lost fine when `p_end_kind='lost'`: default = replacement cost; if the replacement cost is
      NULL, `p_lost_vnd` and `p_reason` are required (`FINE_RULE`); assessed =
      `COALESCE(p_lost_vnd, default)`; a reason is required when they differ (FR-015a/b).
  - **`sp_return_item(p_actor_user_id, p_now, p_loan_item_id, p_return_condition,
    p_damaged_fine_vnd, p_reason)`**:
    - require `loan.return`;
    - lock the loan's reader → book → copy → loan → loan item;
    - `INVALID_TRANSITION` unless the item is `on_loan`;
    - set the item `returned`, `returned_at=p_now`, `return_condition`;
    - call `sp__assess_fines`;
    - set the copy: `in_repair` + condition `damaged` if damaged, else `available` (with a
      `-- [Ext] sp__promote_queue` extension point);
    - set the loan `closed` when no `on_loan` item remains;
    - `COMMIT`; return the fines as a result set.
  - **`sp_declare_lost(p_actor_user_id, p_now, p_loan_item_id, p_lost_fine_vnd, p_reason)`**:
    same locks; item `lost`, `lost_declared_at=p_now`; `sp__assess_fines('lost')`; copy
    `lost`; close the loan if it was the last open item.

- [X] T055 [US3] Custom migration `us3_renew`: **`sp_renew(p_actor_user_id, p_now,
  p_loan_item_id, OUT p_new_due_at)`**:
  - require `loan.renew`;
  - lock reader → book → loan item;
  - `RENEWAL_REJECTED` with detail `not_on_loan`, `overdue` (`due_at < p_now`),
    `limit` (`renewal_count >= applied_max_renewals`), or [Ext] `reserved` (a `waiting`
    reservation exists for the book, read `FOR SHARE` after the book lock);
  - new due = old due + `INTERVAL applied_loan_days DAY` (D5);
  - update the item and increment the count; insert `loan_renewals`;
  - `COMMIT`.
- [X] T056 [US3] Run `pnpm test:db -- us3` and `pnpm test:concurrency -- ct-0[1-6]` until
  green. Record p50/p95 timings of `sp_checkout` and `sp_return_item` from the CT runs in
  `docs/report/performance.md` (plan Performance Goals).

**Checkpoint**: Circulation is correct under concurrency; US1–US3 pass.

---

## Phase 6: User Story 4 — Fines, payments and outstanding debt (Priority: P2)

**Goal**: Fines are assessed by formula (via US3 procedures); payments are 100% allocated
through one procedure; debt and period reports are derived correctly.

**Independent Test**: Run the US4 scenarios on fines produced by `sp_return_item` /
`sp_declare_lost`, plus CT-7. For every reader, the cumulative identity and the monthly
roll-forward hold.

### Tests for User Story 4 ⚠️

- [X] T057 [P] [US4] Create `tests/db/us4-fines.test.ts` covering:
  - US4-1 (due 2026-10-10 local, returned 2026-10-13 local at 2,000/day → late fine 6,000);
  - US4-2 (on time → no fine);
  - US4-3 (lost 2026-10-20 → late 20,000 + lost 150,000; item and copy `lost`);
  - US4-4 R-15a/b (a second late fine → 1062; damaged + lost → `FINE_RULE`);
  - US4-9 (a returned item still owes);
  - US4-10 R-15c/d (damaged 40,000 with reason accepted and copy `in_repair`; 200,000 or no
    reason → `FINE_RULE`);
  - US4-11 R-17b B-4 (owner UPDATE/DELETE on `fines`, `fine_payments` and
    `fine_payment_allocations` → `APPEND_ONLY`).
- [X] T058 [P] [US4] Create `tests/db/us4-payments.test.ts` covering:
  - US4-5 (F1 = F2 = 30,000; pay 40,000 as 30,000 + 10,000 → collected 40,000, outstanding
    20,000, F1 remaining 0);
  - US4-6 R-16a/b/c/d (totals 35,000 / 45,000, an allocation over the remaining balance, or
    another reader's fine → `ALLOCATION_MISMATCH` and no rows; empty list or duplicate fine →
    `VALIDATION`);
  - US4-12 R-16e (same `request_key` → `p_replayed = TRUE`, one payment row);
  - US4-13 R-26 B-2 (`$DB_USER` INSERT into `fine_payments` / `fine_payment_allocations` →
    1142);
  - `PAYMENT_EXCEEDS_DEBT`;
  - `FORBIDDEN` without `fine.collect`.
- [X] T059 [P] [US4] Create `tests/db/us4-reports.test.ts` covering:
  - US4-14: the fine is assessed at `vn('2026-09-25 10:00')` and paid at
    `vn('2026-10-05 10:00')`;
  - `sp_report_rollforward` for September local returns 0 / 30,000 / 0 / 0 / 30,000, and for
    October 30,000 / 0 / 0 / 30,000 / 0;
  - `sp_report_cumulative(vn('2026-10-31 23:59:59.999'))` gives net 30,000 = collected 30,000
    + outstanding 0;
  - SC-006: the identity and roll-forward hold for every reader.
- [X] T060 [P] [US4] Create `tests/concurrency/ct-07-payments.test.ts` (CT-7, US4-7, R-16c,
  gate = reader row): two payments each allocating the full remaining balance of the same fine; exactly one
  succeeds and the other gets `ALLOCATION_MISMATCH`; `v_inv_fine_balance` and
  `v_inv_payment_allocation` are empty.

### Implementation for User Story 4

- [X] T061 [US4] Custom migration `us4_money_triggers`:
  - `trg_fine_payments_bu/bd` and `trg_fine_payment_allocations_bu/bd` raise `APPEND_ONLY`
    unconditionally;
  - `trg_fine_payment_allocations_bi` raises `ALLOCATION_MISMATCH` if
    Σ(allocations of NEW.payment_id) + NEW.amount_vnd > the payment amount, or if
    Σ(allocations of NEW.fine_id) + NEW.amount_vnd > `fn_fine_net(NEW.fine_id)` (R-16c
    guard).
- [X] T062 [US4] Custom migration `us4_record_payment`: **`sp_record_payment(p_actor_user_id,
  p_now, p_reader_id, p_amount_vnd, p_method, p_reference_no, p_request_key, p_allocations
  JSON, OUT p_payment_id, OUT p_replayed)`**, implementing steps 1–8 and the 1062 handler in
  contracts/db-routines.md "sp_record_payment steps":
  - `JSON_TABLE(p_allocations, '$[*]' COLUMNS(fine_id BIGINT PATH '$.fine_id', amount_vnd
    BIGINT PATH '$.amount_vnd'))`;
  - fines locked in ascending id, joined `loan_items → loans` for ownership;
  - remaining balances and the reader's total debt computed with `SUM … FOR SHARE` queries over
    adjustments and allocations, **not** `fn_fine_remaining` / `fn_reader_outstanding` (research
    R5 locking rule);
  - the re-sum check before `COMMIT`.
- [X] T063 [US4] Custom migration `us4_reports`:
  - `sp_report_cumulative(p_as_of, p_reader_id)` and `sp_report_rollforward(p_from, p_to,
    p_reader_id)`, returning the columns in contracts/reports-and-invariants.md (records count
    at their own time; opening/closing use `time < p_from` / `time < p_to`);
  - views `v_report_overdue`, `v_report_loans_by_month` (month in local time via
    `fn_local_date`), `v_report_popular_books`, `v_report_copy_status` (counts per status +
    total per book).
- [X] T064 [P] [US4] Create `tests/db/us4-adjustments.test.ts`:
  - US4-8 R-17a: an adjustment of −100,000 with a reason on a 150,000 lost fine with 50,000
    paid is accepted, and the fine is settled; −120,000 → `FINE_RULE`; a blank reason →
    `FINE_RULE`; no `fine.adjust` → `FORBIDDEN`;
  - owner UPDATE/DELETE on `fine_adjustments` → `APPEND_ONLY` (R-17b);
  - D9: a lost-then-found copy (`sp_change_copy_status` `lost→available`) keeps its loan item
    `lost`, and the unpaid lost fine can be reduced by an adjustment.
- [X] T065 [P] [US4] Create `tests/concurrency/ct-13-payment-vs-adjustment.test.ts` (CT-13,
  R-17a, gate = reader row): a payment of the remaining balance races an adjustment of
  −remaining; afterwards `v_inv_fine_balance` is empty.
- [X] T066 [US4] Custom migration `us4_adjustments`:
  - `trg_fine_adjustments_bi` raises `FINE_RULE` if `fn_fine_net(NEW.fine_id) +
    NEW.amount_vnd < Σ allocations` or `< 0` (guard);
  - `trg_fine_adjustments_bu/bd` raise `APPEND_ONLY` unconditionally;
  - `sp_adjust_fine(p_actor_user_id, p_now, p_fine_id, p_amount_vnd, p_reason, OUT
    p_adjustment_id)` per contracts/db-routines.md: permission `fine.adjust`; lock the
    fine's reader `FOR UPDATE`, then the fine `FOR UPDATE`; read Σ adjustments and
    Σ allocations `FOR SHARE`; `FINE_RULE` if `p_amount_vnd = 0`, the reason is blank, or
    afterwards net < allocated or net < 0; insert with `adjusted_at = p_now`.
- [X] T067 [US4] Run `pnpm test:db -- us4` and `pnpm test:concurrency -- ct-07 ct-13` until
  green.

**Checkpoint**: Debt and payment rules are correct; the reports reconcile.

---

## Phase 7: User Story 5 — Accounts, roles and permissions (Priority: P3)

**Goal**: Account identity links are unique; every operation procedure authorizes its acting
account; deactivation keeps history. ([API] scenarios US5-2/3/5 belong to the later API
feature.)

**Independent Test**: Insert accounts and roles; call every public operation procedure with an
unauthorized and with an inactive account; deactivate an account that has history.

### Tests for User Story 5 ⚠️

- [X] T068 [P] [US5] Create `tests/db/us5-rbac.test.ts` covering:
  - US5-1 R-19a (duplicate `supabase_user_id` → 1062);
  - US5-4 (a librarian with 20 loans set `inactive`: the loans still reference it, and its
    next `sp_checkout` → `FORBIDDEN`);
  - US5-6 R-20: a table-driven test over every public operation procedure from
    contracts/db-routines.md (12 [Core], including `sp_adjust_fine`, + `sp_expire_cards`) calling with (a) an account
    lacking the permission and (b) an inactive account holding it; both → `FORBIDDEN` and no
    rows changed;
  - R-26: `$DB_USER` INSERT/UPDATE/DELETE on each of the 11 protected tables → 1142.

### Implementation for User Story 5

- [X] T069 [US5] Audit every procedure migration from T036–T066 (including `sp_adjust_fine`): the permission check must be
  the first statement after parameter validation and before `START TRANSACTION`, using the
  exact permission codes in contracts/db-routines.md. Fix any gap in a new custom migration
  `us5_permission_fixes` (`DROP PROCEDURE` + `CREATE PROCEDURE`), or confirm that none is
  needed in the test output.
- [X] T070 [US5] Run `pnpm test:db -- us5` until green.

**Checkpoint**: Authorization is enforced inside the database for every operation.

---

## Phase 8: User Story 6 — ERD and data dictionary for the report (Priority: P3)

**Goal**: The Chen conceptual ERD, the relational diagram generated from the live schema, the
mapping table and the data dictionary, all consistent with the migrations.

**Independent Test**: A reviewer follows the Chen ERD → `mapping.md` → `relational.mmd` → data
dictionary. The ERD sync test shows 0 differences.

### Tests for User Story 6 ⚠️

- [X] T071 [P] [US6] Create `tests/db/us6-erd-sync.test.ts` covering:
  - US6-4 SC-001: run the generator from T073 against `${DB_NAME}_test`; the result must equal the
    committed `docs/erd/relational.mmd` byte for byte;
  - US6-3: every relation named in `docs/erd/mapping.md` exists in `information_schema.TABLES`,
    and every table appears in the mapping;
  - US6-1: every entity in data-model.md "Conceptual model" appears in
    `docs/erd/conceptual.puml`.

### Implementation for User Story 6

- [X] T072 [P] [US6] Write `docs/erd/conceptual.puml` (`@startchen`) from data-model.md
  "Conceptual model":
  - all 20 entity types with their key attributes (underlined) and notable attributes;
  - the BOOK multi-valued attribute `identifiers`;
  - every relationship diamond with its (min,max) cardinalities, including attributes on
    WRITTEN_BY (order) and SETTLES (amount);
  - [Ext] entities marked with a note.

  If S0 chose draw.io, write `docs/erd/conceptual.drawio` instead.
- [X] T073 [P] [US6] Create `scripts/erd/relational.ts`. It reads `information_schema.COLUMNS`,
  `KEY_COLUMN_USAGE`, `TABLE_CONSTRAINTS` and `REFERENTIAL_CONSTRAINTS` for a schema
  (`--schema`, default `$DB_NAME`) and writes a deterministic Mermaid `erDiagram` to
  `docs/erd/relational.mmd`:
  - tables sorted by name, columns in ordinal order;
  - `PK`/`FK`/`UK` markers;
  - relationship cardinality from FK nullability and uniqueness (`||--o{`, `|o--o{`,
    `||--o|`).
- [X] T074 [US6] Run `pnpm erd:relational` against a freshly migrated schema and commit
  `docs/erd/relational.mmd`.
- [X] T075 [P] [US6] Write `docs/erd/mapping.md`, a table with the columns: ERD element (entity
  / relationship / multi-valued attribute) → relation(s) → key/FK columns → rule applied
  (1:N → FK on the N side, M:N → junction, multi-valued → separate relation). Build it from
  data-model.md "Relationship types", and add a section "Technical additions" listing the
  generated columns, the timestamps and the snapshot columns.
- [X] T076 [P] [US6] Create `docs/erd/predicates.yaml`, with one predicate (tân từ) per table
  in Vietnamese and English, taken from data-model.md "Tables" (the italic sentence per table).
- [X] T077 [US6] Create `scripts/db/dictionary.ts`. It merges `information_schema` (columns,
  types, nullability, defaults, generated expressions, PK/UK/FK, CHECK clauses from
  `CHECK_CONSTRAINTS`) with `docs/erd/predicates.yaml` into `docs/data-dictionary.md`: one
  section per table with its predicate, a column table and a constraints list. Run it and
  commit the output.
- [X] T078 [US6] Create `scripts/erd/render.sh`. It uses the `plantuml/plantuml` Docker image
  to render `conceptual.puml` to `docs/report/erd-conceptual.svg`/`.png`, and uses
  `npx -y @mermaid-js/mermaid-cli` (or the `minlag/mermaid-cli` Docker image) to render
  `relational.mmd` to `docs/report/erd-relational.svg`/`.png`. Run it and commit the images.
- [X] T079 [US6] Run `pnpm test:db -- us6` until green.

**Checkpoint**: All six stories are proven; the ERD matches the schema.

---

## Phase 9: Seed data, report artifacts and Core demo gate (Polish)

**Purpose**: FR-025/025a/025b sample data, report exports, backup/restore, and the end-to-end
quickstart run.

- [X] T080 [P] Create `scripts/seed/fetch-google-books.ts` (one-off; needs
  `GOOGLE_BOOKS_API_KEY`). It reads `data/seed/isbn-list.txt` (40 ISBNs or `intitle:` queries
  chosen by the team), calls `GET https://www.googleapis.com/books/v1/volumes?q=isbn:<isbn>`,
  then `volumes/{id}`, and writes `data/seed/books.google.json` in the format of
  contracts/seed-data-format.md with `reviewed: false`, `library: null` and the raw volume.
  Never overwrite an existing file without `--force`.
- [ ] T081 Run T080 once, then review `data/seed/books.google.json` by hand:
  - check that each record is the right edition, and set `reviewed: true`;
  - fill `library` (classification code, replacement cost, 1–4 copies with unique barcodes
    `B0001…`), so that the total is at least 60 copies with some multi-copy books;
  - mark distinct editions that share identifiers with `distinctEditionOf`.

  Commit the file together with `data/seed/isbn-list.txt`.
- [X] T082 [P] Write `data/seed/books.manual.json` with at least 5 books: one without
  identifiers, one without `coverUrl`, one with 3 authors and 3 categories, and two editions
  sharing a title. Write `data/seed/people.json`: 1 admin, 2 librarians, and at least 20
  readers across STUDENT/LECTURER/EXTERNAL, some linked to accounts (fixed UUIDs).
- [X] T083 Create `scripts/seed/seed.ts`, which runs against `DB_NAME` (or `--test`) as the app
  account. It refuses to run if the schema has any non-reference rows, unless `--reset` is
  passed; `--reset` first runs the owner-side truncate from `tests/helpers/fixtures.ts`
  `truncateAll()` (FR-025a determinism).
  1. Validate the JSON files against contracts/seed-data-format.md: fail on duplicate
     `(provider, externalId)`, and on unconfirmed shared identifiers.
  2. Insert publishers, authors, categories, books, identifiers, external refs, accounts,
     user_roles and readers directly.
  3. Call `sp_register_copy` for every copy.
  4. Run the time-ordered scenario script with explicit `vn(...)` times through
     `callProcedure`:
     - create the D1 policy versions from research R13, and the STUDENT P2 from 2026-10-01;
     - issue cards (one set to expire);
     - loans on time, overdue, renewed (successful and failed), damaged, lost and late-and-lost;
     - one loan with several items and a reader with several loans;
     - the US2-10 boundary checkout;
     - partial payment across two fines;
     - US4-14 (a fine assessed in September and paid in October);
     - `sp_expire_cards`.
  5. Finish with `scripts/db/check.ts`.

  Each scenario step logs the FR-025 case it covers.
- [X] T084 Run `pnpm db:migrate && pnpm db:seed && pnpm db:check && pnpm db:objects` on a fresh
  volume (`docker compose down -v && pnpm db:up`). Verify SC-004 counts (≥ 30 books, ≥ 60
  copies, ≥ 20 readers, 3 reader types) and the `v_report_copy_status` totals.
- [X] T085 [P] Create `scripts/db/report.ts`. It calls `sp_report_rollforward` for each
  `--month YYYY-MM` (local month converted to UTC bounds) and `sp_report_cumulative` at each
  month end, prints per-reader and total tables, and exits 1 if the identity or the
  roll-forward fails (SC-006).
- [X] T086 [P] Create `scripts/db/ddl.ts`. It runs `docker compose exec -T -e
  MYSQL_PWD=<MYSQL_ROOT_PASSWORD> db mysqldump --no-data --routines --triggers --events
  --skip-comments -u root <DB_NAME>` and writes `docs/report/ddl.sql`. The values
  come from `dbConfig('owner')`; the password goes in `MYSQL_PWD`, never on the command line
  (constitution: secrets).
- [X] T087 [P] Create `scripts/db/explain.ts`. It runs `EXPLAIN FORMAT=TREE` for each
  `v_report_*` view query and for the eligibility queries used in `sp_checkout`, and writes
  them to `docs/report/explain/<name>.txt`. Add missing indexes (e.g. `loan_items(borrowed_at)`
  for `v_report_popular_books`) in a custom migration `report_indexes` if a plan shows a full
  scan.
- [X] T088 [P] Create `scripts/db/backup.ts` and `scripts/db/restore.ts`:
  - backup: `mysqldump --single-transaction --routines --triggers --events` of `DB_NAME` to
    `backups/<DB_NAME>-<timestamp>.sql`, with the password passed via `MYSQL_PWD` as in the
    DDL export;
  - restore: `--into <schema>` (default `<DB_NAME>_restore`) creates the schema, loads the dump,
    runs `scripts/db/grants.ts --schema <schema>`, then `check.ts --schema <schema>`.

  Add `backups/` to `.gitignore`.
- [X] T089 Rehearse backup and restore into `${DB_NAME}_restore` and record the commands and
  output in `docs/report/backup-restore.md` (constitution: backup/restore rehearsed).
- [X] T090 Run `pnpm lint && pnpm typecheck` and fix issues in `scripts/`, `tests/` and
  `src/lib/db/`.
- [X] T091 **Core demo gate**: on a fresh clone with an empty volume, run quickstart.md
  §3–§9 end to end, including the manual demo in §9. Check off SC-001…SC-008 in
  `docs/report/acceptance.md`, citing the test names per Rule Enforcement Matrix row (grep test
  titles for `R-`). Do not start Phase 10 until this passes.

---

## Phase 10: Extensions [Ext] (only after the Core demo gate)

**Purpose**: Reservations and holds (US3 Ext scenarios), the only Ext item (D12).

### Reservations and holds (US3 [Ext])

- [X] T092 [P] [US3] Create `tests/db/us3-reservations.test.ts` (R-14e, R-14f, R-14g) covering:
  - US3-7 (a return promotes R1 → `ready`, copy `on_hold`);
  - US3-8 (hold expiry passes to R2, or releases to `available`);
  - US3-9 (only the holder can borrow; the holder's checkout → `fulfilled`);
  - US3-14 R-14a/g (duplicate reservation → 1062/`DUPLICATE`; reserve with an available copy,
    or while holding a copy of the book → `VALIDATION`);
  - US3-15 (a revoked-card head is cancelled `ineligible_at_promotion`; a debt head gets a hold,
    then expires);
  - US3-6 [Ext] (renewal rejected with `reserved`);
  - I-2 and I-3 views empty.
- [X] T093 [P] [US3] Create the concurrency tests
  `tests/concurrency/ct-09-holder-vs-expiry.test.ts`,
  `tests/concurrency/ct-10-return-vs-cancel.test.ts`,
  `tests/concurrency/ct-11-return-vs-reserve.test.ts` and
  `tests/concurrency/ct-12-renew-vs-reserve.test.ts` (CT-9…CT-12), each with `repeat20`.
- [X] T094 [US3] Custom migration `ext_reservation_trigger`: `trg_reservations_bu` allows only
  `waiting→ready|cancelled` and `ready→fulfilled|expired|cancelled`; anything else raises
  `INVALID_TRANSITION`.
- [X] T095 [US3] Custom migration `ext_promote_queue`: `sp__promote_queue(p_copy_id,
  p_actor_user_id, p_now)`, not granted, implementing FR-014b.
  - Lock the book's `waiting` reservations `ORDER BY requested_at, id FOR UPDATE`.
  - Walk them: cancel hard-ineligible readers (reader not `active`, or no card with
    `expires_at > p_now`) with `close_reason='ineligible_at_promotion'`,
    `closed_by_kind='system'`, `closed_at=p_now`.
  - Set the first remaining reservation to `ready`, with `assigned_copy_id`, `ready_at=p_now`
    and `hold_expires_at = p_now + INTERVAL 3 DAY` (D4), and set the copy to `on_hold`.
  - If none remains, set the copy to `available`.

  Re-create `sp_register_copy`, `sp_change_copy_status`, `sp_return_item` and `sp_checkout`
  (`DROP` + `CREATE`) so the `[Ext]` extension points call it or accept holds.
- [X] T096 [US3] Custom migration `ext_reservation_procedures`:
  - `sp_reserve(p_actor_user_id, p_now, p_reader_id, p_book_id, OUT p_reservation_id)`:
    permission `reservation.manage`, or the actor is the reader's account; lock reader → book →
    copies `FOR SHARE`; FR-014a checks.
  - `sp_cancel_reservation(p_actor_user_id, p_now, p_reservation_id, p_reason)`: lock reader →
    book → copy (if ready) → reservations; promote if it was `ready`.
  - `sp__expire_holds_batch(p_now, OUT p_count)` (not granted): a cursor over `ready`
    reservations with `hold_expires_at <= p_now` ordered by `book_id, id`, with one transaction
    per row (lock book → copy → queue, re-check, `expired` with `closed_by_kind='system'`,
    `sp__promote_queue`).
  - `sp_expire_holds(p_actor_user_id, p_now, OUT p_count)`: checks `reservation.manage`, then
    calls the helper.
  - Update `sp_renew` for the `reserved` rejection. (Already present since `us3_renew`: a `FOR SHARE`
    read of the book's waiting reservations after the book lock; covered by US3-6 [Ext] and CT-12.)
- [X] T097 [US3] Custom migration `ext_hold_expiry_event`: `CREATE EVENT ev_expire_holds ON
  SCHEDULE EVERY 15 MINUTE DO CALL sp__expire_holds_batch(UTC_TIMESTAMP(3), @expired_count)`
  (FR-014c). Add
  to `tests/db/us3-reservations.test.ts` a check that the event exists and is `ENABLED` in
  `information_schema.EVENTS`, and that calling `sp__expire_holds_batch` directly as the app
  account is denied (1370).
- [X] T098 [US3] Run `pnpm test:db -- us3-reservations` and
  `pnpm test:concurrency -- --ext ct-09 ct-10 ct-11 ct-12` until green. Re-run the full Core
  suite to confirm there are no regressions.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Phase 1; T010 (spike result) blocks T019+. Blocks all
  stories.
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 4)**: after Phase 2; independent of US1 (its tests insert copies via fixtures
  only where needed).
- **US3 (Phase 5)**: needs US1 (`sp_register_copy`, copy trigger) and US2 (cards, policy
  procedures).
- **US4 (Phase 6)**: needs US3 (fines are produced by return/lost).
- **US5 (Phase 7)**: needs US1–US4 procedures to exist (it audits them all).
- **US6 (Phase 8)**: T072, T075 and T076 can start right after Phase 2. T074, T077 and T078
  need the final Core schema (after Phase 6). T071 needs T073.
- **Phase 9**: needs US1–US6. T080–T082 (data files) can start any time after Phase 2.
- **Phase 10 (Ext)**: only after T091 passes.

### Story completion order

Phase 2 → US1 ∥ US2 → US3 → US4 → US5 → (US6 finalize) → Phase 9 gate → Ext.

### Within each story

Tests first (they must fail) → triggers → procedures → run until green. Migrations are
sequential within a story because drizzle-kit numbers them in creation order.

---

## Parallel Execution Examples

- **Phase 1**: T002, T003, T004, T005 and T007 together after T001; then T006 and T008 (they
  use `src/lib/db/config.ts` from T004).
- **Phase 2**: T012–T018 (helpers) together; T019–T023 (schema files) together; then T024 → T025
  → T026 → T027 → T028 in order (one migration history); T029–T032 together.
- **US1**: T033 ∥ T034, then T035 → T036.
- **US2**: T038 ∥ T039 ∥ T040, then T041 → T042 → T043. US2 can run in parallel with US1 by a
  second teammate (different files, but coordinate migration generation order).
- **US3**: T045 ∥ T046 ∥ T047 ∥ T048 ∥ T049 ∥ T050, then T051 → T052 → T053 → T054 → T055.
- **US4**: T057 ∥ T058 ∥ T059 ∥ T060 ∥ T064 ∥ T065, then T061 → T062 → T063 → T066, then T067.
- **US6**: T072 ∥ T075 ∥ T076 early; T073 ∥ T071.
- **Phase 9**: T080 ∥ T082 ∥ T085 ∥ T086 ∥ T087 ∥ T088.

Note: two people generating custom migrations at the same time can collide on migration order.
Assign one person to generate migrations, or rebase and regenerate before merging.

---

## Implementation Strategy

### MVP first

1. Phase 1 + Phase 2 (including the spike gate T010).
2. US1 → **stop and validate**: catalog and copy lifecycle proven in the database. This is the
   smallest demonstrable slice: schema + a trigger + two procedures + tests.

### Incremental delivery to the Core demo gate

3. US2 → US3 (the core technical claim: concurrency) → US4 (money) → US5 (authorization audit).
4. US6 diagrams and dictionary, then Phase 9 seed and exports.
5. T091 Core demo gate: the project is complete and presentable at this point.

### Extensions

6. Phase 10: reservations and holds, the only Ext item (D12), shipped only with its matrix
   rows and CTs green.

Out of scope for this feature ([API], later): Supabase token verification, the Google Books
import/refresh tool beyond the one-off fetch script, online preview, any UI.
