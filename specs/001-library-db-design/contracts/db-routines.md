# Contract: Database Routines (functions, procedures, cursors)

This is the database's public interface. The seed script and tests call it now; the API will
call it later (spec FR-026). Everything here is created by custom migrations run as the owner
account (`root`), with `SQL SECURITY DEFINER`. `scripts/db/grants.ts` grants the
routines marked *public* to the app account (`$DB_USER`); both account names come from the
environment (spec FR-030).

## Calling rules (all operation procedures)

- Call with autocommit on and **no open transaction**: each procedure runs `START TRANSACTION`
  itself, which would silently commit an open one.
- `p_actor_user_id`: the account performing the action. The procedure checks
  `fn_has_permission(p_actor_user_id, <permission>)`, which is false for missing or `inactive`
  accounts. A failed check raises `FORBIDDEN` before any lock or write. **[API]** Later the API
  passes the id taken from a verified Supabase token.
- `p_now DATETIME(3)`: the current UTC instant. Procedures use it for every business time
  (borrow, due, return, paid, validity checks); `NOW()` is never used for decisions.
- On any error the procedure rolls back its whole transaction and re-raises it: business
  rejections as `SQLSTATE '45000'` with `MESSAGE_TEXT = '<KEY>: <detail>'`; deadlock (1213),
  lock wait timeout (1205), duplicate key (1062) and others as the original error. `callProcedure`
  reports a 1062 to the app as `DbRuleError` key `DUPLICATE` with the unique index name as detail
  (e.g. `library_cards_active_reader_uq`, `book_copies_barcode_uq`). Callers retry
  only 1213/1205, up to 3 times with a 50–200 ms random back-off.
- Locks follow the spec's global order: reader type → reader → card → book → copy → policy
  version → loan → loan item → reservation → fine. Within one kind, rows are locked in ascending
  id; reservations in `(requested_at, id)` order.
- **Decisions use locking reads only.** Every value that decides a write (debt, balances, open
  items, overdue items, card validity) comes from `SELECT … FOR UPDATE` / `FOR SHARE` taken
  after the reader lock. The balance functions `fn_fine_net`, `fn_fine_remaining` and
  `fn_reader_outstanding` use plain reads; they are for views and reports and MUST NOT decide a
  write. `START TRANSACTION WITH CONSISTENT SNAPSHOT` is not used (research R5).

## Error keys

| Key | Raised when |
| --- | --- |
| `FORBIDDEN` | Actor missing, inactive, or lacks the permission |
| `NOT_FOUND` | A referenced id does not exist |
| `VALIDATION` | Bad input shape or range (empty list, duplicate id, amount ≤ 0, …) |
| `COPY_NOT_AVAILABLE` | Copy not `available`, or `on_hold` for another reader |
| `READER_NOT_ACTIVE` | Reader `suspended` / `inactive` |
| `CARD_INVALID` | No card that is `active` and unexpired at `p_now` |
| `DEBT_BLOCKED` | Outstanding debt > the version's threshold |
| `OVERDUE_BLOCKED` | Reader has an overdue item (D7) |
| `LIMIT_REACHED` | Open items + requested items > max active items |
| `NO_POLICY` | No version covers (reader type, material type, `p_now`) |
| `RENEWAL_REJECTED` | Not on loan, overdue, at limit, or waiting reservation (detail names which) |
| `INVALID_TRANSITION` | Status change not allowed (procedure check or trigger) |
| `POLICY_OVERLAP` | Version would overlap another for the same pair |
| `POLICY_CLOSE_REJECTED` | Close is retroactive, extends, or not after every referencing borrow |
| `POLICY_IMMUTABLE` | Trigger: business value of a version changed |
| `SNAPSHOT_IMMUTABLE` | Trigger: loan item identity/snapshot changed |
| `APPEND_ONLY` | Trigger: update/delete on fines or money rows |
| `COPY_STATE` | Trigger: copy status disagrees with loan items (I-1) |
| `FINE_RULE` | Fine amount out of range, missing reason, damaged+lost conflict |
| `ALLOCATION_MISMATCH` | Σ allocations ≠ amount, over a fine's remaining balance, or another reader's fine |
| `PAYMENT_EXCEEDS_DEBT` | Payment > reader's outstanding |
| `DUPLICATE` | A unique key was hit (1062 mapped by `callProcedure`; detail = index name), or a business duplicate detected before the key (e.g. active reservation) |
| `IDEMPOTENCY_CONFLICT` | Payment request key reused with a different reader, amount or allocations |

## Functions [Core, public]

| Signature | Returns | Characteristic | Definition |
| --- | --- | --- | --- |
| `fn_local_date(p_ts DATETIME(3))` | DATE | DETERMINISTIC | `DATE(p_ts + INTERVAL 7 HOUR)` |
| `fn_due_at(p_borrowed_at DATETIME(3), p_loan_days INT)` | DATETIME(3) | DETERMINISTIC | UTC instant of 23:59:59.999 local on `fn_local_date(p_borrowed_at) + p_loan_days` |
| `fn_days_late(p_due_at DATETIME(3), p_end_at DATETIME(3))` | INT | DETERMINISTIC | `GREATEST(0, DATEDIFF(fn_local_date(p_end_at), fn_local_date(p_due_at)))` |
| `fn_late_fee(p_days INT, p_daily_fee BIGINT, p_cap BIGINT)` | BIGINT | DETERMINISTIC | `p_days * p_daily_fee`, then `LEAST(…, p_cap)` when `p_cap` is not NULL |
| `fn_fine_net(p_fine_id BIGINT)` | BIGINT | READS SQL DATA | assessed + Σ adjustments |
| `fn_fine_remaining(p_fine_id BIGINT)` | BIGINT | READS SQL DATA | net − Σ allocations |
| `fn_reader_outstanding(p_reader_id BIGINT, p_as_of DATETIME(3))` | BIGINT | READS SQL DATA | Σ assessed (≤ as_of) + Σ adjustments (≤ as_of) − Σ payments (≤ as_of) |
| `fn_has_permission(p_user_id BIGINT, p_code VARCHAR(64))` | BOOLEAN | READS SQL DATA | account exists, is `active`, and one of its roles grants `p_code` |

Expected values (from spec US2-10, US4-1, US4-3): `fn_due_at('2026-09-30 16:59:59.900', 14)` =
`'2026-10-14 16:59:59.999'` (local 23:59:59.999 on 2026-10-14);
`fn_days_late(due 2026-10-10 local, returned 2026-10-13 local)` = 3;
`fn_late_fee(10, 2000, 150000)` = 20000.

## Operation procedures [Core, public]

| Procedure | Permission | Parameters (after `p_actor_user_id`, `p_now`) | OUT / result | Locks, then writes | Spec |
| --- | --- | --- | --- | --- | --- |
| `sp_create_policy_version` | `policy.manage` | reader_type_id, material_type_id, max_active_items, loan_days, max_renewals, daily_late_fee_vnd, debt_block_threshold_vnd, valid_from | `p_policy_id` | reader type → versions of pair; reject `POLICY_OVERLAP`; insert | FR-009, R-09a |
| `sp_close_policy_version` | `policy.manage` | policy_id, valid_to | — | reader type → version; reject `POLICY_CLOSE_REJECTED` if `valid_to` < `p_now`, not earlier than current, ≤ `valid_from`, or ≤ max referencing `borrowed_at` | FR-009c, R-09e |
| `sp_issue_card` | `card.manage` | reader_id, card_number, expires_at | `p_card_id` | reader → reader's cards; insert (UQ → 1062, reported as `DUPLICATE` re-raised) | FR-008, R-08a/c |
| `sp_set_card_status` | `card.manage` | card_id, status | — | reader → card; `active` only if unexpired and no other active | FR-008 |
| `sp_register_copy` | `catalog.write` | book_id, barcode, shelf_code, acquired_at, condition | `p_copy_id` | book → [Ext] queue; insert as `available` (or `in_repair` if damaged); [Ext] promotion | FR-006, FR-006a |
| `sp_change_copy_status` | `catalog.write` | copy_id, target_status, condition | — | book → copy → [Ext] queue; lifecycle check; `INVALID_TRANSITION` if the target is `available` while the (new) condition is `damaged`; [Ext] promotion | FR-006a |
| `sp_checkout` | `loan.checkout` | reader_id, copy_ids JSON `[id,…]` | result set: loan_id, loan_item_id, copy_id, due_at | reader → reader's cards (S) → books ↑ → copies ↑ → policy (S) → [Ext] reservation (expire an overdue hold on the copy first); eligibility (FR-009d) with locking reads, debt by `SUM … FOR SHARE`; insert loan, items (snapshot + `fn_due_at`), then copies `on_loan`; all-or-nothing | FR-009b/d, FR-010–012, R-12b |
| `sp_return_item` | `loan.return` | loan_item_id, return_condition, damaged_fine_vnd NULL, reason NULL | result set of assessed fines | reader → book → copy → loan → loan item → [Ext] queue; item `returned`; `sp__assess_fines`; copy lendable or `in_repair`; loan closed if last | FR-015a/b, R-10a |
| `sp_declare_lost` | `loan.return` | loan_item_id, lost_fine_vnd NULL, reason NULL | result set of assessed fines | as return; item `lost`, copy `lost`; late (to `p_now`) + lost fines | FR-015a/b |
| `sp_renew` | `loan.renew` | loan_item_id | `p_new_due_at` | reader → book → loan item; checks (FR-013); update due and count; insert renewal | FR-013, R-13a |
| `sp_record_payment` | `fine.collect` | reader_id, amount_vnd, method, reference_no, request_key, allocations JSON `[{fine_id, amount_vnd}]` | `p_payment_id`, `p_replayed` | see below | FR-016, R-16b–e |
| `sp_adjust_fine` | `fine.adjust` | fine_id, amount_vnd (≠ 0), reason | `p_adjustment_id` | reader (of the fine) → fine `FOR UPDATE`; net and allocated read with `FOR SHARE`; `FINE_RULE` if the reason is blank or afterwards net < allocated or net < 0; insert with `adjusted_at = p_now` | FR-017, R-17a |

### `sp_record_payment` steps

1. Permission check (`FORBIDDEN`); `request_key` required (`VALIDATION`).
2. If `request_key` exists: `sp__check_replay` compares reader, amount and allocations with the
   stored payment. Equal → return that payment, `p_replayed = TRUE`, no writes. Different →
   `IDEMPOTENCY_CONFLICT`.
3. Validate the input before any lock: amount > 0, method, allocations expanded with
   `JSON_TABLE`; `VALIDATION` if the list is empty, has a duplicate fine, or an amount ≤ 0.
4. `START TRANSACTION`; lock the reader. Every other writer of this reader's fines (return, lost,
   adjustment, payment) locks the reader first, so the sums below cannot change underneath.
5. `PAYMENT_EXCEEDS_DEBT` if `amount_vnd` > the reader's total remaining, from assessed +
   adjustments − allocations read `FOR SHARE`.
6. Lock the fines in ascending id (`FOR UPDATE OF f`), joined to `loan_items → loans`.
   `ALLOCATION_MISMATCH` if a fine is missing or belongs to another reader, if an allocation >
   that fine's remaining balance (sums read `FOR SHARE`), or if Σ ≠ `amount_vnd`.
7. Insert the payment (`paid_at = p_now`), then the allocations.
8. Re-sum the allocations from the table; `SIGNAL ALLOCATION_MISMATCH` unless it equals
   `amount_vnd`.
9. `COMMIT`.

`EXIT HANDLER FOR 1062` (a concurrent call with the same key committed first): `ROLLBACK`, then
the same comparison as step 2: return the existing payment with `p_replayed = TRUE`, or
`IDEMPOTENCY_CONFLICT`.

## Internal helpers [not granted]

- `sp__check_replay(p_payment_id, p_reader_id, p_amount_vnd, p_allocations)` raises
  `IDEMPOTENCY_CONFLICT` unless the stored payment has the same reader, amount and exactly the
  same (fine, amount) allocations. Used by `sp_record_payment` (steps 2 and the 1062 handler).
- `sp__assess_fines(p_loan_item_id, p_actor, p_now, p_end_kind, p_damaged_vnd, p_lost_vnd,
  p_reason)` inserts the late fine
  (`fn_late_fee(fn_days_late(due, p_now), applied_fee, replacement_cost)`) when days > 0, and
  the damaged or lost fine with the defaults and range checks of FR-015b. It sets `reason` when
  the amount differs from the default.
- `sp__promote_queue(p_copy_id, p_actor, p_now)` [Ext]: FR-014b promotion walk. It runs inside
  the caller's transaction.

## Cursor batches

| Procedure | Tier | Permission | Behaviour |
| --- | --- | --- | --- |
| `sp_expire_cards(p_actor, p_now, OUT p_count)` | Core, public | `card.manage` | Cursor over `library_cards` with `status='active' AND expires_at <= p_now`, ordered by `reader_id, id`. One transaction per row: lock reader → card, re-check, set `expired` |
| `sp_expire_holds(p_actor, p_now, OUT p_count)` | Ext, public | `reservation.manage` | Checks the permission, then calls `sp__expire_holds_batch(p_now, OUT p_count)`: a cursor over `ready` reservations with `hold_expires_at <= p_now`, ordered by `book_id, id`. One transaction per row: lock book → copy → queue, re-check, set `expired`, `sp__promote_queue` |
| `ev_expire_holds` (EVENT) | Ext, not granted | — | `ON SCHEDULE EVERY 15 MINUTE DO CALL sp__expire_holds_batch(UTC_TIMESTAMP(3), @expired_count)` (FR-014c) |

## Ext operation procedures (public once built)

| Procedure | Permission | Parameters | Spec |
| --- | --- | --- | --- |
| `sp_reserve` | `reservation.manage` or self (actor is the reader's account) | reader_id, book_id | FR-014a |
| `sp_cancel_reservation` | same | reservation_id, reason | FR-014c |

## Report procedures [Core, public]

See [reports-and-invariants.md](./reports-and-invariants.md): `sp_report_cumulative(p_as_of,
p_reader_id NULL)` and `sp_report_rollforward(p_from, p_to, p_reader_id NULL)`.
