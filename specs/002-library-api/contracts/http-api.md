# Contract: HTTP API v1 (endpoint catalogue)

This is the design-level catalogue.
- **The binding contract is the shared TypeScript module `src/lib/api/contract/`** (research
  R2). Its `endpoints` table has one entry per row below, with the input zod schema, the output
  interface, the access rule and the error keys. The server and the UI both import it.
- `pnpm typecheck` fails when a handler does not match its entry.
- `tests/api/coverage.test.ts` fails when an entry is not mounted, or when a public `sp_*` has
  no entry (FR-002, SC-001).
- No OpenAPI document is produced in the MVP.
- Resource shapes are in [data-model.md](../data-model.md), and errors in [errors.md](./errors.md).

Base path: `/api/v1`. JSON in and out. Every response carries `X-Request-Id`.

**Access column**
- `public`: no token.
- `signed-in`: any active account.
- `self|<perm>`: the caller's own reader record, or an account holding `<perm>`. Anything else
  gets `NOT_FOUND` (FR-010).
- `<perm>` alone: the permission is checked by the server (reads and direct writes), or by the
  procedure (the Proc column is set). For procedure routes the server does no pre-check, and the
  procedure's `FORBIDDEN` is returned as it is.

**Paging**: list routes take `page` (≥ 1, default 1) and `pageSize` (1–100, default 20). They
return `{items, page, pageSize, total}` (FR-016).

## Meta and identity

| Method | Path | Access | Proc | Success | Notes |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | public | — | 200 `{status: "ok"}` | Liveness only: it does not touch the database |
| GET | `/me` | token (inactive allowed) | — | 200 `{accountId, status, roles, permissions, reader}` | Creates the account on first sight (FR-008a) |
| GET | `/auth/callback` | public (the `code` is the credential) | — | 302 to `next` (same-site), or to `/auth/error?reason=` | FR-008d. OAuth PKCE `exchangeCodeForSession`; sets the session cookies |
| GET | `/auth/confirm` | public (the `token_hash` is the credential) | — | 302 to `next`, or to `/auth/error?reason=` | FR-008d. Email link `verifyOtp({ type, token_hash })` |
| POST | `/auth/hooks/before-user-created` | webhook signature | — | 200 `{}` | See [signup-hook.md](./signup-hook.md). 404 when no hook secret is configured |

## Public catalog (Clarification A1: view and search only)

| Method | Path | Access | Success |
| --- | --- | --- | --- |
| GET | `/catalog/books` | public | 200 page of BookSummary. Query: `q`, `categoryId`, `identifier`, `materialType`, paging |
| GET | `/catalog/books/{bookId}` | public | 200 BookDetail. A missing or retired book gives 404 |
| GET | `/catalog/categories` | public | 200 `{items: Category[]}` (flat, with `parentId`) |

## Catalog management

| Method | Path | Access | Proc | Success |
| --- | --- | --- | --- | --- |
| POST | `/books` | catalog.write | — | 201 BookAdmin |
| GET | `/books/{bookId}` | catalog.write | — | 200 BookAdmin |
| PATCH | `/books/{bookId}` | catalog.write | — | 200 BookAdmin |
| GET | `/authors` | catalog.write | — | 200 page. Query: `q` |
| POST | `/authors` | catalog.write | — | 201 Author |
| GET | `/publishers` | catalog.write | — | 200 page. Query: `q` |
| POST | `/publishers` | catalog.write | — | 201 Publisher |
| POST | `/categories` | catalog.write | — | 201 Category |
| GET | `/books/{bookId}/copies` | catalog.write or loan.checkout | — | 200 `{items: Copy[]}` |
| POST | `/books/{bookId}/copies` | catalog.write | `sp_register_copy` | 201 Copy |
| GET | `/copies/by-barcode/{barcode}` | catalog.write or loan.checkout or loan.return | — | 200 Copy + `openLoanItemId` (desk scan) |
| POST | `/copies/{copyId}/status` | catalog.write | `sp_change_copy_status` | 200 Copy |

## Readers, accounts links, cards, policies

| Method | Path | Access | Proc | Success |
| --- | --- | --- | --- | --- |
| GET | `/readers` | card.manage or loan.checkout | — | 200 page. Query: `q` (name, email, phone), `status`, `readerType` |
| POST | `/readers` | card.manage | — | 201 Reader |
| GET | `/readers/{readerId}` | self or card.manage or loan.checkout | — | 200 Reader |
| PATCH | `/readers/{readerId}` | card.manage | — | 200 Reader |
| PUT | `/readers/{readerId}/account` | card.manage | — | 200 Reader. Body `{accountId}` |
| DELETE | `/readers/{readerId}/account` | card.manage | — | 200 Reader (unlinked) |
| GET | `/readers/{readerId}/cards` | self or card.manage | — | 200 `{items: Card[]}` |
| POST | `/readers/{readerId}/cards` | card.manage | `sp_issue_card` | 201 Card |
| GET | `/cards/by-number/{cardNumber}` | card.manage or loan.checkout | — | 200 Card + Reader (desk scan) |
| POST | `/cards/{cardId}/status` | card.manage | `sp_set_card_status` | 200 Card |
| GET | `/reference/reader-types` | signed-in | — | 200 `{items}` |
| GET | `/reference/material-types` | signed-in | — | 200 `{items}` |
| GET | `/policies` | policy.manage or loan.checkout | — | 200 page. Query: `readerType`, `materialType`, `activeAt` |
| POST | `/policies` | policy.manage | `sp_create_policy_version` | 201 PolicyVersion |
| POST | `/policies/{policyId}/close` | policy.manage | `sp_close_policy_version` | 200 PolicyVersion |

## Circulation

| Method | Path | Access | Proc | Success |
| --- | --- | --- | --- | --- |
| POST | `/loans` | loan.checkout | `sp_checkout` | 201 CheckoutResult |
| GET | `/readers/{readerId}/loan-items` | self or loan.checkout or loan.return | — | 200 page of LoanItem. Query: `status` (`on_loan`, `returned`, `lost`), `overdue` |
| POST | `/loan-items/{loanItemId}/return` | loan.return | `sp_return_item` | 200 `{fines}` |
| POST | `/loan-items/{loanItemId}/lost` | loan.return | `sp_declare_lost` | 200 `{fines}` |
| POST | `/loan-items/{loanItemId}/renew` | loan.renew | `sp_renew` | 200 RenewResult |

## Money

| Method | Path | Access | Proc | Success |
| --- | --- | --- | --- | --- |
| GET | `/readers/{readerId}/fines` | self or fine.collect | — | 200 page of Fine. Query: `open` (remaining > 0) |
| GET | `/readers/{readerId}/balance` | self or fine.collect or loan.checkout | — | 200 Balance |
| GET | `/readers/{readerId}/payments` | self or fine.collect | — | 200 page of Payment |
| POST | `/payments` | fine.collect | `sp_record_payment` | 201 PaymentResult, or 200 when `replayed` |
| POST | `/fines/{fineId}/adjustments` | fine.adjust | `sp_adjust_fine` | 201 `{adjustmentId}` |

## Reservations

| Method | Path | Access | Proc | Success |
| --- | --- | --- | --- | --- |
| POST | `/reservations` | signed-in (procedure: own reader or reservation.manage) | `sp_reserve` | 201 Reservation |
| GET | `/readers/{readerId}/reservations` | self or reservation.manage | — | 200 page of Reservation. Query: `status` |
| GET | `/reservations` | reservation.manage | — | 200 page. Query: `status` (e.g. `ready` for the hold shelf), `bookId` |
| POST | `/reservations/{reservationId}/cancel` | signed-in (procedure decides) | `sp_cancel_reservation` | 200 Reservation |

## Jobs (on demand; the scheduled hold expiry keeps running in the database)

| Method | Path | Access | Proc | Success |
| --- | --- | --- | --- | --- |
| POST | `/jobs/expire-cards` | card.manage | `sp_expire_cards` | 200 `{count}` |
| POST | `/jobs/expire-holds` | reservation.manage | `sp_expire_holds` | 200 `{count}` |

## Reports and health

| Method | Path | Access | Success |
| --- | --- | --- | --- |
| GET | `/reports/debt/cumulative` | report.read | 200 `{asOf, rows}`. Query: `asOf`, `readerId` |
| GET | `/reports/debt/rollforward` | report.read | 200 `{month, from, to, rows}`. Query: `month` (required), `readerId` |
| GET | `/reports/overdue` | report.read | 200 page |
| GET | `/reports/loans-by-month` | report.read | 200 `{items}`. Query: `fromMonth`, `toMonth` |
| GET | `/reports/popular-books` | report.read | 200 `{items}`. Query: `limit` |
| GET | `/reports/copy-status` | report.read | 200 page |
| GET | `/admin/health` | report.read | 200 `{views, violations}`; still 200 when violations exist, with a non-empty list |

## Administration

| Method | Path | Access | Success |
| --- | --- | --- | --- |
| GET | `/accounts` | role.manage | 200 page of Account. Query: `status`, `role` |
| GET | `/accounts/{accountId}` | role.manage | 200 Account |
| PUT | `/accounts/{accountId}/roles/{roleCode}` | role.manage | 204 |
| DELETE | `/accounts/{accountId}/roles/{roleCode}` | role.manage | 204 |
| POST | `/accounts/{accountId}/status` | role.manage | 200 Account. Body `{status}` |

## Operation coverage (SC-001)

Every public procedure of spec 001 has a route:
- `sp_register_copy`, `sp_change_copy_status`;
- `sp_issue_card`, `sp_set_card_status`;
- `sp_create_policy_version`, `sp_close_policy_version`;
- `sp_checkout`, `sp_return_item`, `sp_declare_lost`, `sp_renew`;
- `sp_record_payment`, `sp_adjust_fine`;
- `sp_reserve`, `sp_cancel_reservation`;
- `sp_expire_cards`, `sp_expire_holds`;
- `sp_report_cumulative`, `sp_report_rollforward`.

The four `v_report_*` views and the nine `v_inv_*` views are reachable through the report and
health routes. The coverage test checks this list against the routines granted to the app
account (`information_schema.ROUTINES` of type PROCEDURE whose names start with `sp_` and not
`sp__`).
