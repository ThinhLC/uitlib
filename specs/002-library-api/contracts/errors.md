# Contract: Error Outcomes (FR-019 – FR-022)

Every non-2xx response has this body (content type `application/json`):

```json
{
  "error": {
    "key": "LIMIT_REACHED",
    "category": "conflict",
    "message": "The reader has reached the item limit for this material type.",
    "detail": "BOOK_PRINT 5/5",
    "fields": [],
    "requestId": "01J9Z…"
  }
}
```

- `key`: the stable spec 001 key, or one of the API keys below. Clients branch on `key`, never on
  `message`.
- `category`: tells the caller whether retrying can help.
- `message`: an English sentence for display. It is fixed per key, and the UI may translate it.
- `detail`: the text after `KEY:` in the database message (e.g. `limit` for `RENEWAL_REJECTED`),
  or the unique index name for `DUPLICATE`. It is empty for `INTERNAL`.
- `fields`: set only for `VALIDATION` raised by the server's input check. Each entry has a
  dotted `path` into the input and a `message`.
- `requestId`: always present, and also sent in the `X-Request-Id` response header.

Logging: an `INTERNAL` error is logged at `error`, with the full cause. Every known outcome
(401, 403, 404, 409, 503, …) is logged at `info`, as `[api] <requestId> <KEY> (<detail>)`.

## Categories and HTTP status

| Category | HTTP | Retry helps? | Keys |
| --- | --- | --- | --- |
| `unauthenticated` | 401 + `WWW-Authenticate: Bearer` | after sign-in | `UNAUTHENTICATED` |
| `forbidden` | 403 | no | `FORBIDDEN`, `ACCOUNT_INACTIVE` |
| `not_found` | 404 | no | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| `validation` | 400 | after fixing input | `VALIDATION` |
| `conflict` | 409 | no, or after the state changes | every other 45000 key (below) and `DUPLICATE` |
| `busy` | 503 + `Retry-After: 1` | yes | `BUSY` |
| `unavailable` | 503 + `Retry-After: 5` | yes | `AUTH_UNAVAILABLE` |
| `internal` | 500 | no | `INTERNAL` |

`conflict` keys (spec 001 `contracts/db-routines.md`): `COPY_NOT_AVAILABLE`, `READER_NOT_ACTIVE`,
`CARD_INVALID`, `DEBT_BLOCKED`, `OVERDUE_BLOCKED`, `LIMIT_REACHED`, `NO_POLICY`,
`RENEWAL_REJECTED`, `INVALID_TRANSITION`, `POLICY_OVERLAP`, `POLICY_CLOSE_REJECTED`,
`POLICY_IMMUTABLE`, `SNAPSHOT_IMMUTABLE`, `APPEND_ONLY`, `COPY_STATE`, `FINE_RULE`,
`ALLOCATION_MISMATCH`, `PAYMENT_EXCEEDS_DEBT`, `DUPLICATE`, `IDEMPOTENCY_CONFLICT`.

A 45000 key that is not in the table above (for example a key added to the database later) is
still returned with its own key, in category `conflict`. The coverage test fails until the key
is added to this table and to the `ErrorKey` union in `src/lib/api/contract/errors.ts`. It
finds the keys by scanning the `SIGNAL … 'KEY:` messages in `drizzle/*/migration.sql`.

## Sources and mapping

| Source | Becomes |
| --- | --- |
| Missing or malformed `Authorization: Bearer …` header; bad signature, issuer, audience or `exp`; `is_anonymous` token | `UNAUTHENTICATED` |
| Verified token whose provider list does not include `google` (FR-008) | `UNAUTHENTICATED`, detail `provider`; no account is created |
| The signing-key set cannot be fetched and no cached key matches | `AUTH_UNAVAILABLE` |
| The caller's account is `inactive` (any route except `GET /me`) | `ACCOUNT_INACTIVE` |
| The server-side permission check for reads and direct writes fails | `FORBIDDEN` (detail: the permission code) |
| A reader asks for another reader's record | `NOT_FOUND`, the same body as a missing id (FR-010) |
| Input schema check fails (types, ranges, unknown keys, bad JSON) | `VALIDATION` with `fields` |
| `DbRuleError { key, detail }` from `callProcedure` (45000 or 1062) | `key` and `detail` as they are; category from the table |
| errno 1213 or 1205 after `callProcedure` used up its 3 attempts | `BUSY` |
| A direct-write transaction (catalog, readers, accounts) hits 1213 or 1205 | retried with the same policy, then `BUSY` |
| errno 1452 (FK) in a direct write | `NOT_FOUND` with detail = the field name, e.g. `publisherId` |
| errno 3819 (CHECK), 1142/1370 (privilege), connection errors, anything else | `INTERNAL`. The full error goes to the server log with `requestId`, and nothing of it is returned (FR-022) |
| An unknown path under `/api/v1` | `ROUTE_NOT_FOUND` |

## Messages

The shared contract keeps the key list, the category of each key and one message per key, in
`src/lib/api/contract/errors.ts` (`ERROR_CATEGORY`, `ERROR_MESSAGES`). The server uses them to
build responses, and the UI can use them to translate or branch. `RENEWAL_REJECTED`
has one message per detail (`not_on_loan`, `overdue`, `limit`, `reserved`), and `DUPLICATE`
has one per known index:

| Index (detail) | Message |
| --- | --- |
| `book_copies_barcode_uq` | Barcode already in use |
| `library_cards_number_uq` | Card number already in use |
| `library_cards_active_reader_uq` | Reader already has an active card |
| `reservations_active_uq` | Reader already has an active reservation for this book |
| `readers_user_uq` | This account is already linked to a reader |
| `book_identifiers_uq` | The book already has this identifier |
| `categories_parent_name_uq` | A category with this name already exists under the same parent |
| `fine_payments_request_key_uq` | (never shown: the procedure turns a replay into success or `IDEMPOTENCY_CONFLICT`) |
| any other | A record with the same unique value already exists |
