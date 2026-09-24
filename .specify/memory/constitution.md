<!--
Sync Impact Report
==================
Version change: (unversioned template) → 1.0.0
Bump rationale: First ratification; every placeholder replaced with project governance.

Modified principles (template placeholder → new title):
- [PRINCIPLE_1_NAME] → I. MySQL Is the Single Source of Truth
- [PRINCIPLE_2_NAME] → II. Schema-First, Constraint-Enforced Data Model
- [PRINCIPLE_3_NAME] → III. Transactional Circulation Integrity (NON-NEGOTIABLE)
- [PRINCIPLE_4_NAME] → IV. Immutable History & Derived Money
- [PRINCIPLE_5_NAME] → V. Server-Verified Identity & RBAC
Added principles:
- VI. Curated External Metadata
- VII. Academic Traceability & Scoped Simplicity
Added sections:
- Technology & Data Constraints (was [SECTION_2_NAME])
- Development Workflow & Quality Gates (was [SECTION_3_NAME])
Removed sections: none

Templates reviewed (not modified; they read the constitution at runtime):
- .specify/templates/plan-template.md — "Constitution Check" gate applies principles I–VII
- .specify/templates/spec-template.md — no change required
- .specify/templates/tasks-template.md — no change required

Follow-up TODOs (business decisions still open; see docs/library_database_research.txt §9):
- TODO(LOAN_POLICY_NUMBERS): max items, loan days, renewals, daily fee, debt block threshold,
  card validity, reservation hold window per reader_type × material_type.
- TODO(RUBRIC_CONFIRMATION): confirm with lecturer whether cursor / procedure / trigger /
  function are mandatory, the required MySQL version, and the required report count.
Source: docs/library_database_research.txt (2026-09-24)
-->
# NexusLib Constitution

## Core Principles

### I. MySQL Is the Single Source of Truth

- MySQL (InnoDB, utf8mb4) MUST be the authoritative store for catalog, physical copies,
  readers, library cards, loan policies, loans, reservations, fines, payments, reports and
  RBAC.
- External systems (Supabase Auth, Google Books) MUST NOT be treated as holding library
  facts. Only a `book_copies` row registered in MySQL can be borrowed; a Google Books search
  result never counts as inventory.
- No business record may exist only in a cache, client state or third-party service.

Rationale: the project's value is the correctness of the library data model and circulation,
not the number of external results or ebook display.

### II. Schema-First, Constraint-Enforced Data Model

- Every table MUST be declared in Drizzle schema and changed only through versioned Drizzle
  migrations; the generated SQL DDL MUST be reproducible for the report.
- Every table MUST have a `BIGINT` primary key and explicit foreign keys and indexes.
  Many-to-many relations MUST use junction tables (e.g. `book_authors`, `book_categories`,
  `user_roles`, `role_permissions`).
- Invariants MUST be enforced in the database wherever MySQL can express them: `UNIQUE`
  (barcode, card_number, `(provider, external_id)`, role/permission codes), `CHECK`
  (amounts >= 0, `due_at > borrowed_at`, `returned_at >= borrowed_at`), `NOT NULL` chosen
  deliberately. Rules MySQL cannot express (overlapping policy periods, one open loan per
  copy, one active card per reader) MUST be documented and enforced in a transaction or
  trigger, with a test proving it.
- Terminology is fixed: a *book* (đầu sách/ấn bản) is a catalogued edition; a *copy*
  (bản sao) is one physical item with a barcode. Physical condition and circulation status
  are separate attributes.

Rationale: the course grades DDL, keys, constraints and normalization; the schema must be the
evidence, not application code alone.

### III. Transactional Circulation Integrity (NON-NEGOTIABLE)

- Checkout, return, renewal, lost/damaged handling and payment allocation MUST each run in a
  single backend transaction that locks affected rows with `SELECT ... FOR UPDATE` (copy,
  loan item, reader/card as needed) before validating and writing.
- Checkout MUST validate, inside the lock: card valid and not expired, reader not blocked by
  debt, active item limit, applicable policy, and reservation queue.
- Two concurrent checkouts of the same copy MUST result in exactly one success. This MUST be
  covered by an automated concurrency test.
- Renewal MUST be rejected when the item is returned, the renewal limit is reached, or a
  pending reservation exists for the book; every renewal records `old_due_at`/`new_due_at`.

Rationale: circulation correctness under concurrency is the core technical claim of the project.

### IV. Immutable History & Derived Money

- Loan items MUST snapshot the applied policy and daily fee at checkout; editing a policy
  MUST NOT change past loans.
- Returning a copy MUST be independent of paying fines: a return closes the physical loan even
  when fines remain unpaid.
- Fines, payments and allocations MUST be append-only. Corrections MUST be recorded as
  adjustments with actor and reason; financial and loan history MUST NOT be hard-deleted or
  cascade-deleted.
- Outstanding debt MUST be derived as assessed fines minus valid allocations. Reports MUST
  distinguish fines assessed, cash actually collected, and outstanding balance.
- Duplicate late fees for the same loan item MUST be prevented by a business key.
- Timestamps MUST be `DATETIME(3)` stored in UTC; money MUST be `BIGINT` VND (đồng).

Rationale: auditable history lets every report number be recomputed from transactions.

### V. Server-Verified Identity & RBAC

- Supabase Auth owns identity, passwords, sessions and tokens. MySQL MUST NOT store passwords
  or refresh tokens.
- The backend MUST verify the Supabase access token (signature/claims via the officially
  supported method) and derive the user from the verified `sub`. A user id sent by the client
  outside the token MUST be ignored.
- `app_users.supabase_user_id` is a unique logical reference (no cross-database FK); all
  internal FKs point to `app_users.id`.
- Authorization MUST come from MySQL RBAC (`roles`, `permissions`, `user_roles`,
  `role_permissions`) checked on the server for every mutating or privileged read.
  Supabase RLS and user-editable profile data MUST NOT grant library privileges.
- `reader_type` is a borrowing-policy attribute, never a security role.
- Deleted or disabled Supabase accounts MUST mark `app_users` inactive while preserving history.

Rationale: two databases cannot share FKs, so trust must be anchored in verified tokens and
server-side checks.

### VI. Curated External Metadata

- Google Books MAY only suggest metadata. Imports MUST be librarian-reviewed (select the
  correct edition by ISBN/title/publisher/year/author) before an upsert.
- Imports MUST be idempotent via `UNIQUE(provider, external_id)`, run in a transaction, record
  `fetched_at`, and MUST NOT overwrite library-edited fields on refresh.
- Code MUST tolerate missing ISBN, cover, description, categories or viewability; ISBN is not
  assumed unique or present.
- Copies MUST be created manually by librarians with unique barcodes, never from Google data.
- Viewability/embed data is a dated snapshot; online reading is an optional bonus feature,
  shown only when access is currently permitted. Ebook content MUST NOT be stored. Google
  attribution/branding rules MUST be followed. API keys MUST stay server-side.

Rationale: external data improves sample quality but must never corrupt or define inventory.

### VII. Academic Traceability & Scoped Simplicity

- Each feature MUST state which report chapter it evidences (Ch.1 context, Ch.2
  analysis/ERD/constraints, Ch.3 DDL/data, Ch.4 procedures/triggers/security/backup/reports).
- MVP scope: a single library branch, printed books (`BOOK_PRINT`) with an extensible
  `material_types` table, reservations by book (not copy), overdue counted in calendar days,
  lost/damaged fees based on replacement cost with a reasoned override. Deviations MUST be
  justified in the plan's Complexity Tracking.
- Stored procedures, functions, triggers and cursors MUST be used only where the rubric
  requires them or they add clear value; cursors are reserved for justified batch jobs and
  MUST NOT drive checkout.
- Every assumption (policy numbers, holidays, scope) MUST be written down, not implied.

Rationale: a small, fully explained scope scores better than a broad, partially built one.

## Technology & Data Constraints

- Stack: Next.js 16 (App Router, `src/` layout) + TypeScript, pnpm workspace, Drizzle ORM and
  drizzle-kit with `mysql2`, Supabase Auth, Google Books API v1, Tailwind CSS 4. Before writing
  Next.js code, consult `node_modules/next/dist/docs/` because this version has breaking changes.
- All database access and business rules run server-side (Route Handlers, Server Actions, or
  server modules); client components never hold DB credentials or API keys.
- Required indexes at minimum: `loan_items(copy_id, returned_at)`,
  `loan_items(due_at, returned_at)`, `loans(reader_id, borrowed_at)`,
  `book_copies(book_id, circulation_status)`, `reservations(book_id, status, requested_at)`,
  `fines(loan_item_id, status)`, book identifiers, and title/author search columns. Key
  report and search queries MUST be accompanied by an `EXPLAIN` analysis.
- Sample data: roughly 30–50 reviewed Google Books titles plus manual entries, including books
  without ISBN or cover, multi-author/multi-category books, multi-copy books, two editions
  with the same title, and circulation scenarios (on time, overdue, renewal success/failure,
  damage, loss, partial payment, expired card, limit exceeded, concurrent checkout).
- Backup/restore via `mysqldump` (or equivalent) MUST be documented and rehearsed.

## Development Workflow & Quality Gates

- Work follows Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement`. Each plan MUST pass the Constitution Check against
  principles I–VII before design and again after.
- Schema changes require a migration, an updated ERD/predicate description where affected,
  and exported DDL for the report.
- Merge gates: `pnpm lint` and type check pass; migrations apply cleanly to an empty database;
  circulation transactions have tests for success, each rejection rule, and concurrency;
  report queries are verified against seeded data (e.g. available + on_loan + repair + lost =
  total copies; outstanding debt equals assessed minus allocations).
- Secrets live only in environment files excluded from git.

## Governance

- This constitution supersedes other project practices. Where a spec, plan or task conflicts
  with it, the constitution wins until amended.
- Amendments are proposed via `/speckit-constitution`, reviewed by the team, and recorded with
  a Sync Impact Report and version bump.
- Versioning: MAJOR for removing or redefining a principle; MINOR for a new principle/section
  or materially expanded guidance; PATCH for clarifications and wording.
- Every plan and code review MUST verify compliance; any deviation MUST be recorded in the
  plan's Complexity Tracking with justification and the simpler alternative rejected.
- Runtime development guidance lives in `AGENTS.md`/`CLAUDE.md`; domain research lives in
  `docs/library_database_research.txt`.

**Version**: 1.0.0 | **Ratified**: 2026-09-24 | **Last Amended**: 2026-09-24
