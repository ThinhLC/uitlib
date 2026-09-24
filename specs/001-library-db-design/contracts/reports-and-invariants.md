# Contract: Reports and Invariant Checks

## Invariant views (SC-005)

Each view returns one row per violation, with the offending ids and a short `problem` text. A
correct database returns zero rows from every view. `pnpm db:check` queries all of them and exits
non-zero if any returns rows. It runs after migrations, after seeding, and after every
acceptance and concurrency test.

| View | Invariant | Returns |
| --- | --- | --- |
| `v_inv_copy_on_loan` | I-1 | copies whose `on_loan` status disagrees with the count of `on_loan` items (≠ 1 or ≠ 0) |
| `v_inv_copy_on_hold` | I-2 [Ext] | copies whose `on_hold` status disagrees with `ready` reservations |
| `v_inv_queue_available` | I-3 [Ext] | books with a `waiting` reservation and an `available` copy |
| `v_inv_loan_status` | I-4 | loans whose status disagrees with their items |
| `v_inv_fine_balance` | I-5 | fines with allocated < 0 or allocated > net |
| `v_inv_payment_allocation` | I-6 | payments whose Σ allocations ≠ amount, or that pay another reader's fine |
| `v_inv_damaged_lendable` | I-7 | damaged copies that are lendable (should be impossible via the CHECK) |
| `v_inv_cards_policies` | I-8 | readers with > 1 active card; overlapping policy versions |
| `v_inv_borrow_in_policy` | I-9 | loan items whose `borrowed_at` is outside their version's period |

## Debt reports (FR-018, SC-006)

These are public report procedures that return one result set; money is in VND. Times are UTC
instants: callers convert library-local month boundaries (UTC+07:00) to UTC, e.g. October 2026
local = [`2026-09-30 17:00:00.000`, `2026-10-31 17:00:00.000`).

### `sp_report_cumulative(p_as_of, p_reader_id NULL)`

For records with time ≤ `asOf`, one row per reader (or one total row):

| Column | Definition |
| --- | --- |
| `net_assessed` | Σ fines.assessed (assessed_at ≤ asOf) + Σ adjustments (adjusted_at ≤ asOf) |
| `collected` | Σ payments.amount (paid_at ≤ asOf) |
| `outstanding` | net_assessed − collected |

Check: `net_assessed = collected + outstanding` (holds by definition; the test also verifies
`collected = Σ allocations` of those payments).

### `sp_report_rollforward(p_from, p_to, p_reader_id NULL)` for `[p_from, p_to)`

| Column | Definition |
| --- | --- |
| `opening_outstanding` | cumulative outstanding over records with time < `p_from` |
| `assessed_in_period` | Σ fines.assessed with `from ≤ assessed_at < to` |
| `adjusted_in_period` | Σ adjustments with `from ≤ adjusted_at < to` |
| `collected_in_period` | Σ payments with `from ≤ paid_at < to` |
| `closing_outstanding` | cumulative outstanding over records with time < `p_to` |

Check: `closing = opening + assessed + adjusted − collected`. Do not compare
`assessed_in_period` with `collected_in_period + closing` (spec FR-018).

Worked example (US4-14): September → 0, 30,000, 0, 0, 30,000. October → 30,000, 0, 0, 30,000, 0.

## Circulation reports (course report, Chapter 4)

These are views (`v_report_overdue`, `v_report_loans_by_month`, `v_report_popular_books`,
`v_report_copy_status`), and each ships with an `EXPLAIN` in the report. A view cannot take a
`p_now`, so `v_report_overdue` compares with `UTC_TIMESTAMP(3)`: it is the only wall-clock read,
it is read-only, and no procedure uses it to decide a write.

| Report | Key columns | Main index used |
| --- | --- | --- |
| Overdue items by reader | reader, book title, barcode, due_at, days late | `loan_items(status, due_at)` |
| Loans per month by reader type | month (local), reader type, loan count | `loans(reader_id, borrowed_at)` |
| Most borrowed books | book, loan count in period | `loan_items(borrowed_at)` (added if EXPLAIN shows a full scan), join on copy |
| Copies by status | book, available / on_loan / on_hold / in_repair / lost / retired, total | `book_copies(book_id, circulation_status)` |
| Debt roll-forward per month | as `sp_report_rollforward` | `fine_payments(paid_at)`, fines by `assessed_at` |
