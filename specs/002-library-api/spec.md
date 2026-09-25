# Feature Specification: Library API Contract and Server Routes

**Feature Branch**: `002-library-api`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Define API contract and implement api route with hono base on spec 001 and @ARCHITECTURE.md we have"

## Context

Spec 001 delivered the library database: tables, constraints, triggers, functions, stored
procedures, cursor batches, report procedures and invariant views. It tagged a set of items
**[API]** and left them to "the later API feature". This is that feature. It exposes the
library to its users through one server-side HTTP interface, described by a shared typed contract,
so the web UI (a later feature) and testers can use the library without touching the database.

The interface adds no new business rule. Every rule that spec 001 enforces in the database stays
there; the interface verifies who is calling, checks privileged reads, turns database outcomes
into documented responses, and carries out the [API] items of spec 001: token verification
(FR-019a, R-19b) and server-side request handling. The Google Books import, refresh-with-accept
and online preview workflows (spec 001 FR-004b/c/d) are **out of scope** and move to spec 003.

> Stack note: at the team's request this spec names the target stack, as spec 001 does. The
> routes are built with the Hono framework, mounted inside the existing Next.js 16 app (App
> Router, `src/` layout), and identity comes from Supabase Auth with Google sign-in. Success
> criteria stay technology-agnostic.

## Clarifications

### Session 2026-09-25

- Q: May anonymous visitors use the catalog (A1)? → A: Yes, but only to view and search books
  (with availability counts). Everything else requires sign-in.
- Q: How are library accounts created (A2)? → A: Users sign in with Google through Supabase.
  A new user gets a library account with the `reader` role. The team asked to check whether a
  Supabase hook can insert the records into the Docker MySQL database. Findings (Supabase Auth
  Hooks docs, 2026-09-25):
  - Supabase offers a **Before User Created** hook on every plan, including free. It fires for
    every sign-up method, including Google OAuth, and may be a Postgres function or an **HTTP
    endpoint**.
  - A Postgres-function hook runs inside Supabase's own Postgres and cannot reach MySQL. So the
    only way for a hook to write to MySQL is the HTTP form, which calls our own server.
  - The HTTP hook is signed (Standard Webhooks: `webhook-id`, `webhook-timestamp`,
    `webhook-signature`, secret `v1,whsec_…`). It has a 5-second budget, and it retries only on
    429/503.
  - The hook runs *before* the Supabase user row is inserted. If the hook returns an error, or
    cannot be reached, the sign-up is **denied**.
  - Supabase's servers must be able to reach the endpoint on a public URL. A local Docker
    setup is not reachable without a tunnel.
  - The hook fires only for new sign-ups, never for users who already exist in Supabase.

  Decision: account creation is one idempotent "ensure account" step keyed by the Supabase user
  id. The HTTP Before User Created hook calls it when the server has a public URL. The server
  also calls it on every signed-in user's first verified request, which covers local
  development without a tunnel, users created before the hook was enabled, and a hook call
  that failed.
- Q: Should a new user also get a reader profile at first sign-in (A2 follow-up)? → A: Yes. It
  is linked by id only: Supabase `sub` → `app_users.supabase_user_id` → `app_users.id` →
  `readers.user_id`. An account without a reader gets an `active` reader of type **EXTERNAL**,
  prefilled with the Google name and email.
  - Email matching against existing readers (an earlier "option C") was dropped. An unverified
    desk-entered email could link the wrong person's profile.
  - Existing desk profiles are linked by a librarian after checking identity.
- Q: May users sign in with email/password too? → A: Yes. Google and Supabase email/password are
  both accepted in every environment, which allows many independent test accounts
  (`account+<role>@gmail.com`). Other providers (GitHub, anonymous, …) are still refused.
- Q: Does the API need auth routes of its own? → A: Only two redirect targets: the OAuth
  callback and the email-link confirm. They receive the redirect from Supabase and verify it.
  There are no sign-in or sign-out endpoints: the UI starts the Google sign-in and signs out
  with the Supabase client.
- Q: Is the Google Books import part of this feature (A3)? → A: No. Import, refresh-with-accept
  and preview move to spec 003.
- Q: Must the contract be an OpenAPI document in the MVP? → A: No. The UI lives in the same
  repository, so the contract is a shared set of typed definitions (request inputs, response
  shapes, error keys) that the server uses and the UI imports directly. No OpenAPI document or
  docs page is produced in this feature; one can be generated later from the same definitions.

Actors (as in spec 001): **Librarian**, **Admin**, **Reader**, plus **Anonymous visitor** (not
signed in) and **Client developer** (builds the UI or tests against the contract).

Report chapters evidenced (constitution VII): **Ch.4** (security: verified identity, RBAC
enforced by server and database, the app account's restricted privileges in practice;
application of the procedures, reports with EXPLAIN reached through the interface).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verified identity and a shared typed contract (Priority: P1)

Every request that touches library data is tied to one verified library account, and every
operation the interface offers is described in one shared typed contract: its inputs, its
successful result and every rejection it can return. A client developer can build against the
contract alone, and a caller can never act as someone else.

**Why this priority**: Nothing else is safe to expose until identity is verified and the shape
of every request and response is fixed. The contract is also the user's first explicit ask.

**Independent Test**: With only this story built, call a "who am I" operation and one privileged
operation with (a) no token, (b) an invalid or expired token, (c) a valid token of an account
without the permission, (d) a valid token plus a body claiming another user, (e) a valid staff
token; check each outcome against the contract definitions.

**Acceptance Scenarios**:

1. **Given** a request with no token, or an invalid, expired or unverifiable token, **When** it
   asks for any non-public operation, **Then** it is rejected as unauthenticated and no library
   data is read or written (spec 001 US5-3).
2. **Given** a valid token for user X and a request naming user Y as the actor, **When** it is
   processed, **Then** it never acts as Y (US5-2). An actor or time field in a JSON body is
   rejected as `VALIDATION`. Unknown query parameters and headers are ignored. The acting
   account is always X.
3. **Given** a user whose identity-provider profile metadata claims role "admin", **When** they
   call an admin operation, **Then** it is rejected, because roles come only from the library
   database (US5-5).
4. **Given** a verified user signing in for the first time, **When** they call "who am I",
   **Then** a library account is created for them, active, with the `reader` role and no staff
   permission, and the response lists their roles, permissions and linked reader profile (none
   yet).
4a. **Given** the sign-up hook is enabled and a new user signs up with Google, **When** Supabase
   calls the hook with a valid signature, **Then** the library account (active, `reader` role)
   exists before the user's first request. A second delivery of the same event, or the later
   first request, creates nothing new.
4b. **Given** a hook call with a missing, wrong or expired signature, **When** it arrives,
   **Then** it is refused and nothing is written.
4c. **Given** the hook is disabled or unreachable in local development, **When** a new Google
   user makes their first request, **Then** the account is created at that moment with the same
   result as 4a.
5. **Given** an account marked `inactive`, **When** it calls any operation other than "who am
   I", **Then** it is rejected as forbidden, and its history is untouched.
6. **Given** the shared contract definitions, **When** a server handler reads an input field or
   returns a result field that the definition does not declare, **Then** the project's type
   check fails.
7. **Given** any rejection, **When** the caller receives it, **Then** it has one uniform shape
   carrying the stable rule key (e.g. `COPY_NOT_AVAILABLE`), a human-readable message and the
   detail from the database, and a response category that tells the caller whether retrying
   can help.

---

### User Story 2 - Circulation desk: checkout, return, lost, renew (Priority: P1)

A librarian scans a reader's card and one or more copies and lends them in one step; later
receives returns (with condition and optional damage fine), declares items lost, and renews
items. Each outcome, including every refusal reason, reaches the librarian as a clear message.

**Why this priority**: Circulation is the core value of the system and the core technical
claim of spec 001; exposing it proves the database work end to end.

**Independent Test**: With seeded data, run the spec 001 circulation scenarios (on-time return,
overdue return with fine, renewal success and each renewal refusal, damage, loss, expired card,
limit exceeded, debt block) through the interface only, and compare results with the procedure
outcomes recorded in spec 001.

**Acceptance Scenarios**:

1. **Given** an eligible reader and two available copies, **When** the librarian checks out
   both in one request, **Then** one loan with two items is created and the response lists each
   item with its due time.
2. **Given** one of three requested copies is on loan, **When** the librarian checks out all
   three, **Then** nothing is lent and the response names `COPY_NOT_AVAILABLE` (all-or-nothing,
   spec 001 D13).
3. **Given** a reader whose card has expired, whose debt exceeds the threshold, who has an
   overdue item, or who is at the item limit, **When** a checkout is attempted, **Then** the
   response carries `CARD_INVALID`, `DEBT_BLOCKED`, `OVERDUE_BLOCKED` or `LIMIT_REACHED`
   respectively and nothing is written.
4. **Given** an overdue item, **When** it is returned in good condition, **Then** the item is
   closed and the response lists the late fine that was assessed.
5. **Given** an item returned damaged with a damage fine and reason, **When** the return is
   recorded, **Then** the response lists the damage fine, and the copy is shown as in repair.
6. **Given** an item at its renewal limit, overdue, or whose book has a waiting reservation,
   **When** renewal is requested, **Then** the response carries `RENEWAL_REJECTED` with the
   reason (`limit`, `overdue`, `reserved`, `not_on_loan`).
7. **Given** two librarians check out the same copy at the same moment, **When** both requests
   finish, **Then** exactly one succeeds and the other receives `COPY_NOT_AVAILABLE`.
8. **Given** the database is briefly busy (lock wait or deadlock) on every allowed attempt,
   **When** a circulation request finishes, **Then** the librarian receives a "busy, please
   retry" outcome, distinct from a business refusal, and nothing was written.
9. **Given** a librarian account without `loan.checkout`, **When** it attempts a checkout,
   **Then** it receives `FORBIDDEN` and nothing is written.

---

### User Story 3 - Catalog and copies (Priority: P1)

Anyone can search and browse the catalog (title, author, category, identifier) and see how many
copies of each book are available. A librarian creates and edits books, authors, publishers,
categories and identifiers, registers physical copies with barcodes, and changes a copy's
maintenance status (to repair, repair done, found, retired).

**Why this priority**: Circulation needs books and copies to exist; the catalog is also the
only part of the library a visitor sees without signing in.

**Independent Test**: As an anonymous visitor, search by title and by author and open a book;
as a librarian, create a book with two authors and no ISBN, register two copies, send one to
repair, and see the availability figures change.

**Acceptance Scenarios**:

1. **Given** the seeded catalog, **When** an anonymous visitor searches by a word in a title or
   author name, **Then** matching books are returned in pages, each with authors, cover (if
   any), and counts of available and total lendable copies; no reader, loan or money data is
   exposed.
2. **Given** a librarian with `catalog.write`, **When** they create a book with no ISBN, two
   ordered authors and two categories, **Then** the book is stored and returned with those
   relations.
3. **Given** a barcode already used, **When** a librarian registers a copy with it, **Then** the
   response carries `DUPLICATE` naming the barcode rule.
4. **Given** a copy on loan, **When** a librarian tries to send it to repair, **Then** the
   response carries `INVALID_TRANSITION`.
5. **Given** a book with waiting reservations, **When** a librarian registers a new good copy,
   **Then** the response shows the copy as on hold for the first eligible reader.
6. **Given** a reader account without `catalog.write`, **When** it tries to create or edit a
   book, **Then** it receives `FORBIDDEN` and nothing is written.

---

### User Story 4 - Readers, cards and loan policies (Priority: P2)

A librarian registers readers (with reader type and contact data), links a reader profile to a
signed-in account, issues cards and changes card status. An admin creates and closes loan
policy versions and runs the card-expiry batch.

**Why this priority**: Needed before new readers can borrow, but the seed already provides
readers, cards and policies, so circulation can be demonstrated first.

**Independent Test**: Register a reader, link it to a signed-in account, issue a card, mark it
lost, issue a new one; as admin, close the current policy version and create the next one; run
card expiry and read the count.

**Acceptance Scenarios**:

1. **Given** a reader with an active card, **When** a second card is issued, **Then** the
   response carries `DUPLICATE` naming the one-active-card rule.
2. **Given** a card marked lost, **When** anyone tries to reactivate it, **Then** the response
   carries `INVALID_TRANSITION`.
3. **Given** an open policy version, **When** an admin creates an overlapping version without
   closing it first, **Then** the response carries `POLICY_OVERLAP`.
4. **Given** a librarian (no `policy.manage`), **When** they create a policy version, **Then**
   they receive `FORBIDDEN`.
5. **Given** a signed-in account with no reader profile, **When** a librarian links it to an
   existing reader, **Then** the account's "who am I" shows that reader; linking a second
   account to the same reader, or the same account to a second reader, is rejected.

---

### User Story 5 - Fines, payments and adjustments (Priority: P2)

A librarian looks up a reader's fines and outstanding balance, records a payment allocated to
specific fines, and corrects a wrongly assessed fine with a signed, reasoned adjustment. A
payment submitted twice (for example after a network timeout) is recorded once.

**Why this priority**: Money correctness is a core claim of spec 001, but payments follow
circulation in the desk workflow.

**Independent Test**: For a reader with two fines, pay one in full and the other partly;
resubmit the same payment with the same request key; resubmit it with the same key and a
different amount; adjust a fine down; check balances after each step.

**Acceptance Scenarios**:

1. **Given** a reader with fines of 30,000 and 20,000 VND, **When** a payment of 40,000 is
   recorded as 30,000 + 10,000, **Then** the reader's outstanding balance becomes 10,000.
2. **Given** a recorded payment, **When** the same request is submitted again with the same
   request key and the same content, **Then** the response returns the original payment, marked
   as a replay, and no second payment exists.
3. **Given** a recorded payment, **When** a request reuses its key with a different amount,
   reader or allocation, **Then** the response carries `IDEMPOTENCY_CONFLICT`.
4. **Given** allocations that do not add up to the amount, or exceed a fine's remaining balance,
   **When** the payment is submitted, **Then** the response carries `ALLOCATION_MISMATCH` and
   nothing is written.
5. **Given** a fine already partly paid, **When** an adjustment would bring its net amount below
   the paid amount, **Then** the response carries `FINE_RULE`.

---

### User Story 6 - Reader self-service and reservations (Priority: P2)

A signed-in reader sees their own profile, cards, current and past loans with due dates, fines
and outstanding balance, and reservations with their queue status and hold expiry. They can
reserve a book that has no available copy and cancel their own reservation. Staff can reserve and
cancel on a reader's behalf and run hold expiry.

**Why this priority**: Gives readers value without visiting the desk; reservations are [Ext] in
spec 001 and are already built there, so exposing them costs little.

**Independent Test**: Sign in as a seeded reader; list own loans and fines; try to read another
reader's loans; reserve a book with all copies on loan; cancel it; try to cancel another
reader's reservation.

**Acceptance Scenarios**:

1. **Given** a signed-in reader, **When** they list their loans, **Then** only their own loans
   are returned, with due times and any fines.
2. **Given** reader A, **When** A asks for reader B's loans, fines or reservations by id,
   **Then** the response is the same "not found or not allowed" outcome whether or not B's
   record exists, so ids cannot be probed.
3. **Given** a book with an available copy, **When** a reader tries to reserve it, **Then** the
   response carries `VALIDATION` (borrow it instead).
4. **Given** a reader already waiting for a book, **When** they reserve it again, **Then** the
   response carries `DUPLICATE`.
5. **Given** a reader's `ready` hold, **When** they cancel it, **Then** it is cancelled and the
   copy passes to the next waiting reader, visible in that reader's reservations.
6. **Given** a signed-in account with no linked reader profile, **When** it asks for "my
   loans", **Then** it gets an empty result with a hint to register at the desk, not an error.

---

### User Story 7 - Reports, health and administration (Priority: P3)

Staff with `report.read` read the debt reports (cumulative and monthly roll-forward) and the
circulation reports (overdue items, loans per month by reader type, most borrowed books, copies
by status). An admin reads the invariant health check, assigns and removes roles, and
deactivates accounts.

**Why this priority**: Reports and administration are needed for the course report and for
operations, but not for daily circulation.

**Independent Test**: Request the October 2026 roll-forward and check
`closing = opening + assessed + adjusted − collected` for every row; request the copies-by-status
report and check `available + on_loan + on_hold + in_repair + lost + retired = total`; read the
health check on a seeded database (all zero); remove a role and see the permission disappear.

**Acceptance Scenarios**:

1. **Given** a month in library-local time (e.g. `2026-10`), **When** the roll-forward is
   requested, **Then** the period used is that local month converted to UTC, and each row
   satisfies the roll-forward identity (spec 001 SC-006, worked example US4-14).
2. **Given** a librarian without `report.read`, **When** they request a report, **Then** they
   receive `FORBIDDEN`.
3. **Given** a correct database, **When** an admin reads the health check, **Then** every
   invariant (I-1…I-9) reports zero violations.
4. **Given** an admin with `role.manage`, **When** they remove the `librarian` role from an
   account, **Then** that account's next checkout attempt receives `FORBIDDEN`.
5. **Given** an admin deactivates an account, **When** it next calls any operation, **Then** it
   is refused, and every loan it processed still references it (US5-4).

---

### Edge Cases

- A token is valid but its account was deactivated after the token was issued: the request is
  refused as forbidden; the verified identity alone never grants access.
- The identity provider is unreachable when keys must be refreshed: requests needing
  verification are refused with a "service unavailable, retry" outcome, never let through.
- A request body carries fields the operation does not define (e.g. `actorUserId`, `now`,
  `processedBy`): they are rejected as `VALIDATION`, never used.
- A client sends its own clock time: business time is always the server's current UTC instant;
  client-supplied times are accepted only as data fields the contract defines (e.g. a card's
  expiry, a policy's `valid_from`).
- Money sent as a fraction, a negative number or a string: rejected as `VALIDATION` before the
  database is called. Amounts are whole đồng.
- Very large ids, non-numeric ids, empty copy lists, duplicate copy ids in one checkout:
  rejected as `VALIDATION` with the offending field named.
- A database error that is not a business rule (e.g. a CHECK violation or lost connection):
  returned as an internal failure with a correlation id; database messages and internals are
  not shown to the caller.
- A payment request times out on the client and is resent: the same request key makes the
  second call a replay, not a second payment.
- A client requests page 10,000 of a small list: an empty page, not an error.
- Hold expiry fires while a holder is at the desk: the outcome is whatever the database decides
  (spec 001 flow 16); the response reflects it (checkout succeeds or `COPY_NOT_AVAILABLE`).

## Requirements *(mandatory)*

### Functional Requirements

**Contract**

- **FR-001**: The contract MUST be one shared set of typed definitions in the repository that
  describes every operation of the interface: path and method, whether sign-in is required,
  the required permission (or "own records only"), input fields with types and limits, the
  success result, and the rejection keys the operation can return. The UI MUST be able to
  import these definitions directly, without copying them.
- **FR-002**: The server MUST validate inputs and type its responses with these same
  definitions, so the contract and the server cannot drift; a mismatch MUST fail the type
  check.
- **FR-003**: Each operation's access rule and rejection keys MUST be documented next to its
  definition (and summarized in the endpoint catalogue), so a developer can read them without
  reading handler code. A generated OpenAPI document and docs page are out of scope for the
  MVP.
- **FR-004**: All operations MUST live under one versioned base path (e.g. `/api/v1`), so a
  future incompatible change can use a new version.
- **FR-005**: Field names, identifiers, times and money MUST follow one convention throughout:
  ids as integers, times as UTC instants with milliseconds in ISO 8601, money as whole-đồng
  integers, statuses as the lowercase codes of spec 001.

**Identity and access (spec 001 FR-019a, FR-020, R-19b)**

- **FR-006**: Every operation except the public catalog view and search, a liveness check and the sign-up hook endpoint (which is authenticated by its webhook signature,
  FR-008b) MUST require a verified identity-provider access token; the server MUST verify
  signature, issuer, audience and expiry before any library data is read.
- **FR-007**: The acting account MUST be derived only from the verified token's subject. Any
  actor, user id or time supplied in the path, query, header or body MUST be ignored or rejected;
  the server MUST pass only this account id and its own current UTC instant to the database
  operations.
- **FR-008**: Sign-in MUST use Google or email/password through the identity provider (amended
  2026-09-25; it was Google only). Other sign-in methods stay disabled in the provider's settings. A library account MUST be created by one idempotent
  "ensure account" step keyed by the provider's user id. It creates an `active` account and
  assigns the `reader` role in one transaction. Repeating it, or running it concurrently, MUST
  leave exactly one account and one `reader` assignment, and MUST NOT change the status or
  roles of an existing account. The server MUST refuse a token whose sign-in provider (the
  token's provider list) includes neither `google` nor `email`. It is rejected as
  unauthenticated before any account is created, so the rule holds even when the sign-up hook
  is off.
- **FR-008e**: Every account that signs in MUST have exactly one reader profile, linked by id
  (`readers.user_id = app_users.id`, the account found by the token's `sub`).
  - Creating the account, the sign-up hook and the auth callback MUST create an `active` reader
    of type `EXTERNAL` when the account has none. The provider's name and email only prefill it.
  - The system MUST NOT link an existing reader by matching email or any other profile data. A
    librarian links desk-created readers after checking identity.
  - Ordinary API requests of a known account never write.
  - A profile alone does not allow borrowing or reserving: a valid card from the desk is still
    required. A librarian corrects the reader type with the reader update operation.
- **FR-008a**: The "ensure account" step MUST run on the first verified request of an unknown
  subject, and only then. Requests of a known subject read the account without writing. This
  path is always on.
- **FR-008b**: The system MUST also offer a sign-up hook endpoint for the provider's Before User
  Created hook. The endpoint MUST:
  - verify the webhook signature and timestamp before reading the payload, and refuse an
    unsigned, wrongly signed or stale call without writing anything;
  - run "ensure account" for the user id in the payload and answer within the provider's
    5-second budget;
  - answer so that the sign-up is allowed when the account exists or was created, and answer
    "retry later" (not a denial) when the database is briefly unavailable.

  Enabling the hook is a per-environment choice. It needs a public URL and must never be
  enabled for an environment the provider cannot reach, because an unreachable hook denies
  every sign-up.
- **FR-008d**: The system MUST offer the two redirect targets Supabase sends the browser to:
  - **auth callback:** the OAuth PKCE `code` is exchanged for a session;
  - **auth confirm:** an email link's `token_hash` and `type` are verified.

  Both MUST:
  - store the session in cookies with no-cache headers;
  - create the library account of a Google user (FR-008);
  - sign out again and refuse a session from any provider other than Google or email;
  - redirect to a same-site `next` path, never off-site;
  - on any failure, redirect to the auth error page with a reason code.

  Starting a sign-in and signing out are done by the UI with the Supabase client, not by this
  API (Clarification 2026-09-25).
- **FR-008c**: An account created by the hook whose provider sign-up then fails never gets a
  token and so can never act. It is harmless and stays as an unused account row.
- **FR-009**: Authorization MUST come only from the library's roles and permissions. For state
  changes the database operation remains the final check; the server MUST additionally check
  the permission for privileged reads (reports, other readers' records, health check) and for
  catalog and people writes that do not go through a database operation.
- **FR-010**: A reader account MUST see only records of the reader profile linked to it. A
  request for another reader's record MUST return the same outcome as a missing record.
- **FR-011**: An `inactive` account MUST be refused for every operation except "who am I".
- **FR-011a**: When a user is deleted or banned in the identity provider, an admin MUST mark the
  library account `inactive` through the account-status operation (constitution V, spec 001
  FR-019a). The account's history stays unchanged.
  - The operating procedure (delete or ban in the provider, then deactivate in the library) MUST
    be written in the quickstart.
  - Until the admin acts, the user cannot obtain new tokens. A token already issued stays usable
    only until it expires: at most the provider's access-token lifetime, 1 hour by default.
  - Automatic sync would need the provider's service-role key, a new secret variable, so it is
    out of scope.

**Operations exposed**

- **FR-012**: The interface MUST expose every public operation of spec 001, each mapped to its
  database procedure and permission:
  - catalog: register copy, change copy status;
  - people: issue card, set card status, create policy version, close policy version, expire
    cards;
  - circulation: checkout (one or more copies, all-or-nothing), return, declare lost, renew;
  - money: record payment, adjust fine;
  - reservations [Ext]: reserve, cancel reservation, expire holds;
  - reports: cumulative debt, monthly roll-forward.
- **FR-013**: The interface MUST expose catalog management that spec 001 allows as direct
  writes (books, authors, publishers, categories, identifiers, external references), guarded by
  `catalog.write`; people management (readers, account-to-reader link) guarded by
  `card.manage`; role assignment and account deactivation guarded by `role.manage`.
- **FR-014**: The interface MUST expose read operations for: catalog search and book detail with
  copy availability (public); copies of a book; readers (staff); a reader's cards, loans, fines,
  balance, payments and reservations (staff, or the reader themself); policy versions (staff);
  the circulation reports and invariant health check (with `report.read`).
- **FR-015**: Catalog search MUST support search by title/author text, category, identifier
  value and material type, with pagination.
- **FR-016**: Every list that can grow without bound MUST be paginated with a default page size
  of 20 and a maximum of 100, and MUST return the total count. These lists are naturally bounded
  and MAY return all items:
  - categories;
  - reference lists (reader and material types);
  - one book's copies;
  - one reader's cards;
  - the loans-by-month report;
  - the top-N popular books (N ≤ 100).
- **FR-017**: A payment request MUST carry a client-generated request key; the interface MUST
  pass it unchanged to the database and report a replay as a success marked "replayed".
- **FR-018**: Monthly reports MUST accept a library-local month (`YYYY-MM`) and convert it to
  UTC bounds in UTC+07:00 as spec 001 defines.

**Outcomes and errors**

- **FR-019**: Every rejection MUST use one response shape: stable key, message, detail, and for
  validation errors the list of offending fields. Each spec 001 error key MUST map to one
  documented response category:
  - unauthenticated;
  - forbidden (`FORBIDDEN`);
  - not found (`NOT_FOUND`);
  - invalid input (`VALIDATION`);
  - business conflict (every other 45000 key and `DUPLICATE`);
  - busy, retry (deadlock or lock wait after the allowed retries);
  - service unavailable (identity provider unreachable);
  - internal failure.
- **FR-020**: Input MUST be validated against the contract before any database call; invalid
  input MUST never reach a database operation.
- **FR-021**: Retries MUST happen only for deadlock and lock wait timeout, within the existing
  database-call helper; business rejections MUST NOT be retried by the server.
- **FR-022**: Internal failures MUST be logged with a correlation id returned to the caller;
  raw database messages, SQL and stack traces MUST NOT be returned.

**Data path (constitution I, III; spec 001 FR-026)**

- **FR-023**: Every change to circulation, policy, card, reservation or money state MUST go
  through the spec 001 database operation; the interface MUST NOT write those tables directly
  and MUST run with the restricted application database account.
- **FR-024**: A catalog write that spans several rows (a book with its authors, categories and
  identifiers; account creation with its role) MUST be applied in one transaction.
- **FR-025**: Database access, identity verification and provider keys MUST stay on the server;
  no response may contain credentials or provider keys.

**Configuration (spec 001 FR-030)**

- **FR-026**: The feature MAY add only the variables that cannot be derived, each recorded in
  spec 001 FR-030 with its reason:
  - the identity provider's project URL (token verification). The signing-key location and the
    expected issuer MUST be derived from it, not added as variables;
  - the project's publishable key (FR-008d). The Supabase client needs it to exchange the code
    or verify the link, and it cannot be derived;
  - the sign-up hook's signing secret (FR-008b). It is a secret generated by the provider, so it
    cannot be derived. It is optional: when it is unset the hook endpoint is disabled and only
    FR-008a creates accounts.

  The provider's publishable client key belongs to the later UI feature and is not needed here,
  unless the chosen verification method requires it. The Google OAuth client id and secret live
  only in the provider's dashboard, never in this project's environment.

### Key Entities

- **Verified caller**: the library account resolved from a verified token, with its status,
  roles, permissions and optional linked reader profile. It is the only source of the acting
  account for every operation.
- **Operation**: one entry of the contract: path, method, access rule, input, success result,
  possible rejection keys, and (for state changes) the spec 001 procedure it calls.
- **Outcome / rejection**: the uniform response of a refused request: key, message, detail,
  fields, category, correlation id for internal failures.
- **Page**: a slice of a list result with its size, position and total or next indicator.
- **Payment request key**: a client-generated unique key that makes a payment submission safe
  to repeat.
- **Library data** (books, copies, readers, cards, policies, loans, fines, payments,
  reservations, accounts, roles): as defined in spec 001; this feature adds no new stored
  entity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of spec 001's public operations and report procedures are reachable through
  the interface and declared in the shared contract definitions; the coverage test reports 0
  missing operations.
- **SC-002**: Every spec 001 error key that a public operation can return is produced through
  the interface in at least one test and arrives with its documented key and category; 0 known
  business refusals surface as internal failures. (Trigger-only guards that the operations
  never reach, such as `APPEND_ONLY`, are still mapped and documented.)
- **SC-003**: Across the identity test set (missing, malformed, expired, wrong-signature,
  wrong-audience tokens; spoofed actor; inactive account; forged profile role; unsigned, wrongly
  signed or replayed sign-up hook calls), 0 requests read or change library data.
- **SC-004**: In a test where 20 simultaneous requests check out the same copy, exactly 1
  succeeds, the rest are refused as not available, and every invariant check reports 0
  violations afterwards.
- **SC-005**: Submitting the same payment 20 times with one request key creates exactly 1
  payment.
- **SC-006**: A reader account cannot obtain any other reader's loans, fines, payments or
  reservations: 0 leaks across the reader-isolation test set.
- **SC-007**: With the seeded data, 95% of catalog searches and desk operations (checkout of up
  to 5 copies, return, renew, payment) complete in under 1 second as seen by the caller.
- **SC-008**: Every circulation scenario that spec 001 FR-025 requires in the sample data can be
  reproduced through the interface alone, with the same outcomes as the database-level tests:
  on time, overdue, renewal success and failure, damage, loss, partial payment, expired card,
  limit exceeded and concurrent checkout.
- **SC-009**: A team member who has not read the server code can complete a checkout, return
  and payment using only the shared contract definitions and the endpoint catalogue, on the first
  attempt.
- **SC-010**: Every new Google user ends up with exactly one active library account with the
  `reader` role, both when the sign-up hook is enabled and when it is off. Repeated or
  simultaneous hook deliveries and first requests create 0 duplicates.

## Assumptions

- The consumers are the project's own web UI (a later feature), tests and the course demo; the
  interface is not offered to third parties, so no public API keys, rate plans or cross-origin
  access for other sites are in scope.
- Anonymous visitors may only view and search the catalog (books, authors, categories,
  availability counts). They see no copy barcodes, shelf positions, readers, loans or money.
  Every other read and every write requires sign-in (Clarification A1).
- A new Google user gets an account with the `reader` role only (no permissions), through the
  callback, the hook or the first request (FR-008). The account also gets its own EXTERNAL
  reader profile, linked by account id (FR-008e). Staff roles are assigned by an admin, and
  cards are issued at the desk.
- Accounts deleted or banned in the identity provider are deactivated in the library by an admin
  (FR-011a). The only provider event handled automatically is the sign-up hook.
- Hold expiry and card expiry also run on demand through the interface; the scheduled hold
  expiry keeps running in the database (spec 001 flow 18). No new scheduler is added.
- The existing database helper (`callProcedure`) and its retry and error mapping are reused as
  is; the interface adds the translation to response categories.
- Sign-in screens, password reset and session handling in the browser belong to the identity
  provider and the UI feature, not this feature.
- The Google Books import, refresh-with-accept and preview (spec 001 FR-004b/c/d) are spec 003.
  Until then, catalog data enters through the seed or through manual catalog writes.
- Backup, restore, migrations and seeding stay developer scripts; they are not exposed.
- The feature adds no table, trigger or procedure; if a read needs a new index, it is added by a
  migration with an EXPLAIN, as the constitution requires.
