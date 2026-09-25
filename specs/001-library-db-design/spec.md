# Feature Specification: Core Library Data Model and ERD

**Feature Branch**: `001-library-db-design`

**Created**: 2026-09-24

**Status**: Draft (revision 6 — analysis fixes 2026-09-24)

**Input**: User description: "core data model and ERD"

## Clarifications

### Session 2026-09-24

- Q: Where does the database run for development and testing? → A: A local MySQL 8.4 Docker
  container (stated by the team).
- Q: When is Supabase Auth integrated? → A: Later, together with the API feature; spec 001 keeps
  only the account and RBAC tables (stated by the team).
- Q: What is the job of spec 001? → A: A well-designed database and ERD: migrations for tables,
  constraints, triggers, functions, procedures, cursors and views, with no API or UI (stated by
  the team).
- Q: Should the core operations (checkout, return, declare lost, renew, record payment) be
  stored procedures in spec 001, or built later in the API? → A: Stored procedures in spec 001
  (option A); the later API only calls them.
- Q: Where does the sample data come from, now that the Google Books import tool is part of the
  API feature? → A: A one-off script fetches metadata from Google Books; the team reviews it and
  commits it as a static data file. The seed loads books from that file and creates copies,
  readers and transactions by calling the operation procedures with an injected clock
  (option A).
- Q: What form should the ERD in the report take? → A: Two levels: a conceptual ERD in Chen
  notation (entities, attributes, relationships, cardinalities), plus a crow's-foot relational
  diagram and a table mapping the ERD to relations (option B).
- Q: Which loan policy numbers does the seed use (D1)? → A: The values proposed in research.md
  R13 are accepted.
- Q: Which MySQL version does the course require (D10)? → A: No requirement from the lecturer;
  use the current MySQL 8.4 LTS image.
- Q: Are fine adjustments part of Core? → A: Yes. Without them a wrongly assessed fine could not
  be corrected, because money rows are append-only (analysis U1).
- Q: May database names, account names or ports be fixed in code? → A: No. Every such value
  comes from environment variables with generic defaults, so anyone can run Docker and the code
  with their own values (FR-030).

## User Scenarios & Testing *(mandatory)*

Actors: **Librarian** (catalogs, issues cards, runs circulation), **Admin** (manages policies,
roles), **Reader** (borrows, reserves, looks up own records), **Project team / grader** (reviews
the ERD, entity predicates and constraints as report evidence).

Report chapters evidenced (constitution VII):
- **Ch.2**: the ERD, mapping and data dictionary, constraints and the Rule Enforcement Matrix.
- **Ch.3**: DDL from the migrations and the sample data.
- **Ch.4**: triggers, functions, procedures and cursors; privileges; concurrency tests; backup
  and restore; reports with EXPLAIN.

This feature defines *what information the library keeps and which rules the data must never
violate*, including rules that span several tables or concurrent writes. Its job is a
well-designed database and ERD: the deliverable is the ERD, the data dictionary and database
migrations containing every table, constraint, trigger, function, stored procedure, cursor and
view. Each story is tested directly against the database, by calling the operation procedures
(FR-026) or writing rows directly, and checking that valid records are accepted and invalid ones
are rejected. The API, UI, Supabase sign-in and the Google Books import tool are later features
that call this database.

> Revision note: at the team's request this spec names the target stack (MySQL, Drizzle,
> Supabase Auth, Google Books) and the enforcement mechanism for each cross-table rule, so the
> plan can be designed against it. See "Concurrency Protocol" and "Rule Enforcement Matrix".

### Scope Tiers

Every requirement, scenario, matrix row and concurrency test is tagged:

- **[Core]**: mandatory. Proves correctness of catalog, copies, readers/cards, policy versions,
  checkout/return/renew/lost, fines, payments and debt, identity and RBAC. The project is not
  done until every [Core] item passes.
- **[Ext]**: extension, built only if time allows after [Core] passes: the reservation queue
  and holds. The reservation entity and its single-row/unique DB constraints are still in the
  ERD and [Core] schema, and are tested directly in [Core]. Their workflows and concurrency
  tests are [Ext].
- **[API]**: kept here so the model is complete, but implemented and tested in the later API
  feature, not in spec 001: Supabase token verification, server-side request handling, and the
  Google Books client with its import, refresh-with-accept and online-preview workflows. The
  tables and DB constraints these items rely on are still [Core].
- An untagged item is [Core].
- While reservations are not built, rules that mention reservations are trivially satisfied
  (no reservation rows exist) and copies never enter `on_hold`.

### User Story 1 - Catalog books and physical copies (Priority: P1) [Core]

A librarian records a book edition (title, subtitle, publisher, publication date as known,
language, description, cover, classification code, replacement cost, material type), links it to
one or more authors in a defined order and to one or more categories, records its identifiers
(ISBN-10/13 or others, when available), and registers each physical copy with its own unique
barcode, shelf location, acquisition date, physical condition and circulation status. A librarian
may start a book from a Google Books volume, but the book and its copies belong to the library.

**Why this priority**: Every other part of the system refers to books and copies.

**Independent Test**: Record several books (one with no ISBN, one with several authors and
categories, two editions sharing a title) and copies; record the same external reference twice;
confirm duplicate barcodes, orphan copies and duplicate external references are rejected.

**Acceptance Scenarios**:

1. **Given** an empty catalog, **When** a librarian records a book with two authors (ordered)
   and three categories, **Then** the book, its author order and categories are all retrievable.
2. **Given** a book exists, **When** a librarian registers three copies with distinct barcodes,
   **Then** the book shows three copies, each with its own condition and circulation status.
3. **Given** a copy with barcode `B0001` exists, **When** another copy is registered with
   barcode `B0001`, **Then** the record is rejected.
4. **Given** two editions of the same work with the same title but different publishers/years,
   **When** both are recorded, **Then** they are stored as two distinct books.
5. **Given** a book has no ISBN, cover or description, **When** it is recorded, **Then** it is
   accepted.
6. **Given** book `K1` has an external reference (`GOOGLE_BOOKS`, `V1`), **When** a second
   reference with the same provider and external id is inserted, **Then** it is rejected.
   **[API]** Re-running the import of `V1`, including two imports at the same moment, returns
   `K1` and creates no second book.
7. **[API]** **Given** a librarian edited `K1`'s title after import, **When** `V1` is refreshed
   with a different title, **Then** `K1`'s title is unchanged and the provider's new title is
   only available for the librarian to accept explicitly.
8. **[API]** **Given** an import search returns 10 candidate volumes, **When** the librarian has not
   selected one, **Then** nothing is written; importing never creates copies.
9. **Given** a copy whose condition is `damaged`, **When** its status is set to `available`,
   **Then** it is rejected.
10. **[API]** **Given** book `K1`'s reference snapshot is 3 days old and showed embeddable,
    **When** a reader opens `K1`, **Then** view rights are re-checked first; the preview is
    offered only if still viewable and embeddable, otherwise only metadata and copy availability
    are shown.

---

### User Story 2 - Readers, library cards and loan policy versions (Priority: P1) [Core]

A librarian creates a reader profile with a reader type, optionally before the reader has an
online account, and issues a library card. An admin defines loan policy *versions* per reader type
and material type, each with a validity period. A version only has to be in effect at the moment
of checkout; loans made under it keep running after it ends. To change the rules, the admin
closes the current version and creates the next one; a version's business values never change.

**Why this priority**: Circulation cannot be decided without knowing who the borrower is, whether
their card is valid, and which rules applied at the time.

**Independent Test**: Record readers, cards and policy versions; attempt duplicate cards, a second
active card, overlapping versions (sequentially and concurrently), in-place edits, retroactive
closing, and a checkout just before a version ends.

**Acceptance Scenarios**:

1. **Given** reader type "Student" exists, **When** a librarian creates a reader without a login
   account, **Then** the reader is stored and can later be linked to exactly one account.
2. **Given** a reader has an active card, **When** a second active card is issued to the same
   reader, **Then** it is rejected; after the old card is set to expired, lost or revoked, a new
   active card is accepted.
3. **Given** two librarians issue an active card to the same reader at the same moment, **When**
   both commit, **Then** exactly one succeeds.
4. **Given** version P1 for (Student, Printed book) valid from 2026-09-01 00:00 with no end,
   **When** version P2 for the same pair valid from 2026-10-01 00:00 is added, **Then** it is
   rejected; **When** P1 is closed at 2026-10-01 00:00 and P2 is added in the same transaction,
   **Then** both are stored.
5. **Given** P1 exists, **When** its daily fee, loan days, max items, max renewals or debt
   threshold is updated, **Then** the update is rejected.
6. **Given** P1 is referenced by a loan item, **When** P1 is deleted, **Then** it is rejected;
   an unreferenced version can be deleted.
7. **Given** a card with expiry date earlier than or equal to its issue date, **When** it is
   recorded, **Then** it is rejected.
8. **Given** it is now 2026-10-02 and P1 is valid `[2026-09-01 00:00, 2026-10-01 00:00)`,
   **When** an admin moves P1's end to 2026-09-30 00:00 (retroactive), or later, or clears it,
   **Then** it is rejected.
9. **Given** card number `C001` exists, **When** another card `C001` is issued, **Then** it is
   rejected.
10. **Given** P1 = `[2026-09-01 00:00, 2026-10-01 00:00)` (14 days, 2,000 VND/day) and
    P2 = `[2026-10-01 00:00, ∞)` (7 days, 5,000 VND/day), library local time:
    **When** a student checks out at 2026-09-30 23:59:59.900, **Then** the loan item references
    P1 and is due 2026-10-14 23:59:59.999; after 2026-10-01 it keeps P1's 14 days, renewals and
    2,000 VND/day even though P1 is no longer in effect.
    **When** a student checks out at 2026-10-01 00:00:00.000, **Then** the loan item references
    P2 and is due 2026-10-08 23:59:59.999.

---

### User Story 3 - Circulation: loans, renewals, reservations and copy lifecycle (Priority: P2)

A loan (one checkout session for one reader, processed by a staff account) contains one or more
loan items, each for one copy, storing the policy values applied at checkout. Renewals are
recorded with old and new due times. [Ext] Readers reserve a book (not a copy); when a copy
becomes available it is held for the first eligible waiting reader by `(requested_at,
reservation id)` for a hold window, then passed on or released if not collected.

**Why this priority**: Core correctness claim of the project; depends on stories 1 and 2.

**Independent Test**: Run checkout, return, renewal and lost scenarios and the [Core] concurrency
tests; after each, run the invariant suite and confirm zero violations. [Ext] Repeat with
reservations, holds and expiry.

**Acceptance Scenarios**:

1. **Given** copy `B0001` is available, **When** two checkout requests for `B0001` by different
   readers run concurrently, **Then** exactly one loan item is created, `B0001` is `on_loan`,
   the other request fails with "copy not available", and no empty loan header remains.
2. **Given** copy `B0001` already has an open loan item, **When** a second open loan item for
   `B0001` is inserted directly (bypassing the application), **Then** the database rejects it.
3. **Given** a reader has max_active_items − 1 open items, **When** two checkouts of different
   copies for that reader run concurrently, **Then** exactly one succeeds.
4. **Given** a loan item created under version P1 (fee 2,000 VND/day, 14 days, 2 renewals),
   **When** P1 is closed and P2 (fee 5,000 VND/day) becomes current, **Then** the loan item
   still shows 2,000 VND/day, 14 days and 2 renewals, and its late fee uses 2,000 VND/day.
5. **Given** a loan item due 2026-10-10, not overdue, renewed 0 times of 2, **When** it is
   renewed, **Then** due becomes 2026-10-24, renewal count becomes 1 and a renewal record stores
   old and new due times and the staff account.
6. **Given** the same loan item, **When** renewal is attempted while it is overdue or at the
   renewal limit, or **[Ext]** while the book has a waiting reservation, **Then** it is rejected
   and nothing changes.
7. **[Ext]** **Given** readers R1, R2, R3 reserved book K (in that order) and all copies are on
   loan, **When** one copy is returned in good condition, **Then** the copy becomes `on_hold`,
   R1's reservation becomes `ready` with that copy and a hold expiry, and R2, R3 stay `waiting`.
8. **[Ext]** **Given** R1's hold expired, **When** expiry processing runs, **Then** R1's
   reservation becomes `expired`, R2's becomes `ready` for the same copy and the copy stays
   `on_hold`; **When** no eligible reservation is waiting, **Then** the copy becomes `available`.
9. **[Ext]** **Given** a copy is `on_hold` for R1, **When** R2 tries to borrow it, **Then** it
   is rejected; **When** R1 borrows it, **Then** R1's reservation becomes `fulfilled` and the
   copy `on_loan`.
10. **Given** a copy has an open loan item, **When** its status is set to `available` (directly
    or by any operation other than a return), **Then** it is rejected.
11. **Given** a loan item, **When** a due time not after the borrow time, or a return time before
    the borrow time, is recorded, **Then** it is rejected.
12. **Given** a reader whose card is expired, or whose outstanding debt exceeds the threshold,
    or who has an overdue item, or who is not `active`, **When** a checkout is attempted,
    **Then** it is rejected and nothing is written.
13. **Given** a loan with two items, **When** the first is returned, **Then** the loan stays
    `open`; **When** the second is returned or declared lost, **Then** the loan is `closed`.
    **When** a `returned` or `lost` item is set back to `on_loan`, **Then** it is rejected.
14. **[Ext]** **Given** R1 has a `waiting` reservation for book K, **When** R1 reserves K again,
    **Then** it is rejected; **When** anyone reserves a book with an `available` copy, or a book
    they currently have on loan, **Then** it is rejected.
15. **[Ext]** **Given** the queue for book K is R1 (card revoked), R2 (debt above threshold), R3
    (eligible), **When** a copy of K becomes available, **Then** R1's reservation is `cancelled`
    with reason `ineligible_at_promotion` and R2's becomes `ready`; **When** R2 has not
    collected by the hold expiry, **Then** R2's becomes `expired` and R3's becomes `ready`. The
    queue never waits more than one hold window per soft-ineligible reader.
16. **Given** a multi-copy checkout of `B0001` and `B0002` where `B0002` is not available,
    **When** it is processed, **Then** nothing is written (all-or-nothing, D13).

---

### User Story 4 - Fines, payments and outstanding debt (Priority: P2)

Fines are assessed per loan item (late, damaged, lost) by defined formulas, with actor and reason
recorded when an amount differs from the default. Every payment is fully (100%) allocated to the
reader's fines by a single database operation that refuses to commit otherwise.
Corrections are adjustments with actor and reason; nothing is edited or deleted in place.

**Why this priority**: Required for financial reports and debt-based blocks; depends on loans.

**Independent Test**: Run the fine and payment scenarios below and confirm that, for every
reader, the cumulative identity `net assessed = collected + outstanding` holds at any instant and
the monthly roll-forward holds (FR-018).

**Acceptance Scenarios**:

1. **Given** an item due 2026-10-10 (end of day, library time) with applied fee 2,000 VND/day,
   **When** it is returned on 2026-10-13, **Then** one late fine of 6,000 VND is assessed.
2. **Given** an item returned on or before its due date, **When** it is returned, **Then** no
   late fine is created.
3. **Given** an item due 2026-10-10 declared lost on 2026-10-20, fee 2,000 VND/day, replacement
   cost 150,000 VND, **When** it is declared lost, **Then** a late fine of 20,000 VND and a lost
   fine of 150,000 VND are assessed, the loan item is `lost` and the copy is `lost`.
4. **Given** a late fine already exists for a loan item, **When** another late fine is recorded
   for that loan item, **Then** it is rejected; a lost fine and a damaged fine for the same loan
   item are also rejected together.
5. **Given** fines F1 = 30,000 and F2 = 30,000 VND, **When** a payment of 40,000 VND is recorded
   with allocations 30,000 to F1 and 10,000 to F2, **Then** collected = 40,000, allocated =
   40,000, outstanding = 20,000 and F1 is settled.
6. **Given** the same fines, **When** a 40,000 VND payment is recorded with allocations totalling
   35,000 or 45,000, or with 35,000 allocated to F1, or with any allocation to another reader's
   fine, **Then** the whole operation is rejected and no payment or allocation is stored.
7. **Given** F1 has 10,000 VND remaining, **When** two payments each allocating 10,000 to F1
   run concurrently, **Then** exactly one succeeds.
8. **Given** a lost fine of 150,000 VND with 50,000 paid, **When** a librarian with
   `fine.adjust` records an adjustment of −100,000 with a reason, **Then** the net fine becomes
   50,000 and it is settled; **When** an adjustment of −120,000 is attempted, **Then** it is
   rejected (net would fall below the amount already paid); an adjustment without a reason, or
   by an account without `fine.adjust`, is rejected.
9. **Given** a returned loan item with an unpaid fine, **When** the item is viewed, **Then** it
   is `returned` while the fine remains outstanding.
10. **Given** a book with replacement cost 150,000 VND, **When** its copy is returned with
    condition `damaged` and a damaged fine of 40,000 VND with a reason is entered, **Then** the
    fine is stored and the copy becomes `in_repair`; a damaged fine of 200,000 VND, or one
    without a reason, is rejected.
11. **Given** a stored payment, allocation, adjustment or fine amount, **When** it is updated or
    deleted, **Then** it is rejected.
12. **Given** a payment request with request key `K9` was committed but the response was lost,
    **When** the same request is retried, **Then** the existing payment is returned and no second
    payment is created.
13. **Given** the application's database account, **When** it inserts directly into the payment
    or allocation tables, **Then** it is denied; payments can only be recorded through the
    record-payment procedure (FR-016a).
14. **Given** reader R has no debt before September, fine F = 30,000 VND assessed on 2026-09-25
    and paid in full on 2026-10-05, **When** the September and October reports are produced,
    **Then** September shows opening 0, assessed 30,000, collected 0, closing 30,000; October
    shows opening 30,000, assessed 0, collected 30,000, closing 0; and the cumulative balance on
    2026-10-31 shows net assessed 30,000 = collected 30,000 + outstanding 0.

---

### User Story 5 - Accounts, identity link, roles and permissions (Priority: P3) [Core]

Supabase Auth manages identity (sign-in, passwords, sessions). The library keeps one application
account per Supabase user, storing only the Supabase user id. Roles and permissions live in the
library database. Every operation procedure checks that its acting account is `active` and
holds the required permission (FR-026). **[API]** Token verification is added with the API.

**Why this priority**: Security and accountability; the rest of the model can be demonstrated with
seeded staff accounts first.

**Independent Test**: Record accounts, roles, permissions and assignments; confirm duplicate
identity links are rejected, procedures refuse inactive or unauthorized accounts, and
deactivation keeps history.

**Acceptance Scenarios**:

1. **Given** an account linked to Supabase user X, **When** a second account for X is recorded,
   **Then** it is rejected.
2. **[API]** **Given** a request carries a valid token for user X but a body claiming to be user Y,
   **When** it is processed, **Then** it acts as X only.
3. **[API]** **Given** a request with an invalid, expired or unverifiable token, **When** it reaches any
   operation touching library data, **Then** it is rejected before any read or write.
4. **Given** a librarian account processed 20 loans, **When** the account is deactivated,
   **Then** all 20 loans still reference it, and the account can no longer perform operations.
5. **[API]** **Given** a user edits their Supabase profile metadata to claim role "admin", **When** they
   call an admin operation, **Then** it is rejected because roles come only from the library
   database.
6. **Given** an account without `loan.checkout`, or an `inactive` account, **When** it is passed
   as the acting account to the checkout procedure, **Then** the call is rejected with
   `FORBIDDEN` and nothing is written.

---

### User Story 6 - ERD and data dictionary for the report (Priority: P3) [Core]

The team produces the model at two levels:
- a conceptual ERD in Chen notation (entities, attributes, relationships, cardinalities);
- a crow's-foot relational diagram of the actual tables, with a mapping table showing how each
  entity, relationship and multi-valued attribute of the ERD became relations.

For every relation there is also a predicate (tân từ), its attributes with meaning and
optionality, keys, and relationships with cardinality, plus the Rule Enforcement Matrix below.

**Why this priority**: Directly graded in Chapter 2; produced once stories 1–5 are stable.

**Independent Test**: A reviewer traces every entity and relationship in the Chen ERD, through
the mapping table, to relations in the relational diagram and the data dictionary, and every
rule in the matrix to a mechanism and a passing test.

**Acceptance Scenarios**:

1. **Given** the finished model, **When** the ERD is compared with the data dictionary, **Then**
   every entity and relationship appears in both with matching cardinalities.
2. **Given** the Rule Enforcement Matrix, **When** a reviewer checks each [Core] rule, **Then**
   each has a mechanism and at least one passing test.
3. **Given** the Chen ERD, **When** a reviewer follows the ERD-to-relational mapping table,
   **Then** every entity, relationship and multi-valued attribute maps to named relations. Each
   many-to-many relationship (e.g. book–author, book–category, payment–fine) maps to a junction
   relation, and every relation in the relational diagram is either an ERD element or a
   documented technical addition.
4. **Given** the migrations applied to a fresh container, **When** the relational diagram is
   compared with the live schema, **Then** every table, key and foreign key matches.

---

### Edge Cases

- A Google Books volume later loses preview rights: the stored viewability is a dated snapshot;
  it never affects copies or availability. [API] Preview is hidden once re-checked.
- The same ISBN appears on two provider records: both may be imported only after the librarian
  confirms they are different editions; the import warns on identifier collisions.
- A book with copies or history is deleted: rejected; books and copies are retired instead.
- A lost copy is later found: the loan item stays `lost` (history) and the copy moves from
  `lost` back into circulation or repair. The unpaid part of the lost fine may be reduced by an
  adjustment; refunds of amounts already paid are out of scope.
- A Supabase account is deleted or banned: the application account is set inactive; the reader
  profile, loans and fines remain.
- [Ext] The head of the queue is ineligible: hard-ineligible readers (not `active`, or no valid
  card) are cancelled at promotion; soft-ineligible readers (debt, overdue, at limit) get the
  hold window to resolve it, then expire (FR-014d).
- [Ext] A copy under repair or lost while its book has a waiting queue: the queue waits; when the
  copy returns to circulation, promotion runs.
- A deadlock or lock wait timeout during any operation: the whole transaction is rolled back and
  retried per the Concurrency Protocol; no partial loan, fine or payment remains.
- A committed payment whose response was lost is retried: the request key returns the existing
  payment (FR-016b).
- Publication date known only as a year or year-month: stored as given, with a year for filtering.

## Requirements *(mandatory)*

### Functional Requirements

**Catalog**

- **FR-001**: System MUST store books (editions) with title (required), subtitle, publisher,
  publication date text, publication year, description, language, cover link, classification
  code, replacement cost (≥ 0, optional) and material type (required).
- **FR-002**: System MUST store authors and publishers as reusable records; a book MAY have many
  authors with an explicit order and MAY have many categories; categories MAY be nested.
- **FR-003**: System MUST store zero or more identifiers per book (type + value); it MUST NOT
  require an ISBN, and it MUST NOT auto-merge books that share an identifier.
- **FR-004**: System MUST store external references per book (provider, external id, source
  link, viewability, embeddable flag, web reader link, access country, fetch time, and the raw
  provider metadata snapshot), with at most one reference per (provider, external id).
- **FR-004a**: Books and copies are library-owned. An external reference is only a source of
  suggested metadata and a dated view-rights snapshot. No copy, availability, loan or
  reservation may be created or derived from external data.
- **FR-004b [API]**: An import MUST write nothing until a librarian selects one specific edition
  (comparing identifiers, title, authors, publisher, year). The book, authors, categories,
  identifiers and reference for one volume MUST be written in one transaction. Re-importing the
  same (provider, external id), including concurrently, MUST NOT create a second book or
  reference; the losing import reads and returns the existing book.
- **FR-004c [API]**: A refresh MUST update only the external reference (snapshot, view rights,
  `fetched_at`). Book fields are never overwritten by import. **[API]** A librarian may review
  differences and explicitly accept a provider value into the book. Library-only data
  (classification, replacement cost, shelf, copies) is never written by import.
- **FR-004d [API]**: Online preview is optional. It MAY be offered only when the latest snapshot
  shows the volume is viewable and embeddable for the library's country; a snapshot older than
  24 hours MUST be re-checked before offering it. Ebook content MUST NOT be stored; provider
  attribution MUST be shown wherever provider data appears.
- **FR-005**: System MUST store material types with a unique code; printed book is the only type
  populated at launch; new types MUST be addable without structural change.
- **FR-006**: System MUST store copies, each belonging to exactly one book, with a unique
  barcode, shelf code, acquisition date, physical condition (`good`, `worn`, `damaged`) and
  circulation status (`available`, `on_loan`, `on_hold`, `in_repair`, `lost`, `retired`). A copy
  whose condition is `damaged` MUST NOT be `available`, `on_hold` or `on_loan`.
- **FR-006a**: Copy status changes MUST follow the Copy Lifecycle table; any other transition is
  rejected. **[Ext]** Any operation that would make a copy `available` while its book has a
  `waiting` reservation MUST instead run promotion (FR-014b).

**Readers, cards and policies**

- **FR-007**: System MUST store reader types (unique code) and readers with full name, contact
  details, status (`active`, `suspended`, `inactive`), reader type and an optional link to one
  application account (each account linked to at most one reader).
- **FR-008**: System MUST store library cards with a unique number, issue time, expiry time
  (after issue time) and status (`active`, `expired`, `lost`, `revoked`), and MUST allow at most
  one `active` card per reader, including under concurrent issuance. A card is *valid* at an
  instant when it is `active` and its expiry time is after that instant.
- **FR-009**: Loan policies are *versions* per (reader type, material type) with max active
  items, loan days, max renewals, daily late fee, debt-block threshold and a half-open validity
  period `[valid_from, valid_to)` (`valid_to` empty = open-ended). Versions for the same pair
  MUST NOT overlap, including under concurrent creation.
- **FR-009a**: A version's business values (all fields except `valid_to`) MUST be immutable
  after creation. A version referenced by any loan item MUST NOT be deleted. Changing rules =
  close the current version and create the next one in one transaction.
- **FR-009b**: A version governs only *checkout*: a loan item MUST reference the version whose
  period contains the item's borrow time (`valid_from ≤ borrowed_at < valid_to`), and checkout
  MUST be rejected if none does. After checkout the loan item depends only on its own snapshot
  (FR-011); due times, renewals, returns and fines MAY fall after the version's `valid_to`.
- **FR-009c**: Closing a version (setting `valid_to`) is allowed only when `valid_to` is empty
  or being moved earlier, and the new `valid_to` MUST be after `valid_from`, not earlier than
  the current time (no retroactive closing), and after the borrow time of every loan item that
  references it (so FR-009b stays true). Because checkout reads the version with a shared lock
  (Concurrency Protocol), a checkout and a close at the same instant serialize: the checkout
  either commits first under the old period or sees the new `valid_to` and picks the next
  version.
- **FR-009d**: Checkout eligibility MUST be evaluated inside the checkout transaction, after the
  reader row is locked, using locking reads: reader `active`; card valid at borrow time;
  outstanding debt ≤ debt-block threshold (when one checkout mixes material types, the strictest
  threshold among their policy versions applies); open items of that material type + items in this
  checkout ≤ max active items; no overdue open item (D7); each copy `available`, or **[Ext]**
  `on_hold` for this reader's `ready` reservation. A multi-copy checkout is all-or-nothing (D13).

**Circulation**

- **FR-010**: System MUST store loans (reader, processing staff account, borrow time, status
  `open`/`closed`). A loan has one or more loan items and is `closed` exactly when none of its
  items is `on_loan`.
- **FR-011**: Each loan item MUST reference one copy and the applied policy version and store
  borrow time, due time, return time, return condition, lost-declaration time, status
  (`on_loan`, `returned`, `lost`), renewal count, and a snapshot of applied loan days, max
  renewals and daily late fee copied at checkout. Snapshot fields MUST NOT change after insert.
  Due time = 23:59:59.999 library local time on the day that is `loan days` after the local
  borrow date. Due time MUST be after borrow time; return time MUST NOT be before borrow time;
  `returned` requires a return time and return condition; `lost` requires a lost-declaration
  time and no return time; `on_loan` requires neither. Overdue is derived (`on_loan` and due
  time passed), not stored.
- **FR-011a**: Loan item status MUST only move `on_loan → returned` or `on_loan → lost`; both
  are terminal.
- **FR-012**: A copy MUST have at most one `on_loan` loan item at any time, enforced by the
  database even if the application check is bypassed. A copy is `on_loan` if and only if it has
  exactly one `on_loan` loan item (invariant I-1). Checkout MUST lock the reader and the copies
  with locking reads before checking and writing; a plain `SELECT` followed by a separate
  `INSERT` is not sufficient.
- **FR-013**: Renewal MUST be allowed only for an `on_loan`, non-overdue item with renewal count
  < applied max renewals and **[Ext]** no `waiting` reservation for its book. New due = old due
  + applied loan days (D5). Each renewal MUST record old due, new due (after old due), time and
  staff account, in the same transaction that updates the loan item.
- **FR-014**: System MUST store reservations per reader and book with request time, status
  (`waiting`, `ready`, `fulfilled`, `cancelled`, `expired`), assigned copy, ready time, hold
  expiry, close reason, closing actor (staff account, the reader, or `system`) and fulfilling
  loan item. At most one `waiting`/`ready` reservation per (reader, book); a `ready`
  reservation MUST have an assigned copy of the same book and a hold expiry; a copy MUST be
  assigned to at most one `ready` reservation. (The entity and these single-row/unique
  constraints are [Core] schema; the workflows in FR-014a–d are [Ext].)
- **FR-014a [Ext]**: A reservation MAY be created only when the book has no `available` copy
  and the reader has no `on_loan` copy of that book (D6).
- **FR-014b [Ext]**: *Promotion.* Queue order is `(requested_at, reservation id)` ascending.
  When a copy becomes lendable (return in good condition, repair done, found, new copy
  registered, or its hold ended), the same transaction MUST lock the book's `waiting`
  reservations in queue order and walk them: a *hard-ineligible* reader (reader not `active`, or
  no card valid now) is set `cancelled` with reason `ineligible_at_promotion` and actor
  `system`; the first other reservation becomes `ready` (assigned copy, ready time, hold expiry
  = ready time + hold window, D4) and the copy becomes `on_hold`. If none remains, the copy
  becomes `available`.
- **FR-014c [Ext]**: *Expiry and cancellation.* A `ready` reservation whose hold expiry has
  passed MUST be set `expired` (actor `system`) and promotion re-run for its copy in the same
  transaction. This MUST run as a scheduled batch (at least every 15 minutes) and also on demand
  when the held copy is scanned for checkout. Cancelling a `ready` reservation (by the reader, or
  by a librarian with a reason) re-runs promotion the same way.
- **FR-014d [Ext]**: *Soft ineligibility.* A `ready` holder blocked by debt, an overdue item or
  the item limit keeps the hold until its expiry and can resolve the block and collect; checkout
  by that holder is rejected while blocked. A librarian MAY cancel the hold early with a reason.
  Reservation status MUST only move `waiting → ready | cancelled` and
  `ready → fulfilled | expired | cancelled`.
- **FR-014e**: Every write operation MUST follow the Concurrency Protocol (lock order, locking
  reads, rollback and retry).

**Fines, payments and debt**

- **FR-015**: System MUST store fines per loan item with type (`late`, `damaged`, `lost`),
  default amount, assessed amount (both ≥ 0), assessment time, assessing staff account and
  reason (required when assessed ≠ default). At most one fine per (loan item, type); a loan
  item MUST NOT have both a `damaged` and a `lost` fine. A fine's status is derived (settled
  when its remaining balance = 0), not stored.
- **FR-015a**: Late fine: days late = library-local calendar date of the end event minus the
  local due date, minimum 0; end event = return, or lost declaration for lost items (accrual
  stops there). Amount = days late × applied daily late fee, capped at the book's replacement
  cost when known (D2). Assessed once, in the return or lost-declaration transaction; no fine
  when days late = 0.
- **FR-015b**: Lost fine: default = the book's replacement cost at declaration time; if unknown,
  the librarian MUST enter an amount with a reason. Damaged fine: assessed at return when return
  condition is `damaged`; the librarian enters an amount between 0 and the replacement cost with
  a reason (D3). An item both late and lost gets both a late fine (to the declaration date) and a
  lost fine.
- **FR-016**: A payment (reader, receiving staff account, amount > 0, time, method, reference,
  request key) MUST be allocated 100% to fines of the same reader: Σ allocations = payment
  amount, each allocation > 0, and no allocation may exceed the fine's remaining balance at that
  moment. A payment cannot exceed the reader's outstanding debt; refunds and credit are out of
  scope.
- **FR-016a**: *Single write path.* Payments and allocations MUST be written only by one
  database operation, the *record-payment procedure* (D11). It receives the payment and its full
  allocation list in one call and, inside its own transaction: locks the reader, then the listed
  fines in ascending id; validates ownership and remaining balances; inserts the payment and
  every allocation; re-computes Σ allocations for the new payment; and raises an error, rolling
  back everything, unless it equals the payment amount. The application's database account MUST
  have no INSERT/UPDATE/DELETE privilege on the payment and allocation tables, only permission to
  execute this procedure. It MUST be called as a standalone call, not inside an open application
  transaction.
- **FR-016b**: Each payment MUST carry a caller-supplied request key, unique across payments; a
  repeated call with the same key MUST return the existing payment and write nothing.
- **FR-016c**: *Guarantee boundary.* The equality Σ allocations = payment amount is guaranteed
  for every write made through the application account. It is *not* a database constraint
  (MySQL cannot check a multi-row sum at COMMIT); privileged maintenance accounts (migration,
  seeding, admin console) can bypass it. Therefore seed scripts MUST also use the procedure, and
  the invariant suite (I-6) MUST run after seeding and after every test run.
- **FR-017**: Corrections MUST be fine adjustments (fine, signed amount ≠ 0, reason
  required, actor with `fine.adjust`, time), written only by an *adjust-fine procedure* with the
  same privilege model as FR-016a. It locks the reader, then the fine, and rejects the adjustment
  unless afterwards net amount (assessed + all adjustments) ≥ amount already allocated ≥ 0.
- **FR-017a**: Fines' assessed amounts, payments, allocations and adjustments MUST NOT be updated
  or deleted after insert, by any account.
- **FR-018**: Debt figures MUST be derived from the records, never from stored running totals.
  Each record counts at its own time: a fine at its assessment time, an adjustment at its
  adjustment time, a payment and its allocations at the payment time (allocations are written
  in the same transaction as their payment).
  - *Cumulative balance as of instant T* (records with time ≤ T), per reader or overall:
    net assessed(T) = Σ assessed + Σ adjustments; collected(T) = Σ payment amounts =
    Σ allocations (by FR-016a); outstanding(T) = net assessed(T) − collected(T), with each
    fine's remaining balance ≥ 0. The identity *net assessed = collected + outstanding* holds
    **only** for these cumulative balances.
  - *Period report for `[A, B)`* MUST show separately: opening outstanding = outstanding(A);
    fines assessed in the period (by assessment time); adjustments in the period (by adjustment
    time); cash collected in the period (by payment time); closing outstanding = outstanding(B).
    The period figures satisfy the roll-forward *closing = opening + assessed in period +
    adjustments in period − collected in period*; they do **not** satisfy
    *assessed in period = collected in period + closing*, because a fine assessed before `A` may
    be paid inside the period and a fine assessed inside it may be paid after `B`.

**Accounts and access control**

- **FR-019**: Supabase Auth manages identity only. System MUST store application accounts with a
  unique Supabase user id, status (`active`, `inactive`) and creation time; no SQL foreign key
  to Supabase's `auth.users` exists (different database). No passwords or tokens are stored.
- **FR-019a [API]**: The server MUST verify the Supabase access token before touching library
  data and MUST take the user id only from the verified token; ids supplied elsewhere in the request MUST
  be ignored. Accounts deleted or banned in Supabase MUST be set `inactive`, keeping history.
- **FR-020**: System MUST store roles and permissions (unique codes) and many-to-many
  assignments of accounts to roles and roles to permissions. Every operation procedure MUST
  authorize its acting account from these tables (FR-026); **[API]** the server passes only the
  account id taken from a verified token. Supabase profile data and row-level security MUST NOT
  grant library permissions. Minimum permissions: `catalog.write`, `catalog.import`,
  `card.manage`, `loan.checkout`, `loan.return`, `loan.renew`, `fine.collect`, `policy.manage`,
  `role.manage`, `report.read`, `fine.adjust`; **[Ext]** `reservation.manage`.

**Integrity and history**

- **FR-021**: System MUST reject records referencing non-existent related records, and MUST NOT
  cascade-delete loans, loan items, renewals, reservations, fines, adjustments, payments or
  allocations when a related record is removed or deactivated.
- **FR-022**: Times MUST be recorded in UTC with millisecond precision; calendar-day rules (due
  date, days late, policy boundaries in examples) use the library's local time zone
  (Asia/Ho_Chi_Minh). Money MUST be whole Vietnamese đồng.
- **FR-023**: Each primary entity (book, copy, author, publisher, category, reader, card, policy
  version, loan, loan item, renewal, reservation, fine, adjustment, payment, account, role,
  permission, external reference, identifier) MUST have a stable system-generated identifier.
  Pure junction relations (book–author, book–category, account–role, role–permission,
  payment–fine allocation) MAY use a composite key of their two references instead.
  Books, copies, readers, cards, loans, fines and payments MUST record creation time.

**Database operations, functions and cursors**

- **FR-026**: Every [Core] operation that changes circulation, policy, card or money state MUST
  be a stored procedure, and it is the only way the application's database account can make
  that change. The procedures are:
  - **[Core]**: create/close policy version, issue card, set card status, register copy, change
    copy status, checkout, return item, declare lost, renew, record payment, adjust fine.
  - **[Ext]**: reserve, cancel reservation, expire holds.

  Each procedure MUST:
  - take the acting account id and the current time as parameters;
  - check that the account is `active` and has the required permission (else `FORBIDDEN`);
  - run in its own transaction, acquiring locks as in the Concurrency Protocol;
  - roll back the whole transaction on any error, then re-raise the error with a stable error
    key (e.g. `COPY_NOT_AVAILABLE`, `LIMIT_REACHED`);
  - be called on a connection with no open transaction.

  The application account MUST have no direct INSERT/UPDATE/DELETE privilege on
  `book_copies`, `library_cards`, `loan_policies`, `loans`, `loan_items`, `loan_renewals`,
  `reservations`, `fines`, `fine_adjustments`, `fine_payments` or `fine_payment_allocations`.
  Catalog records (books, authors, publishers, categories, identifiers, external references),
  readers, accounts and role assignments have no cross-row rules beyond DB constraints and MAY
  be written directly.
- **FR-027**: The database MUST provide stored functions for the shared calculations, used by
  the procedures, views and reports: due time from borrow time and loan days (FR-011); days late
  (FR-015a); late fee with cap (FR-015a); fine remaining balance; reader outstanding debt as of an
  instant (FR-018); and whether an account holds a permission.
- **FR-028**: The database MUST provide cursor-based batch procedures:
  - **[Core]** expire cards: sets `active` cards whose expiry has passed to `expired`, one
    reader at a time, in lock order.
  - **[Ext]** expire holds (FR-014c).
- **FR-030**: No environment-specific name or secret may be fixed in code, Docker files,
  migrations or scripts.
  - The configuration MUST use a minimal set of variables with no project prefix: `DB_HOST`,
    `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (app account) and `MYSQL_ROOT_PASSWORD`
    (owner = MySQL root). The only optional variable is `GOOGLE_BOOKS_API_KEY`, used by the
    one-off fetch script.
  - Spec 002 (API) adds `NEXT_PUBLIC_SUPABASE_URL` (required by the API's authenticated routes; the
    token issuer and signing-key set are derived from it) and the optional `AUTH_HOOK_SECRET`
    (the secret Supabase generates for the Before User Created hook; it cannot be derived), and
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the project's publishable key, which the Supabase client needs to
    finish the auth callback/confirm redirects; it cannot be derived from the URL). The two Supabase names carry
    Next's `NEXT_PUBLIC_` framework prefix (the browser client needs them), which is not a project
    prefix. Spec 002 validates the app's variables with `@t3-oss/env-nextjs` in `src/env.ts`.
  - Derived values MUST NOT become new variables: the test schema is `${DB_NAME}_test`, and
    the MySQL image version is pinned in the compose file.
  - `.env.example` MUST provide generic, project-neutral defaults, and anyone MUST be able to
    change them and still run Docker, migrations, seed and tests.
  - Migrations use unqualified object names and never name an account. Account grants are
    applied by a versioned grants script that reads the account name from the environment.
  - Adding a new variable requires updating this requirement.
- **FR-029**: A fresh local MySQL 8.4 Docker container with all migrations applied MUST contain
  every object above and pass the invariant suite on an empty database.

**Deliverables**

- **FR-024**: The team MUST produce:
  - a conceptual ERD in Chen notation;
  - a crow's-foot relational diagram;
  - an ERD-to-relational mapping table;
  - the data dictionary (predicate, attributes, keys, constraints per relation);
  - this spec's Rule Enforcement Matrix with test results.

  The relational diagram MUST be kept as a source file in the repository and MUST match the
  migrated schema. Both diagrams MUST be exported as images for the report.
- **FR-025**: Sample data MUST cover: a multi-author, multi-category book; a multi-copy book; two
  editions with the same title; books missing ISBN or cover; one reader with several loans; one
  loan with several items; on-time, overdue, renewed, damaged, lost and late-and-lost items; a
  checkout just before a policy version ends; partial payment across two fines; a fine assessed
  in one month and paid in the next; an expired card.
  an adjustment; **[Ext]** a reservation queue with an expired hold and an ineligible head.
- **FR-025a**: Sample book metadata MUST come from a reviewed, committed static data file. A
  one-off script fetches it once from Google Books; each record keeps its provider, volume id and
  fetch time and is loaded into `book_external_refs`, and the team fixes or rejects wrong
  editions before committing. Seeding runs only on an empty schema (or after an explicit reset)
  so that every run gives the same result. Some books MUST be entered by hand, including books
  without an
  ISBN or cover. Seeding MUST NOT call Google Books and MUST give the same result on every run.
- **FR-025b**: Copies, cards, policy versions, loans, returns, renewals, fines and payments in the
  sample data MUST be created by calling the operation procedures (FR-026) with explicit times,
  so the sample history passes the same rules as live data. Only catalog and reference data
  (books, authors, categories, identifiers, external references, reader types, roles,
  permissions, readers, accounts) MAY be inserted directly.

### Lifecycles

**Copy circulation status** (FR-006a). "lendable" means `available` in [Core]; with [Ext]
reservations it means "run promotion" (`on_hold` for the next eligible reader, else `available`).

| From | To | Event | Conditions | Tier |
| --- | --- | --- | --- | --- |
| (new) | lendable | Copy registered | Condition not `damaged` | Core |
| (new) | `in_repair` | Copy registered damaged | Condition `damaged` | Core |
| `available` | `on_loan` | Checkout | FR-009d | Core |
| `available` | `in_repair`, `retired` | Librarian action | — | Core |
| `on_loan` | lendable | Return, not damaged | Loan item → `returned` | Core |
| `on_loan` | `in_repair` | Return, damaged | Loan item → `returned`; damaged fine | Core |
| `on_loan` | `lost` | Lost declared | Loan item → `lost`; late + lost fines | Core |
| `in_repair` | lendable, `retired` | Repair done / write-off | Condition updated first | Core |
| `lost` | lendable, `in_repair`, `retired` | Found / write-off | Loan item stays `lost` | Core |
| `on_hold` | `on_loan` | Checkout by holder | Reservation → `fulfilled` | Ext |
| `on_hold` | lendable | Hold expired or cancelled | Promotion re-run | Ext |
| `retired` | — | Terminal | — | Core |

**Loan item**: `on_loan → returned | lost` (terminal). Renewal keeps `on_loan`.

**Reservation [Ext]**: `waiting → ready | cancelled`; `ready → fulfilled | expired | cancelled`
(terminal: `fulfilled`, `cancelled`, `expired`).

### Invariants (reconciliation query suite; MUST return zero rows)

- **I-1**: Copy `on_loan` ⇔ exactly one `on_loan` loan item for that copy.
- **I-2 [Ext]**: Copy `on_hold` ⇔ exactly one `ready` reservation assigned to it, for its book.
- **I-3 [Ext]**: A book with a `waiting` reservation has no `available` copy.
- **I-4**: Loan `open` ⇔ at least one of its items is `on_loan`.
- **I-5**: Each fine: 0 ≤ Σ allocations ≤ net amount (assessed + adjustments).
- **I-6**: Each payment: Σ allocations = amount; every allocation's fine belongs to the payment's
  reader.
- **I-7**: Copy condition `damaged` ⇒ status ∉ {`available`, `on_hold`, `on_loan`}.
- **I-8**: At most one `active` card per reader; no two versions overlap for one policy pair.
- **I-9**: Every loan item's borrow time lies within its policy version's period.

### Concurrency Protocol

**Global lock order.** Every write transaction acquires row locks only in this order, and within
one kind in ascending id (reservations: ascending `(requested_at, id)`):

reader type → reader → card → book → copy → policy version → loan → loan item → reservation →
fine

All locks are `SELECT … FOR UPDATE` unless marked (S) = `FOR SHARE`. Any check that decides a
write is a locking read taken after the locks above it. No transaction waits for user input.

| Flow | Tier | Lock sequence | Then writes |
| --- | --- | --- | --- |
| Checkout | Core | reader → reader's cards (S) → books → copies → policy version (S) → [Ext] holder's reservation; eligibility reads (S) on the reader's open items and fines | loan, loan items, copies `on_loan`, [Ext] reservation `fulfilled` |
| Return / lost | Core | reader of the loan → book → copy → loan → loan item → [Ext] book's waiting reservations | loan item, loan status, fines, copy status (+ promotion) |
| Renew | Core | reader → book → loan item | loan item due/count, renewal |
| Card issue / status | Core | reader → reader's cards | card |
| Policy create / close | Core | reader type → versions of the pair | version(s) |
| Copy maintenance (repair done, found, retire) | Core | book → copy → [Ext] waiting reservations | copy (+ promotion) |
| Payment (procedure) | Core | reader → fines (ascending id) | payment, allocations |
| Import | API | no row locks; UNIQUE(provider, external id) decides; loser re-reads | book, related rows, reference |
| Reservation create | Ext | reader → book → copies (S) | reservation |
| Reservation cancel | Ext | reader → book → copy (if ready) → book's reservations | reservation (+ promotion) |
| Hold expiry (one transaction per reservation) | Ext | book → copy → book's reservations | reservation, copy (+ promotion) |
| Adjustment (procedure) | Core | reader → fine | adjustment |

This lock order is a **convention that reduces deadlock risk**, not a proof that deadlocks
cannot happen. The table lists only the explicit locking reads; InnoDB also takes locks
implicitly: `INSERT`/`UPDATE`/`DELETE` on rows and secondary/unique indexes (including
duplicate-key checks and generated-column unique keys), FK checks on parent rows, reads and
writes inside triggers and procedures, and next-key/gap locks on index ranges. These can still
form wait cycles. Correctness therefore relies on the rollback-and-retry rules below plus the
concurrency tests and invariant suite, not on the lock order alone.

Each flow above is one operation procedure (FR-026).

**Rollback and retry.**

- On deadlock (MySQL error 1213) InnoDB rolls back the whole transaction. On lock wait timeout
  (error 1205) InnoDB rolls back only the failed statement by default, so each procedure's error
  handler MUST issue `ROLLBACK` for the whole transaction before re-raising the error.
- The caller then retries the whole call from the beginning, up to 3 attempts with a random
  50–200 ms back-off, only for errors 1213 and 1205. In spec 001 the caller is the test harness
  and seed script; **[API]** later it is the API. Business rejections ("copy not available",
  "limit reached") are never retried. After the last attempt the caller reports "busy, please
  retry".
- The calling session's lock wait timeout is 5 seconds.
- Retrying is safe because nothing from a rolled-back attempt persists; for payments the
  request key (FR-016b) also covers a retry after a commit whose response was lost.

**Concurrency tests.** Two real database sessions call the procedures at the same time. A third
"gate" session first holds the lock on the first contested row, so both calls start and queue
before either can proceed; the gate then releases. Each test MUST run 20 times,
followed by the invariant suite. CT-4 to CT-6 and CT-9 to CT-13 interleave *different* flows.

| ID | Tier | Flows interleaved | Expected |
| --- | --- | --- | --- |
| CT-1 | Core | checkout × checkout, same copy | One loan item; loser gets "not available"; no empty loan |
| CT-2 | Core | checkout × checkout, same reader at limit − 1, different copies | Exactly one succeeds |
| CT-3 | Core | multi-copy checkout {A,B} × {B,A}, different readers | No deadlock reaches the caller after retries; each overlapping copy won by one side, all-or-nothing |
| CT-4 | Core | return (assesses late fine) × checkout by the same reader near debt threshold | Same as some serial order: checkout rejected if the fine committed first |
| CT-5 | Core | return × lost declaration, same loan item | Exactly one terminal state; fines match it |
| CT-6 | Core | checkout × policy close at the boundary | Loan item references a version containing its borrow time (I-9) |
| CT-7 | Core | payment × payment, same fine, beyond its balance | One succeeds; I-5, I-6 hold |
| CT-8 | Core | card issue × card issue, same reader; policy create × create, same pair | One succeeds in each pair |
| CT-9 | Ext | checkout by holder × hold expiry, same reservation | Either `fulfilled` + `on_loan`, or `expired` + promoted; never both |
| CT-10 | Ext | return (promotion) × cancel of the queue head | I-2, I-3 hold |
| CT-11 | Ext | return of last loaned copy × new reservation, same book | I-3 holds; reservation either held or rejected |
| CT-12 | Ext | renewal × new reservation, same book | Renewal succeeds only if it serialized before the reservation |
| CT-13 | Core | payment × adjustment, same fine | I-5 holds |

**Reservation schema test** (Core, no reservation workflow): **RS-1** as owner, insert
reservations directly and confirm the database rejects:
- a second `waiting`/`ready` row for the same reader and book (R-14a);
- a `ready` row without an assigned copy or hold expiry (R-14b);
- a `ready` row whose copy belongs to another book (R-14c);
- two `ready` rows for one copy (R-14d).

**Bypass tests** (single session, raw SQL instead of the procedures): **B-1** direct insert of a second
`on_loan` item for one copy → rejected. **B-2** application account inserts into payments or
allocations, or into `loans`/`loan_items` → permission denied. **B-3** direct update of a policy version's fee → rejected.
**B-4** update or delete of any money row → rejected. **B-5** illegal copy status transition
(e.g. `lost` → `on_loan`) → rejected.

### Rule Enforcement Matrix

Mechanism types:

- **DB**: PK / FK / UNIQUE / CHECK. Holds for every writer.
- **DB-derived**: UNIQUE index on a generated column that is NULL when the rule does not apply
  (MySQL has no partial indexes). Holds for every writer.
- **Trigger**: BEFORE INSERT/UPDATE/DELETE trigger that raises an error. Holds for every writer,
  but reads inside a trigger are snapshot reads, so a trigger is never the concurrency control.
- **Procedure**: the rule is checked inside an operation procedure's transaction following the
  Concurrency Protocol. The application account cannot skip it because it has no direct write
  privilege on the tables involved (FR-026); privileged accounts can, and the invariant suite
  detects that.

| ID | Tier | Rule | Mechanism | Detail | Test |
| --- | --- | --- | --- | --- | --- |
| R-01 | Core | Barcode unique | DB | UNIQUE(barcode) | US1-3 |
| R-02 | Core | No orphans; no history cascade | DB | FKs ON DELETE RESTRICT | US1-2, US5-4 |
| R-03 | Core | Import idempotent | DB | UNIQUE(provider, external_id); loser re-reads | US1-6 |
| R-06a | Core | Damaged ⇒ not lendable (I-7) | DB | CHECK on copy row | US1-9 |
| R-06b | Core | Allowed copy transitions | Trigger | BEFORE UPDATE checks (old, new) pair | US3-10, B-5 |
| R-08a | Core | Card number unique | DB | UNIQUE(card_number) | US2-9 |
| R-08b | Core | Expiry after issue | DB | CHECK(expires_at > issued_at) | US2-7 |
| R-08c | Core | ≤ 1 active card per reader | DB-derived | UNIQUE on reader id if active else NULL | US2-2, US2-3, CT-8 |
| R-09a | Core | No overlapping versions | Procedure (+ Trigger guard) | Lock reader type, check, write | US2-4, CT-8 |
| R-09b | Core | `valid_to` > `valid_from` | DB | CHECK | US2-4 |
| R-09c | Core | Business values immutable; `valid_to` only set or moved earlier | Trigger | BEFORE UPDATE | US2-5, US2-8, B-3 |
| R-09d | Core | Referenced version not deletable | DB | FK ON DELETE RESTRICT | US2-6 |
| R-09e | Core | Close not retroactive; after every referencing borrow | Procedure | Lock version; compare with now and max borrow time | US2-8 |
| R-09f | Core | Borrow time within version period (I-9) | Procedure | Version read FOR SHARE at checkout | US2-10, CT-6 |
| R-10a | Core | Loan `closed` ⇔ no open items (I-4) | Procedure | Loan locked by return/lost | US3-13 |
| R-11a | Core | Loan item snapshot immutable | Trigger | BEFORE UPDATE | US3-4 |
| R-11b | Core | Time and status consistency | DB | CHECKs on loan item row | US3-11, US3-13 |
| R-11c | Core | Loan item transitions terminal | Trigger | BEFORE UPDATE | US3-13 |
| R-12a | Core | ≤ 1 open loan item per copy | DB-derived | UNIQUE on copy id if `on_loan` else NULL | US3-2, B-1 |
| R-12b | Core | Concurrent checkout; limits; all-or-nothing | Procedure | Checkout lock sequence | US3-1, US3-3, US3-12, US3-16, CT-1–CT-4 |
| R-12c | Core | Copy status ↔ open loan (I-1) | Procedure + Trigger guard | Copy lock; trigger blocks leaving `on_loan` while an item is open | US3-10, CT-5 |
| R-13a | Core | Renewal rules; new due > old due | Procedure + DB CHECK | Renew lock sequence; CHECK on renewal row | US3-5, US3-6 |
| R-14a | Core schema | ≤ 1 active reservation per reader/book | DB-derived | UNIQUE(reader, book, flag) | US3-14, RS-1 |
| R-14b | Core schema | `ready` ⇒ copy + expiry | DB | CHECK | US3-7, RS-1 |
| R-14c | Core schema | Held copy belongs to the book | DB | Composite FK (copy, book) | US3-7, RS-1 |
| R-14d | Core schema | Copy held by ≤ 1 ready reservation | DB-derived | UNIQUE on copy if ready else NULL | US3-8, RS-1 |
| R-14e | Ext | Promotion, expiry, ineligible head | Procedure | Promotion lock sequence | US3-7, US3-8, US3-15, CT-9, CT-10 |
| R-14f | Ext | Only holder borrows held copy | Procedure | Checked under copy lock | US3-9, CT-9 |
| R-14g | Ext | Reservation preconditions | Procedure | Reservation-create lock sequence | US3-14, CT-11 |
| R-15a | Core | ≤ 1 fine per (item, type) | DB | UNIQUE(loan_item_id, fine_type) | US4-4 |
| R-15b | Core | Not both damaged and lost | Procedure + Trigger guard | Loan item lock | US4-4, CT-5 |
| R-15c | Core | Amounts ≥ 0; reason when assessed ≠ default | DB | CHECK on fine row | US4-10 |
| R-15d | Core | Damaged ≤ replacement cost; late cap | Procedure | Read under loan item lock | US4-10 |
| R-16a | Core | Allocation > 0; PK(payment, fine) | DB | CHECK, composite PK | US4-6 |
| R-16b | Core | Σ allocations = payment amount | Procedure | Sum re-checked before COMMIT; error ⇒ rollback | US4-5, US4-6, US4-13, B-2 |
| R-16c | Core | Allocation ≤ fine remaining | Procedure (+ Trigger guard) | Fines locked in id order | US4-6, CT-7 |
| R-16d | Core | Fine belongs to payer | Procedure | Checked under locks | US4-6 |
| R-16e | Core | No duplicate payment on retry | DB | UNIQUE(request_key) | US4-12 |
| R-17a | Core | Net ≥ allocated ≥ 0 after adjustment | Procedure (+ Trigger guard) | Fine locked | US4-8, CT-13 |
| R-17b | Core | Money rows append-only | Trigger | Reject UPDATE/DELETE | US4-11, B-4 |
| R-19a | Core | One account per Supabase user | DB | UNIQUE(supabase_user_id) | US5-1 |
| R-19b | API | Verified identity | Server | Token verification | US5-2, US5-3, US5-5 |
| R-20 | Core | Acting account active and authorized | Procedure | Permission function checked first in every operation procedure | US5-6 |
| R-26 | Core | Circulation and money tables written only by procedures | DB privileges | App account lacks INSERT/UPDATE/DELETE on those tables | B-2 |

### Key Entities

- **Material type**: kind of library material (printed book first); determines applicable policy.
- **Publisher**: organisation publishing editions.
- **Author**: person or organisation credited on books; ordered per book (junction, composite key).
- **Category**: subject classification, optionally hierarchical (junction to book, composite key).
- **Book**: one catalogued edition owned by the library.
- **Book identifier**: typed identifier (ISBN-10, ISBN-13, other) for a book.
- **External reference**: a provider record linked to a book: raw metadata snapshot and dated
  view rights; never a source of inventory.
- **Copy**: one physical item with barcode, location, condition and circulation status.
- **Application account**: the library's record of a Supabase user; referenced by staff actions.
- **Role / Permission**: security groupings (junctions with composite keys); unrelated to
  reader type.
- **Reader type**: borrowing category (student, lecturer, external).
- **Reader**: a borrower profile; optionally linked to one account.
- **Library card**: numbered card with validity period; at most one active per reader.
- **Loan policy version**: immutable borrowing rules per reader type × material type, in effect
  for checkouts within its period.
- **Loan**: one checkout session for a reader; has one or more loan items.
- **Loan item**: one copy borrowed within a loan, with due/return data and applied-policy snapshot.
- **Renewal**: one extension of a loan item's due time.
- **Reservation** [Ext workflow]: a reader's queued request for a book; may hold one copy while
  `ready`.
- **Fine**: an amount owed for one loan item (late, damaged, lost).
- **Fine adjustment**: an audited, signed correction to a fine.
- **Payment**: money received from a reader, fully allocated, identified by a request key.
- **Payment allocation**: portion of a payment applied to one fine (junction, composite key).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the entities listed in Key Entities appear in the Chen ERD, the mapping
  table, the relational diagram and the data dictionary, each with a predicate, keys and
  cardinalities; the relational diagram shows 0 differences from the migrated schema.
- **SC-002**: 100% of [Core] and "Core schema" rows in the Rule Enforcement Matrix have a
  passing test in which an invalid write is rejected (or, for concurrency rows, the expected
  single outcome occurs). "Core schema" rows are tested by direct writes, without reservation
  workflows. [Ext] rows pass for every [Ext] feature the team builds.
- **SC-003**: [Core] concurrency tests CT-1…CT-8 and CT-13, and bypass tests B-1…B-5, each pass
  20 out of 20 runs; built [Ext] tests CT-9…CT-12 likewise.
- **SC-004**: The sample dataset contains at least 30 books, 60 copies, 20 readers across at
  least 3 reader types, and every [Core] scenario in FR-025.
- **SC-005**: The invariant suite returns zero violations on the sample dataset and after every
  acceptance and concurrency test.
- **SC-006**: For every reader, at the end of every month in the sample data, cumulative net
  assessed = cumulative collected + outstanding; and for every month the roll-forward
  closing = opening + assessed + adjustments − collected holds; zero discrepancies in both.
- **SC-007**: Closing a policy version and creating a new one after sample loans exist changes 0
  existing loan items; re-running the same import creates 0 duplicate books or references.
- **SC-008**: A reviewer unfamiliar with the project can answer "who borrowed copy X, when was
  it due, and what do they still owe?" from the model in under 5 minutes.

## Assumptions

- Single library branch; location is a shelf code on each copy (no branch entity at launch).
- Printed books are the only material type populated at launch.
- Staff and readers share one account table; a staff member who borrows also has a reader profile.
- Spec 001 delivers the database only. The API, UI, Supabase sign-in and the Google Books client
  are later features ([API] items); they call the operation procedures rather than writing the
  circulation and money tables.
- Development and tests use MySQL 8.4 in a local Docker container, started by one compose
  command, with a named volume for data. All names and credentials come from environment
  variables (FR-030).
- Requires MySQL 8.0.16 or later (CHECK constraints are ignored in earlier versions; JSON_TABLE
  for the allocation list needs 8.0.4+). Exact syntax for generated-column unique keys, triggers
  and the procedure will be verified on the deployed version in the plan.
- I-1 could alternatively be enforced with a current-loan pointer column on copies; the plan may
  choose it and prove it with the same tests. The rules do not change.
- The checklist validates documentation completeness only; it does not prove the MySQL
  mechanisms work. The plan MUST therefore (a) start with an early spike on the exact MySQL
  version to be used (the Docker image), covering: a procedure receiving an allocation list,
  a procedure's error handler rolling back and re-raising, a stored function, a cursor loop,
  generated-column unique indexes, CHECK constraints, BEFORE triggers raising errors, and an
  application account restricted to `EXECUTE` on procedures for the circulation and money
  tables; and (b) order the work so all [Core] items are built, tested and demonstrable before
  any [Ext] item starts.
- Unless the team decides otherwise, the defaults below apply.

### Open Decisions (defaults applied; team to confirm)

- **D1 Policy numbers**: resolved — the team accepted the seed values in research.md R13
  (STUDENT 5 items / 14 days / 2 renewals / 2,000 VND per day / 50,000 debt block / 1-year card;
  LECTURER 10 / 30 / 3 / 1,000 / 100,000 / 2 years; EXTERNAL 3 / 7 / 1 / 5,000 / 0 / 6 months;
  plus a second STUDENT version from 2026-10-01: 7 days, 5,000 VND per day).
- **D2 Late fine cap**: default capped at the book's replacement cost when known.
- **D3 Damaged fine**: default librarian-entered, 0 to replacement cost, reason required
  (alternative: fixed percentage of replacement cost).
- **D4 Hold window and ineligible queue head [Ext]**: default hold window 3 days. At promotion,
  hard-ineligible readers (not `active`, or no valid card) are cancelled and skipped;
  soft-ineligible readers (debt, overdue, at limit) are given the hold and expire if they do not
  resolve it and collect within the window.
- **D5 Renewal**: default new due = old due + applied loan days; overdue items cannot be renewed.
- **D6 Reservation preconditions [Ext]**: default only when no copy is `available` and the reader
  has no copy of that book on loan.
- **D7 Overdue blocks checkout**: default yes, any overdue item blocks new checkouts.
- **D8 Debt basis**: default only assessed fines count towards debt; late fees on unreturned items
  are not counted until assessed at return or lost declaration.
- **D9 Lost-then-found**: default loan item stays `lost`; the unpaid part of the lost fine may be
  reduced by an adjustment; refunds out of scope.
- **D10 MySQL version**: resolved — the lecturer sets no version requirement; the project uses
  the current MySQL 8.4 LTS Docker image. Triggers, functions, procedures and cursors are
  included regardless (Clarifications 2026-09-24).
- **D11 Payment write path**: resolved — the record-payment procedure is the only path, with the
  application account denied direct writes (FR-016a, FR-026; Clarifications 2026-09-24).
- **D12 Extension commitment**: the only [Ext] item in spec 001 is reservations and holds.
  Adjustments moved to [Core]; import refresh with accept and online preview are [API].
- **D13 Multi-copy checkout**: default all-or-nothing; if any copy fails a check, nothing is
  written.
