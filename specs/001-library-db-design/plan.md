# Implementation Plan: Core Library Data Model and ERD

**Branch**: `001-library-db-design` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-library-db-design/spec.md` (revision 5,
clarified 2026-09-24)

## Summary

Deliver the library database and its ERD. There is no API, UI or Supabase integration in this
feature. The deliverables are:

- **Diagrams and dictionary**: a conceptual ERD in Chen notation, a crow's-foot relational
  diagram generated from the live schema, an ERD-to-relational mapping table, and a data
  dictionary with predicates (tân từ).
- **Migrations**: for MySQL 8.4 in a local Docker container, covering 27 tables with PK, FK,
  CHECK and generated-column unique keys, plus 17 guard triggers, 8 stored functions, 12 [Core]
  operation procedures (including `sp_adjust_fine`), 2 report procedures, a cursor batch
  (`sp_expire_cards`), and invariant and report views.
- **Configuration**: no fixed names. Database names, accounts, passwords, host, port and
  MySQL version come from `.env.local`, with generic defaults in `.env.example` (spec FR-030).
- **Privileges**: an application account that can change circulation and money data only by
  calling the procedures.
- **Seed data**: loaded from reviewed Google Books files, with the transaction history created
  through the procedures.
- **Database-level tests**: functions, acceptance scenarios, bypass tests, and concurrency tests
  that use a lock "gate" session.

Work runs **spike → Core schema → Core routines → Core verification → seed and report artifacts
(Core demo gate) → Ext**. The team has a complete, presentable database project before any
extension starts.

## Technical Context

**Language/Version**:
- **Database**: MySQL 8.4 SQL (DDL, triggers, stored functions/procedures, cursors, views).
- **Tooling**: TypeScript 5 on Node 24 for migrations, seed, diagram generation and tests.

**Primary Dependencies**:
- **Database**: Docker image pinned to `mysql:8.4`.
- **Installed**: `drizzle-orm` / `drizzle-kit` 1.0.0-rc.4 (schema, migrations), `mysql2` 3.24,
  `tsx`.
- **To add**: `vitest` (dev), and the `plantuml/plantuml` Docker image for the Chen ERD.
- **Not needed yet**: Next.js runtime code; Supabase (deferred to the API feature).

**Storage**: MySQL 8.4 LTS (InnoDB, utf8mb4, `default_time_zone = +00:00`) in Docker with a named
volume. Schemas `$DB_NAME` (dev/demo) and `${DB_NAME}_test` (tests).

**Testing**: Vitest + `mysql2` straight to the test schema.
- Acceptance and bypass tests run sequentially.
- Concurrency tests use a gate session and `performance_schema.data_lock_waits` to make sure both
  calls really contend (research R11).
- The invariant views run after each test.

**Target Platform**: MySQL 8.4 container on developer machines (macOS/Windows/Linux via Docker).

**Project Type**: Database design within the existing Next.js repository (migrations, SQL
routines, scripts, docs). The later API feature will call the routines.

**Performance Goals**:
- Every operation procedure completes in < 200 ms p50 and < 1 s p95 on the seed data, including
  during the concurrency tests.
- Report views and procedures run in < 2 s on the seed data, with EXPLAIN showing the planned
  indexes.

**Constraints**:
- Procedures take `p_now` and never use `NOW()` for decisions.
- Lock wait timeout is 5 s; callers retry only errors 1213 and 1205, up to 3 times.
- The `$DB_USER` account has no direct DML on circulation or money tables.
- The relational diagram must match the live schema with 0 differences.

**Scale/Scope**:
- **Seed data**: about 50 books, 100 copies, 30 readers and a few hundred loans.
- **Database objects**: 27 tables, 17 triggers, 8 functions, 12 + 2 [Core] procedures, 2 cursor
  procedures (1 Core, 1 Ext), 2 Ext procedures + 2 Ext internal helpers + 1 Ext event, 9
  invariant views and 4 report views.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / Section | Pre-research | Post-design | Evidence |
| --- | --- | --- | --- |
| I. MySQL is the single source of truth | PASS | PASS | All facts in MySQL; Google data only in `book_external_refs` and committed seed files; copies created by `sp_register_copy` (FR-004a, FR-025a) |
| II. Schema-first, constraint-enforced | PASS | PASS | Drizzle schema + generated migrations; custom SQL migrations for triggers/routines/views; versioned grants script (`scripts/db/grants.ts`); BIGINT PKs, composite junction PKs; DDL export (research R2) |
| III. Transactional circulation integrity (NON-NEGOTIABLE) | PASS | PASS | Each operation is one stored-procedure transaction with `FOR UPDATE`/`FOR SHARE` in lock order, full rollback on error, callers retry only 1213/1205; CT-1…CT-8 |
| IV. Immutable history & derived money | PASS | PASS | Snapshot columns + triggers; append-only money tables; derived balances via `fn_*`; DATETIME(3) UTC, BIGINT VND |
| V. Server-verified identity & RBAC | PASS | PASS (token part deferred) | RBAC tables + `fn_has_permission` in every procedure; `app_users.supabase_user_id` UQ; token verification is [API] (spec Clarifications) |
| VI. Curated external metadata | PASS | PASS | Reviewed, committed seed files; UQ(provider, external_id); no ebook content; import workflow is [API] |
| VII. Academic traceability & scoped simplicity | PASS | PASS | Tiers [Core]/[Ext]/[API]; each routine maps to FRs; cursors only in batch jobs (research R8) |
| Tech & data constraints: required indexes | PASS | PASS | `loan_items(copy_id, status)`, `loan_items(status, due_at)`, `loans(reader_id, borrowed_at)`, `book_copies(book_id, circulation_status)`, `reservations(book_id, status, requested_at, id)`, UQ `fines(loan_item_id, fine_type)`, identifier and title/author indexes (data-model) |
| Tech & data constraints: business rules in stored procedures invoked by the server; app DB account without direct writes to circulation/money tables | PASS | PASS | FR-026 procedures; `root` / `$DB_USER` split and grants migration (research R6, R-26) |
| Tech & data constraints: Docker MySQL 8.4 (≥ 8.0.16) | PASS | PASS | `docker-compose.yml` with `mysql:8.4` (research R1) |
| Tech & data constraints: no hard-coded names or secrets; minimal, unprefixed env set (v1.2.1) | PASS | PASS | All names from env with generic defaults; only `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD` (+ optional `GOOGLE_BOOKS_API_KEY`); test schema derived as `${DB_NAME}_test`, image pinned `mysql:8.4`; migrations unqualified and account-free; grants script reads `DB_USER` (research R1 "Environment variables", R6) |
| Workflow: relational diagram matches schema; Chen ERD + mapping kept current | PASS | PASS | Generated `relational.mmd` + ERD sync test; `conceptual.puml`, `mapping.md` (research R10) |
| Tech & data constraints: backup/restore | PASS | PASS | Phase E: `mysqldump` backup, restore, `db:check` |
| Workflow gates | PASS | PASS | Clean migrate on an empty container, lint and type check for scripts, DB tests, report checks (Phase D/E exits) |

Gate result: PASS against constitution v1.2.1 (amended 2026-09-24); no deviations.

## Project Structure

### Documentation (this feature)

```text
specs/001-library-db-design/
├── spec.md
├── plan.md                  # this file
├── research.md              # Phase 0
├── data-model.md            # Phase 1: conceptual model, tables, triggers, privileges
├── quickstart.md            # Phase 1: run-and-check guide
├── contracts/
│   ├── db-routines.md       # functions, procedures, cursors, error keys
│   ├── reports-and-invariants.md
│   └── seed-data-format.md
├── checklists/requirements.md
└── tasks.md                 # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
docker-compose.yml                   # service `db`, image mysql:8.4, volume `mysql-data`;
                                     # maps DB_NAME/DB_USER/DB_PASSWORD to MYSQL_* image vars
docker/mysql/
└── conf.d/mysql.cnf                 # time zone, trust flag, event scheduler, charset
.env.example                         # 5 required variables + 1 optional (FR-030)

src/lib/db/
├── config.ts                        # builds connection settings from env; fails fast if missing
├── grants.ts                        # declarative grant list for the app account
├── call-procedure.ts                # fresh pool connection per call, retry 1213/1205
├── index.ts                         # existing app connection (kept for the later API)
├── tables.ts                        # barrel of all tables for app code (outside schema/, see research)
└── schema/                          # Drizzle tables, split by area
    ├── catalog.ts
    ├── people.ts                    # app_users, roles, permissions, readers, cards
    ├── policies.ts
    ├── circulation.ts               # loans, loan_items, renewals, reservations
    └── fines.ts

drizzle/                             # generated + custom migrations, applied in order:
                                     # tables → reference data → triggers → functions →
                                     # procedures → views (no account names inside)

scripts/
├── db/                              # migrate, reset-test, check, objects, spike,
│                                    # report, ddl, explain, backup, restore, dictionary
├── erd/                             # relational.ts (information_schema → Mermaid), render.sh
└── seed/                            # fetch-google-books.ts (one-off), seed.ts
data/seed/                           # books.google.json, books.manual.json, people.json

tests/
├── helpers/                         # connections, gate session, lock-wait polling, error-key matcher
├── db/                              # functions, US1…US6 acceptance, bypass, erd-sync
└── concurrency/                     # CT-1…CT-13

docs/
├── erd/                             # conceptual.puml (Chen), relational.mmd (generated), mapping.md
├── data-dictionary.md               # generated + predicates
└── report/                          # rendered diagrams, ddl.sql, explain/
```

**Structure Decision**: The database work lives in the existing repository.
- `drizzle.config.ts` changes `schema` to `./src/lib/db/schema`; `out` stays `./drizzle`.
- No `src/server` or UI code in this feature.
- `src/lib/db/index.ts` stays as the connection the later API will use to call the procedures.
- The migration runner, grants script, seed and tests build their connections from the
  `.env.local` variables through `src/lib/db/config.ts`; no URL, schema or account name is
  written in code.

## Implementation Order (Core first)

### Phase A — Spike S0 (blocking)

- **Setup**: `docker-compose.yml`, MySQL config file, `.env.example`, `src/lib/db/config.ts`.
- **`scripts/db/spike.ts`** proves every "Verify in S0" item in research.md in a scratch schema:
  - config and privileges;
  - CHECK and generated-column UNIQUE;
  - a trigger `SIGNAL`;
  - a procedure with `JSON_TABLE` + `FOR UPDATE` + EXIT HANDLER + `RESIGNAL`;
  - a deadlock inside a procedure;
  - a per-row-commit cursor;
  - a DETERMINISTIC date function;
  - Drizzle rc.4 CHECK/generated output and multi-line routine migrations;
  - lock-wait visibility;
  - PlantUML `@startchen`.

**Exit**: all PASS, or a recorded fallback for each failure.

### Phase B — Core schema

1. Drizzle tables for all 27 tables (data-model.md), including the reservation and adjustment
   tables (Core schema, Ext workflow). Generate the migration.
2. A custom migration that inserts reference data: material type, reader types, roles,
   permissions, role_permissions.
3. A custom migration with the 17 triggers.
4. A custom migration with the 8 functions.

**Exit**: `db:migrate` succeeds on an empty container; B-1, B-3 (as owner), B-4 and B-5 pass;
function tests pass.

### Phase C — Core routines

In dependency order, each with its acceptance tests written first:

1. `sp_create_policy_version`, `sp_close_policy_version` (US2-4…8, US2-10).
2. `sp_issue_card`, `sp_set_card_status`, `sp_expire_cards` (cursor) (US2-2, 3, 7, 9).
3. `sp_register_copy`, `sp_change_copy_status` (US1-2, 3, 9; US3-10).
4. `sp_checkout` (US3-1, 3, 12, 16; US2-10).
5. `sp__assess_fines`, `sp_return_item`, `sp_declare_lost` (US3-13; US4-1…4, 9, 10).
6. `sp_renew` (US3-5, 6).
7. `sp_record_payment`, `sp_adjust_fine` (US4-5…8, 11…13).
8. `sp_report_cumulative`, `sp_report_rollforward`, the `v_report_*` views and the `v_inv_*`
   views (US4-14).
9. The grants script `scripts/db/grants.ts` (R-26), then B-2.

**Exit**: every [Core] acceptance scenario that does not carry an [API] tag passes as
`$DB_USER`.

### Phase D — Core verification

- CT-1…CT-8 and CT-13, 20 runs each, with the invariant views after each run; RS-1
  (reservation schema constraints).
- Map every [Core] matrix row to a named test.
- Timing check against the performance goals.

**Exit**: SC-002, SC-003 and SC-005 met for [Core].

### Phase E — Seed, ERD and report artifacts (Core demo gate)

1. Run `fetch-google-books.ts` once; the team reviews and commits `books.google.json`. Write
   `books.manual.json` and `people.json` (contracts/seed-data-format.md).
2. `seed.ts` scenario script covering FR-025 [Core] (D1 values in research R13); then
   `db:check` and `db:report` (SC-004, SC-006).
3. Chen ERD `docs/erd/conceptual.puml` from data-model.md "Conceptual model";
   `erd:relational`; `mapping.md`; the ERD sync test (US6-1…4, SC-001).
4. `db:dictionary`, `db:ddl`, `db:explain`.
5. Backup and restore rehearsal.

**Exit (Core demo gate)**: quickstart §3–§9 runs end to end on a fresh clone with an empty
Docker volume.

### Phase F — Extensions (after the gate, D12 order)

1. **Reservations** (the only Ext item): `sp_reserve`, `sp_cancel_reservation`,
   `sp__promote_queue` wired into return, checkout and copy maintenance; `sp_expire_holds`
   (cursor) and the `ev_expire_holds` event every 15 minutes; I-2/I-3 views active;
   CT-9…CT-12; US3-7…9, 14, 15.

[API] items (token verification, import tool, preview) belong to the later API feature, not here.

## Risks

| Risk | Mitigation |
| --- | --- |
| Drizzle rc.4 mishandles CHECK, generated columns or routine statements | Spike S0; move the affected DDL to custom SQL migrations |
| PlantUML image lacks `@startchen` | Spike S0; fall back to draw.io for the Chen diagram only |
| A deadlock surfaces from a procedure in a CT run | Callers retry 1213/1205; the CT asserts final invariants, not a zero-retry run |
| Procedures grow large and hard to test | One procedure per operation; shared maths in `fn_*`; shared steps in `sp__*` helpers; tests per scenario |
| Docker not installed on some machines | Quickstart §1 prerequisite; the spike's first check fails fast |
| Timeline pressure | Stop at the Phase E demo gate; Ext items are independent |

## Complexity Tracking

No constitution violations to justify (checked against v1.2.1). Earlier deviations are now
covered by the amended constitution:
- Operation procedures: Principle III and Technology & Data Constraints.
- Triggers and the owner/app privilege split: Principle II and Technology & Data Constraints.
- Status-based indexes: the required-index list.
