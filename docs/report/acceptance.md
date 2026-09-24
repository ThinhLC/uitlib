# Acceptance: Core demo gate (T091)

- **Date**: 2026-09-24
- **Feature**: `specs/001-library-db-design` (spec.md, quickstart.md §3–§9)
- **Environment**: Docker image `mysql:8.4` (server 8.4.x), fresh volume (`docker compose down -v`
  before the run).
- **Source tree**: the run used the **working tree, not a fresh clone**. The work is not yet
  committed, so a fresh-clone rerun after the commit is still required (see Open items).

## 1. Quickstart run

| § | Command | Result |
| --- | --- | --- |
| 3 | `pnpm db:up` | Container healthy on an empty volume |
| 4 | `pnpm db:spike` | 12/12 checks passed |
| 5 | `pnpm db:migrate` | 20 migrations applied. Grants: SELECT on 41 objects, write on 11 tables, EXECUTE on 23 routines |
| 5 | `pnpm db:check` | 9 invariant views, 0 violations |
| 5 | `pnpm db:objects` | 27 tables, 13 views, 16 triggers, 8 functions, 16 procedures, 0 events |
| 6 | `pnpm db:seed` | 32 books, 62 copies, 21 readers, 3 reader types, 8 accounts, 31 loan items, 7 fines; invariant suite clean |
| 6 | `pnpm db:seed` again (no `--reset`) | Refused, exit 1 |
| 6 | `pnpm db:seed -- --reset` | Identical `CHECKSUM TABLE` results: deterministic (FR-025a) |
| 6 | `pnpm db:report -- --month 2026-08 --month 2026-09 --month 2026-10` | "SC-006: cumulative identity and roll-forward hold for every reader" (totals below) |
| 7 | `pnpm test:db` | 15 files, 77 tests passed |
| 7 | `pnpm test:concurrency` | 5 files, 11 tests passed; each CT repeated 20×, invariants checked after each run |
| 7 | `pnpm test:concurrency -- --ext` | Not run (Phase 10) |
| 8 | `pnpm erd:relational`, `pnpm erd:render` | Diagrams regenerated |
| 8 | `pnpm db:dictionary` | 27 relations |
| 8 | `pnpm db:ddl` | 2555 lines |
| 8 | `pnpm db:explain` | All plans use index access, except `checkout-debt-assessed`: a table scan of `fines` on the 7-row sample. This is a cost-based choice; `fines_item_type_uq (loan_item_id, fine_type)` exists, so no `report_indexes` migration was added |
| 9 | Manual demo | See below |

**Seed data source.** `data/seed/books.google.json` has not been fetched (no API key; T081
still waits for team review). Books come from `data/seed/books.manual.json`.

**Debt report totals (VND).**

| Month | Opening | Assessed | Adjustments | Collected | Closing |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-08 | 0 | 92,000 | −30,000 | 12,000 | 50,000 |
| 2026-09 | 50,000 | 2,036,000 | 0 | 152,000 | 1,934,000 |
| 2026-10 | 1,934,000 | 0 | 0 | 24,000 | 1,910,000 |

### Seed scenarios (SC-004, FR-025)

Step labels are the `covers` strings in `scripts/seed/seed.ts`. All circulation and money rows
are written through the operation procedures with explicit times (FR-025b).

| FR-025 scenario | Seed step(s) |
| --- | --- |
| Multi-author, multi-category book; multi-copy book; two editions with the same title; books without ISBN or cover | `books.manual.json` (for example the two "Introduction to Algorithms" editions; 5 Vietnamese titles with no ISBN and no cover; 21 books with several copies) |
| On-time item | `on-time loan` (S01, M001), `on-time return` |
| Loan with several items | `loan with several items` (S02: M015, M019, M026) |
| Renewed item | `renewal (1st)`, `renewal (2nd)`, then `renewal refused: limit` (M019) |
| Overdue item, returned late | `overdue item returned late` (M026, late fine 12,000), `full payment` |
| Damaged item and an adjustment | `damaged return` (M008, 80,000), `fine adjustment` (−30,000) |
| Late-and-lost item | `late-and-lost` (M010: late 52,000 + lost 1,000,000) |
| Partial payment across two fines | `partial payment across two fines` (152,000) |
| Lost item | `lost before due` (M029, 950,000) |
| Fine assessed in one month, paid in the next (US4-14) | `late return (September fine)` (M004, 24,000 on 2026-09-20), `US4-14 paid next month` (2026-10-03) |
| Expired card | `expired card (sp_expire_cards cursor)`, `checkout refused: expired card` (`CARD_INVALID`) |
| Debt block | `checkout refused: debt` (EXTERNAL reader, `DEBT_BLOCKED`) |
| Overdue item still on loan | `overdue item (still on loan)` (M023), `renewal refused: overdue` |
| Policy change after loans exist (SC-007) | `close STUDENT P1, create P2 (SC-007)` (P1 `valid_to` = 2026-10-01 00:00 local) |
| Checkout just before a policy version ends (US2-10) | `US2-10 checkout just before P1 ends` (2026-09-30 23:59:59.900, due 10-14, P1), `US2-10 checkout under P2` (2026-10-01 00:00:00.100, due 10-08, P2) |
| Reader with several loans | `reader with several loans` (S02, L02) |
| [Ext] Reservation queue | Not in Core (Phase 10) |

### Manual demo (§9)

| Demo | Result |
| --- | --- |
| Row locking (CT-1) | Covered automatically by `tests/concurrency/ct-01-03-checkout.test.ts` › "CT-1 US3-1 R-12b: two checkouts of the same copy — exactly one wins (20 runs)" |
| Permissions (B-2) | App account `INSERT INTO loans …` → `ERROR 1142` |
| Immutable policies (B-3) | App account `UPDATE loan_policies …` → `ERROR 1142`; as `root` → SQLSTATE 45000 `POLICY_IMMUTABLE` |
| Cursor | `CALL sp_expire_cards(1, '2027-02-02 00:00:00.000', @n); SELECT @n;` → 3 |
| Backup and restore | See `docs/report/backup-restore.md`: checksums identical, 0 invariant violations on the restored schema |

### SC-008 query

```sql
SELECT r.full_name,
       li.borrowed_at,
       li.due_at,
       li.status,
       fn_reader_outstanding(r.id, '2026-10-31 00:00:00') AS owes_vnd
FROM book_copies c
JOIN loan_items li ON li.copy_id = c.id
JOIN loans l       ON l.id = li.loan_id
JOIN readers r     ON r.id = l.reader_id
WHERE c.barcode = 'M010';
```

Result: `Phạm Thu Hà`, borrowed 2026-08-01 07:00 UTC, due 2026-08-15 16:59:59.999 UTC,
status `lost`, owes 900,000.

## 2. Success criteria

- [x] **SC-001**: every Key Entity appears in the Chen ERD, mapping, relational diagram and
  data dictionary; relational diagram has 0 differences from the migrated schema.
  Evidence: `tests/db/us6-erd-sync.test.ts` › "US6-4 SC-001: the committed relational diagram
  equals the one generated from the migrated schema", "US6-3: every relation in mapping.md
  exists, and every table is mapped", "US6-1: every entity of data-model.md "Conceptual model"
  is in the Chen ERD", "FR-024: every table has a Vietnamese and an English predicate";
  `pnpm erd:relational`, `pnpm erd:render`, `pnpm db:dictionary` (27 relations).
- [x] **SC-002**: every [Core] and "Core schema" matrix row has a passing rejection test.
  Evidence: section 3; no GAP. [Ext] rows are Phase 10.
- [x] **SC-003**: CT-1…CT-8, CT-13 and B-1…B-5 each pass 20/20 runs.
  CT part: every CT test runs 20× with invariants checked after each run (`pnpm
  test:concurrency`, 11 tests passed). B part: `pnpm test:bypass` runs the five bypass tests
  (titles matching `B-1`…`B-5`) 20 times: 20/20 runs, 5/5 tests passed in each.
- [x] **SC-004**: ≥ 30 books, ≥ 60 copies, ≥ 20 readers across ≥ 3 reader types, every [Core]
  FR-025 scenario. Evidence: `pnpm db:seed` (32 / 62 / 21 / 3) and the seed scenario table above.
- [x] **SC-005**: zero invariant violations on the sample data and after every acceptance and
  concurrency test. Evidence: `pnpm db:seed` / `pnpm db:check` on the sample data;
  `tests/helpers/invariants-after-each.ts` (Vitest `setupFiles`) runs the invariant suite after
  every test in `tests/db` and `tests/concurrency` (77 + 11 passed). Three constraint probes that
  insert rows directly as the owner opt out with `rawFixture()` and the schema is emptied after
  them: "US2-6 R-09d", "US2-8 R-09e", "R-14a/b/c/d".
- [x] **SC-006**: cumulative net assessed = collected + outstanding for every reader and month;
  roll-forward holds; 0 discrepancies. Evidence: `pnpm db:report` output and totals above;
  `tests/db/us4-reports.test.ts` › "SC-006: cumulative identity and monthly roll-forward hold for
  every reader", "US4-14: a fine assessed in September and paid in October".
- [x] **SC-007**: closing a policy version and creating a new one changes 0 existing loan items;
  re-running an import creates 0 duplicates. Evidence: seed step `close STUDENT P1, create P2
  (SC-007)` with invariants clean afterwards; `tests/db/us3-return-renew.test.ts` › "US3-4
  R-11a: a loan item keeps its snapshot after the policy is replaced";
  `tests/db/us1-catalog.test.ts` › "US1-6 R-03: a second external reference with the same
  provider and id is rejected (1062)". The Google Books import itself has not been run (T081).
- [x] **SC-008**: a reviewer can answer "who borrowed copy X, when was it due, what do they
  still owe?" in under 5 minutes. Demonstrated by the single query above. A timed attempt by a
  reviewer unfamiliar with the project is still to be done by the team.

## 3. Rule Enforcement Matrix coverage

Titles are quoted from `it(`/`describe(` strings. Paths are under `tests/`.

| ID | Tier | Mechanism | Test(s) | Status |
| --- | --- | --- | --- | --- |
| R-01 | Core | DB: UNIQUE(barcode) | `db/us1-catalog.test.ts` › "US1-3 R-01: a duplicate barcode is rejected (1062)" | Covered |
| R-02 | Core | DB: FKs ON DELETE RESTRICT | `db/us1-catalog.test.ts` › "FR-021 R-02: a book with copies cannot be deleted (1451)"; `db/us5-rbac.test.ts` › "US5-4: a deactivated librarian keeps its 20 loans and can no longer check out" | Covered |
| R-03 | Core | DB: UNIQUE(provider, external_id) | `db/us1-catalog.test.ts` › "US1-6 R-03: a second external reference with the same provider and id is rejected (1062)" | Covered |
| R-06a | Core | DB: CHECK on copy | `db/us1-catalog.test.ts` › "US1-9 R-06a: a damaged copy cannot be available (3819)" | Covered |
| R-06b | Core | Trigger | `db/us1-copy-lifecycle.test.ts` › "B-5 R-06b: illegal transitions are rejected by procedure and by trigger"; "FR-006a: allowed transitions through sp_change_copy_status" | Covered |
| R-08a | Core | DB: UNIQUE(card_number) | `db/us2-cards.test.ts` › "US2-9 R-08a: a duplicate card number is rejected (1062)" | Covered |
| R-08b | Core | DB: CHECK | `db/us2-cards.test.ts` › "US2-7 R-08b: expiry not after issue is rejected (VALIDATION via procedure, 3819 via CHECK)" | Covered |
| R-08c | Core | DB-derived unique | `db/us2-cards.test.ts` › "US2-2 R-08c: a second active card is rejected; after revoking, a new one is accepted"; `concurrency/ct-08-cards-policies.test.ts` › "CT-8 US2-3 R-08c R-09a" › "two active cards for one reader: exactly one succeeds (20 runs)" | Covered |
| R-09a | Core | Procedure (+ trigger guard) | `db/us2-policies.test.ts` › "US2-4 R-09a/b: overlapping versions are rejected; close + create at the same instant works"; `concurrency/ct-08-cards-policies.test.ts` › "two overlapping versions for one pair: exactly one succeeds (20 runs)" | Covered |
| R-09b | Core | DB: CHECK | `db/us2-policies.test.ts` › "US2-4 R-09a/b: …" | Covered |
| R-09c | Core | Trigger | `db/us2-policies.test.ts` › "US2-5 R-09c B-3: business values cannot be updated in place"; "US2-8 R-09e: …" | Covered |
| R-09d | Core | DB: FK RESTRICT | `db/us2-policies.test.ts` › "US2-6 R-09d: a referenced version cannot be deleted; an unreferenced one can" | Covered |
| R-09e | Core | Procedure | `db/us2-policies.test.ts` › "US2-8 R-09e: closing may not be retroactive, extend, clear, or cut off an existing borrow" | Covered |
| R-09f | Core | Procedure | `db/us3-checkout.test.ts` › "US2-10 R-09f: a checkout just before a version ends uses it; one at the boundary uses the next"; `concurrency/ct-04-06-cross-flows.test.ts` › "CT-6 R-09f: checkout × policy close at the boundary — the item always lies inside its version (20 runs)" | Covered |
| R-10a | Core | Procedure | `db/us3-return-renew.test.ts` › "US3-13 R-10a R-11c: the loan closes with its last item; terminal items cannot reopen" | Covered |
| R-11a | Core | Trigger | `db/us3-return-renew.test.ts` › "US3-4 R-11a: a loan item keeps its snapshot after the policy is replaced" | Covered |
| R-11b | Core | DB: CHECKs | `db/us3-checkout.test.ts` › "US3-11 R-11b: due must be after borrow; return may not precede borrow (3819)" | Covered |
| R-11c | Core | Trigger | `db/us3-return-renew.test.ts` › "US3-13 R-10a R-11c: …" | Covered |
| R-12a | Core | DB-derived unique | `db/us3-checkout.test.ts` › "US3-2 R-12a B-1: a second open loan item for a copy is rejected, and the unique key exists" | Covered |
| R-12b | Core | Procedure | `db/us3-checkout.test.ts` › "US3-1 R-12b: …", "US3-12 FR-009d: each eligibility rule rejects the checkout and writes nothing", "US3-16 D13: a multi-copy checkout is all-or-nothing"; `concurrency/ct-01-03-checkout.test.ts` › "CT-1 US3-1 R-12b: …", "CT-2 US3-3 R-12b: …", "CT-3 R-12b D13: …"; `concurrency/ct-04-06-cross-flows.test.ts` › "CT-4: return (assesses a late fine over the debt threshold) × checkout by the same reader (20 runs)" | Covered |
| R-12c | Core | Procedure + trigger guard | `db/us3-checkout.test.ts` › "US3-10 R-12c: a loaned copy cannot be set available directly"; `db/us1-copy-lifecycle.test.ts` › "R-12c: a copy cannot enter on_loan without an open loan item"; `concurrency/ct-04-06-cross-flows.test.ts` › "CT-5: return × lost declaration of the same loan item — exactly one terminal state (20 runs)" | Covered |
| R-13a | Core | Procedure + DB CHECK | `db/us3-return-renew.test.ts` › "US3-5 R-13a: renewal adds applied loan days to the old due time and is recorded", "US3-6: renewal is rejected when overdue or at the limit, and nothing changes" | Covered |
| R-14a | Core schema | DB-derived unique | `db/us3-reservation-schema.test.ts` › "RS-1 reservation schema constraints, Core without workflow" › "R-14a/b/c/d: the database rejects invalid reservation rows" | Covered |
| R-14b | Core schema | DB: CHECK | same RS-1 test | Covered |
| R-14c | Core schema | DB: composite FK | same RS-1 test | Covered |
| R-14d | Core schema | DB-derived unique | same RS-1 test | Covered |
| R-14e | Ext | Procedure | — | Phase 10 |
| R-14f | Ext | Procedure | — | Phase 10 |
| R-14g | Ext | Procedure | — | Phase 10 |
| R-15a | Core | DB: UNIQUE(loan_item_id, fine_type) | `db/us4-fines.test.ts` › "US4-4 R-15a/b: a second late fine is rejected; damaged and lost cannot coexist" | Covered |
| R-15b | Core | Procedure + trigger guard | `db/us4-fines.test.ts` › "US4-4 R-15a/b: …"; `concurrency/ct-04-06-cross-flows.test.ts` › "CT-5: …" | Covered |
| R-15c | Core | DB: CHECK | `db/us4-fines.test.ts` › "US4-10 R-15c/d: damaged fine within 0…replacement cost with a reason; otherwise FINE_RULE" | Covered |
| R-15d | Core | Procedure | same US4-10 test | Covered |
| R-16a | Core | DB: CHECK, composite PK | `db/us4-payments.test.ts` › "US4-6 R-16a/b/c/d: wrong totals, over-allocation or another reader’s fine reject the whole payment" | Covered |
| R-16b | Core | Procedure | same US4-6 test; "US4-5: 40,000 paid as 30,000 + 10,000 → …"; "US4-13 R-26 B-2: the app account cannot write money tables directly (1142)" | Covered |
| R-16c | Core | Procedure (+ trigger guard) | same US4-6 test; `concurrency/ct-07-13-money.test.ts` › "CT-7 US4-7 R-16c: two payments of the same remaining balance — exactly one succeeds (20 runs)" | Covered |
| R-16d | Core | Procedure | same US4-6 test | Covered |
| R-16e | Core | DB: UNIQUE(request_key) | `db/us4-payments.test.ts` › "US4-12 R-16e: a retried request key returns the existing payment" | Covered |
| R-17a | Core | Procedure (+ trigger guard) | `db/us4-adjustments.test.ts` › "US4-8 R-17a: −100,000 with a reason settles the fine; −120,000 or no reason is FINE_RULE"; `concurrency/ct-07-13-money.test.ts` › "CT-13 R-17a: payment × adjustment on the same fine — net never falls below allocated (20 runs)" | Covered |
| R-17b | Core | Trigger | `db/us4-fines.test.ts` › "US4-11 R-17b B-4: money rows are append-only, even for the owner"; `db/us4-adjustments.test.ts` › "R-17b: adjustments are append-only" | Covered |
| R-19a | Core | DB: UNIQUE(supabase_user_id) | `db/us5-rbac.test.ts` › "US5-1 R-19a: one application account per Supabase user (1062)" | Covered |
| R-19b | API | Server token verification | — | Later API feature, out of spec 001 |
| R-20 | Core | Procedure: permission function first | `db/us5-rbac.test.ts` › "US5-6 R-20: every operation procedure refuses an unauthorized or inactive account, writing nothing"; `db/functions.test.ts` › "R-20: fn_has_permission is false for inactive accounts and missing permissions"; per-area R-20 tests in `us1-copy-lifecycle`, `us2-policies`, `us3-return-renew`, `us4-payments` | Covered |
| R-26 | Core | DB privileges | `db/foundation.test.ts` › "R-26: the app account cannot INSERT into loans (1142) and can EXECUTE fn_due_at"; `db/us5-rbac.test.ts` › "R-26: the app account cannot INSERT, UPDATE or DELETE any procedure-only table (1142)"; `db/us4-payments.test.ts` › "US4-13 R-26 B-2: …" | Covered |

**Bypass tests**: B-1 (`US3-2 R-12a B-1`), B-2 (`US4-13 R-26 B-2`, both R-26 tests), B-3
(`US2-5 R-09c B-3`), B-4 (`US4-11 R-17b B-4`), B-5 (`B-5 R-06b`).

**GAPs**: none. Every Core and Core-schema row has at least one passing test.

## 4. Open items

1. **T081**: fetch `data/seed/books.google.json` once with T080 (needs `GOOGLE_BOOKS_API_KEY`),
   then have the team review and commit it. Until then the seed uses `books.manual.json` only.
2. **SC-008**: timed walkthrough by a reviewer unfamiliar with the project.
3. **Fresh-clone rerun**: after the work is committed, repeat §3–§9 on a fresh clone with an
   empty volume and update this report.
4. **Phase 10 (Ext)**: reservations and holds (R-14e/f/g, CT-9…CT-12, `--ext`), only after
   this gate passes.
