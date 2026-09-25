# Data Model: Library API (spec 002)

This feature adds **no table, column, trigger or procedure**. The stored model is spec 001's
[data-model.md](../001-library-db-design/data-model.md). This file defines the **API resources**:
what each response and request object contains, which tables or routines it reads or calls, and
its validation rules. The HTTP catalogue is in [contracts/http-api.md](./contracts/http-api.md).

## Conventions (FR-005)

| Kind | Wire format | Source |
| --- | --- | --- |
| Id | JSON integer (`BIGINT` ids stay far below 2^53) | surrogate keys |
| Instant | ISO 8601 UTC with milliseconds, `2026-10-14T16:59:59.999Z` | `DATETIME(3)` UTC; the pool uses `dateStrings`, so `'2026-10-14 16:59:59.999'` is converted to ISO with a `Z` |
| Money | JSON integer, whole đồng, field suffix `Vnd` | `BIGINT` VND |
| Status / enum | lowercase codes from spec 001 (`on_loan`, `bank_transfer`) | `ENUM` columns |
| Local month | `YYYY-MM`, library-local (UTC+07:00) | converted to UTC `[from, to)` by `localMonthBounds` |
| Names | camelCase in JSON, snake_case in SQL | mapped in the query layer |

Inputs reject unknown keys (`strict` objects), so `actorUserId`, `now` and similar fields cause
`VALIDATION` (spec edge case, FR-007).

## Request context (not stored)

| Field | Meaning | Source |
| --- | --- | --- |
| `requestId` | Correlation id, echoed in `X-Request-Id` and in error bodies | generated per request (or accepted from a well-formed incoming `X-Request-Id`) |
| `now` | Business time passed as `p_now` to every procedure | the injected `Clock` (server wall clock in production, fixed in tests). Never from the client |
| `caller` | The verified caller, below | token verification + account resolution |

### Verified caller

| Field | Type | Source |
| --- | --- | --- |
| `accountId` | id | `app_users.id` resolved by `supabase_user_id = token.sub` (created on first sight, FR-008a) |
| `subject` | uuid | `sub` claim of the verified token |
| `status` | `active` \| `inactive` | `app_users.status` |
| `roles` | string[] | `user_roles` → `roles.code` |
| `permissions` | string[] | `role_permissions` → `permissions.code`, de-duplicated |
| `readerId` | id \| null | `readers.id WHERE user_id = accountId` (unique, `readers_user_uq`) |

Resolved once per request with one query. An `inactive` caller may call only `GET /me` (FR-011).

## Account provisioning ("ensure account", FR-008)

**Request path (FR-008a):** every authenticated request first runs one read,
`resolveCaller(subject)`: `app_users` by `supabase_user_id`, joined with roles, permissions and
the linked reader. Only when it finds no row does the request call "ensure account", then
resolve again. A known subject therefore never writes or locks anything (analysis U1).

**Ensure account.** Input: `subject` (uuid), `now`, `attempts` (default 3; the hook passes 1,
see below). One transaction on the app account (it may write `app_users` and `user_roles`,
spec 001 FR-026):

1. `INSERT IGNORE INTO app_users (supabase_user_id, status, created_at) VALUES (?, 'active', ?)`.
   `ON DUPLICATE KEY UPDATE` is not used, because mysql2 sets `CLIENT_FOUND_ROWS`, and
   `affectedRows` would then not tell "created" from "existed".
2. `affectedRows = 1` → new account: `INSERT INTO user_roles (user_id, role_id) SELECT ?, id
   FROM roles WHERE code = 'reader'`. `affectedRows = 0` → existing account: read its id. Nothing
   else changes (status and roles are left alone).
3. Reader profile, by id (FR-008e): `INSERT IGNORE INTO readers (user_id = accountId,
   reader_type = EXTERNAL, full_name, email, status = 'active')`. `readers_user_uq` makes this a
   no-op when the account already has a reader, so the callback and the hook also backfill an
   existing account. No email matching is done. The name comes from `full_name`, else `name`,
   else the email's local part. It is taken from the callback session, the hook payload, or the
   token claims on the first-request path.
4. `COMMIT`; return `accountId`, `created`, `reader` (`created` | `existing`).

Concurrency: a second transaction for the same subject blocks on the unique key
`app_users_supabase_uq` until the first commits, then takes the duplicate branch. Result:
one account, one `reader` row (SC-010). Both callers (the hook and the first-request path) use
this same function.

**Time budget.** The request path uses the pool's 5 s lock wait and up to 3 attempts. The
sign-up hook must answer within Supabase's 5 s budget. It therefore calls with `attempts = 1`
on a connection with `innodb_lock_wait_timeout = 2`, and answers 503 on 1205/1213 so that
Supabase retries (analysis U2).

## Auth redirects (FR-008d)

The auth redirects are not JSON resources. Each answers `302 Location`.

| Route | Input (query) | Success | Failure |
| --- | --- | --- | --- |
| `GET /auth/callback` | `code`, `next?`, or `error` and `error_description` from Supabase | session cookies set, account ensured, `→ <origin><next>` | `→ <origin>/auth/error?reason=provider_error \| missing_code \| exchange_failed \| not_configured \| provider_not_allowed \| account_unavailable` |
| `GET /auth/confirm` | `token_hash`, `type` (signup, invite, magiclink, recovery, email_change, email), `next?` | same | `→ …?reason=invalid_link \| verify_failed \| not_configured \| provider_not_allowed \| account_unavailable` |

`next` must match `^/(?![/\\])` (a same-site path). Anything else becomes `/`.

## Resources

### Public catalog

**BookSummary** (list item, public): `id`, `title`, `subtitle`, `authors: {id, name}[]` (by
`author_order`), `categories: {id, name}[]`, `publishedYear`, `languageCode`, `coverUrl`,
`materialType` (code), `copies: {available, total}`.

- `copies.available` = copies with `circulation_status = 'available'`;
  `copies.total` = copies not `retired` and not `lost`.
- Only books with `status = 'active'` are public.
- Tables: `books`, `book_authors`, `authors`, `book_categories`, `categories`, `material_types`,
  `book_copies` (grouped counts through `book_copies(book_id, circulation_status)`).

**BookDetail** (public) = BookSummary + `publisher: {id, name} | null`, `publishedDateText`,
`description`, `classificationCode`, `identifiers: {type, value}[]`. It has no barcodes, shelf
codes, replacement cost or external references (Clarification A1).

**Search filters** (FR-015): `q` (text: FULLTEXT `books_title_ft` on title/subtitle, OR author
name `LIKE` prefix), `categoryId` (includes direct children), `identifier` (exact
`identifier_value`), `materialType` (code), plus paging.

### Catalog management (`catalog.write`)

**BookInput** (create; update is the same object with every field optional, and arrays replace
the stored set):

| Field | Rule |
| --- | --- |
| `title` | required, 1–500 chars, trimmed |
| `subtitle`, `description`, `publishedDateText`, `coverUrl`, `classificationCode` | optional strings within column lengths; `coverUrl` must be `https:` |
| `publishedYear` | optional integer 1000–2100 (CHECK `books_published_year_ck`) |
| `languageCode` | optional BCP 47-like, ≤ 8 chars (column length) |
| `materialType` | required code, must exist (`material_types.code`) |
| `publisherId` | optional id, must exist |
| `replacementCostVnd` | optional integer ≥ 0 |
| `authorIds` | ordered array of existing author ids, 1–20, distinct (order becomes `author_order`) |
| `categoryIds` | array of existing ids, 0–20, distinct |
| `identifiers` | array of `{type: ISBN_10 \| ISBN_13 \| OTHER, value}`, 0–10, distinct per book |
| `status` (update only) | `active` \| `retired` |

A create or update writes `books` and the three child tables in **one transaction** (FR-024).
Missing referenced ids become `NOT_FOUND` with the field name. Staff responses (BookAdmin)
include `replacementCostVnd` and `status`.

**Author**, **Publisher**: `{id, name}` (name 1–200). **Category**: `{id, name, parentId}` (name 1–150, the column length).

**Copy** (staff view): `id`, `bookId`, `barcode`, `shelfCode`, `acquiredAt` (date),
`physicalCondition`, `circulationStatus`, `heldFor: {reservationId, readerId, holdExpiresAt} |
null` (when `on_hold`).

- Register (`sp_register_copy`): `barcode` (1–32, required; column length), `shelfCode?`, `acquiredAt?`
  (`YYYY-MM-DD`), `condition` (`good` \| `worn` \| `damaged`). Returns the Copy after the call,
  so a copy promoted to a hold shows `on_hold` (US3-5).
- Change status (`sp_change_copy_status`): `targetStatus` (`available` \| `in_repair` \|
  `retired`), `condition` (`good` \| `worn` \| `damaged`).

### People

**Reader**: `id`, `fullName`, `email`, `phone`, `readerType` (code), `status` (`active` \|
`suspended` \| `inactive`), `accountId | null`, `createdAt`, `activeCard: Card | null`.
Create and update write `readers` directly (`card.manage`). `readerType` must exist;
`fullName` 1–200; `email` ≤ 320 and email-shaped; `phone` ≤ 20.

**Account link**: `PUT /readers/{id}/account {accountId}`. It sets `readers.user_id`.
- The account must exist and be active; the reader must not be linked yet.
- `readers_user_uq` rejects a second reader for the same account (1062 → `DUPLICATE`).
- The reader learns their `accountId` from `GET /me` and shows it at the desk (research R7).

**Card**: `id`, `readerId`, `cardNumber`, `issuedAt`, `expiresAt`, `status`,
`validNow` (`active` and `expiresAt > now`).
- Issue (`sp_issue_card`): `cardNumber` (1–32), `expiresAt` (instant, after `now`).
- Status (`sp_set_card_status`): `status` (`expired` \| `lost` \| `revoked`).

**PolicyVersion**: `id`, `readerType`, `materialType`, `maxActiveItems`, `loanDays`,
`maxRenewals`, `dailyLateFeeVnd`, `debtBlockThresholdVnd`, `validFrom`, `validTo | null`.
- Create (`sp_create_policy_version`): all numeric fields are non-negative integers
  (`loanDays ≥ 1`, `maxActiveItems ≥ 1` per CHECK `loan_policies_max_items_ck`), and `validFrom` is an instant.
- Close (`sp_close_policy_version`): `validTo` (instant).

### Circulation

**CheckoutInput**: `readerId`, `copyIds` (1–20 distinct ids). Calls `sp_checkout(actor, now,
readerId, JSON copyIds)`.
**CheckoutResult**: `loanId`, `items: {loanItemId, copyId, dueAt}[]` (from the procedure's
result set).

**LoanItem** (reader and staff views): `id`, `loanId`, `copy: {id, barcode}`,
`book: {id, title}`, `borrowedAt`, `dueAt`, `status` (`on_loan` \| `returned` \| `lost`),
`returnedAt`, `returnCondition`, `renewalCount`, `maxRenewals` (`applied_max_renewals`),
`overdue` (`on_loan` and `dueAt < now`), `fines: FineRef[]`.
- A reader's own view omits `copy.barcode` (not needed, keeps the public/staff split).

**ReturnInput**: `condition` (`good` \| `worn` \| `damaged`), `damagedFineVnd?` (integer ≥ 0),
`reason?` (≤ 255). Calls `sp_return_item`.
**LostInput**: `lostFineVnd?`, `reason?`. Calls `sp_declare_lost`.
Both return `{fines: {id, type, amountVnd}[]}` from the procedure's result set.
**RenewResult**: `{loanItemId, newDueAt}` from `sp_renew`'s OUT parameter.

### Money

**Fine**: `id`, `loanItemId`, `type` (`late` \| `damaged` \| `lost`), `defaultAmountVnd`,
`assessedAmountVnd`, `adjustmentsVnd`, `netVnd`, `allocatedVnd`, `remainingVnd`, `reason`,
`assessedAt`, `book: {id, title}`.
- It is computed with one grouped query (sums of `fine_adjustments` and
  `fine_payment_allocations`), not through `fn_fine_*` per row.
- These are plain reads for display only; they never decide a write.

**Balance**: `{readerId, outstandingVnd, asOf}`. `outstandingVnd` = Σ remaining of the reader's
fines (the same definition as `fn_reader_outstanding` at `now`).

**PaymentInput**: `readerId`, `amountVnd` (> 0), `method` (`cash` \| `bank_transfer`),
`referenceNo?` (≤ 64), `requestKey` (UUID, client-generated), `allocations: {fineId,
amountVnd}[]` (1–50, distinct fines, each > 0).
**PaymentResult**: `{paymentId, replayed}`. The status is 201 when new and 200 when
`replayed = true` (FR-017).
**Payment** (list): `id`, `amountVnd`, `method`, `referenceNo`, `paidAt`, `receivedBy`
(account id), `allocations`.

**AdjustmentInput**: `amountVnd` (non-zero integer), `reason` (1–255). Calls `sp_adjust_fine`.
Returns `{adjustmentId}`.

### Reservations [Ext in spec 001, exposed here]

**Reservation**: `id`, `readerId`, `book: {id, title}`, `status`, `requestedAt`,
`queuePosition` (1-based among `waiting` of the book, `null` unless waiting), `readyAt`,
`holdExpiresAt`, `assignedCopyId`, `closedAt`, `closeReason`.
**ReserveInput**: `readerId`, `bookId` → `sp_reserve`. Readers pass their own `readerId`; the
procedure decides `FORBIDDEN`.
**CancelReservationInput**: `reason?` (≤ 64, the `close_reason` column) → `sp_cancel_reservation`.

### Reports (`report.read`)

| Resource | Source | Parameters |
| --- | --- | --- |
| Cumulative debt | `sp_report_cumulative(asOf, readerId)` | `asOf?` (instant, default `now`), `readerId?` |
| Roll-forward | `sp_report_rollforward(from, to, readerId)` | `month` (`YYYY-MM`, required), `readerId?` |
| Overdue | `v_report_overdue` | paging |
| Loans by month | `v_report_loans_by_month` | `from?`, `to?` months |
| Popular books | `v_report_popular_books` | `limit` 1–100 |
| Copy status | `v_report_copy_status` | paging |
| Health | every `v_inv_*` view (`findViolations`) | none; returns `{views, violations: {view, rows}[]}` |

Column names follow the report contract of spec 001
([reports-and-invariants.md](../001-library-db-design/contracts/reports-and-invariants.md)),
converted to camelCase.

### Administration (`role.manage`)

**Account**: `id`, `status`, `createdAt`, `roles`, `readerId | null`. The Supabase subject is
shown only to admins.
- Assign role: `PUT /accounts/{id}/roles/{roleCode}` inserts into `user_roles`. It is
  idempotent, so an existing pair returns 204.
- Remove role: `DELETE` on the same path.
- Set status: `POST /accounts/{id}/status {status}` updates `app_users.status`.
- An admin cannot remove their own `admin` role or deactivate themself (`VALIDATION`), so the
  last admin cannot lock everyone out.

### Error body (FR-019)

```json
{ "error": { "key": "COPY_NOT_AVAILABLE", "category": "conflict", "message": "…",
  "detail": "copy 42", "fields": [{"path": "copyIds.1", "message": "…"}], "requestId": "…" } }
```

The mapping of keys to categories and HTTP statuses is in
[contracts/errors.md](./contracts/errors.md).

## State transitions

None are new. Copy, loan item, card, reservation and policy lifecycles are spec 001's
(ARCHITECTURE.md §4). The API only reports the procedure's decision.
